import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { realpath, stat, readFile, unlink, open } from 'node:fs/promises';
import { join, resolve, relative, extname, isAbsolute } from 'node:path';
import { z } from 'zod';
import {
  agentEventSchema,
  createAgentState,
  reduceAgentEvent,
  getSessions,
  type AgentEvent,
} from '../../agent-core/src/index';
import { atomicWrite, readBounded } from '../../storage/src/atomic';
import { ensureRuntime, runtimeHome } from './runtime';

const rpcSchema = z
  .object({
    v: z.literal(1),
    id: z.string().min(1).max(80),
    method: z.enum(['health', 'listSessions', 'inspectRepo', 'generateRepoLevel']),
    folderGrantId: z.string().uuid().optional(),
    difficulty: z.number().int().min(1).max(5).optional(),
  })
  .strict();
export type BridgeOptions = {
  home?: string;
  staticRoot?: string;
  inspect?: (path: string) => Promise<unknown>;
  generate?: (descriptor: unknown, difficulty?: number) => unknown;
  onAgentStart?: (event: AgentEvent) => void;
};
function tokenMatches(value: string | undefined, token: string) {
  const a = Buffer.from(value ?? ''),
    b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Error('invalid');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function grantFolder(path: string, home = runtimeHome()) {
  await ensureRuntime(home);
  const canonical = await realpath(resolve(path));
  if (!(await stat(canonical)).isDirectory()) throw new Error('Select a directory');
  const grants = await readGrants(home),
    id = randomUUID();
  grants[id] = canonical;
  await atomicWrite(join(home, 'grants.json'), JSON.stringify(grants));
  return id;
}
async function readGrants(home: string): Promise<Record<string, string>> {
  try {
    return z
      .record(z.string().uuid(), z.string().max(4096))
      .parse(JSON.parse(await readBounded(join(home, 'grants.json'), 65_536)));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
}
export async function startBridge(options: BridgeOptions = {}) {
  const home = options.home ?? runtimeHome(),
    tokens = await ensureRuntime(home);
  let state = createAgentState(),
    cursor = 0,
    busy = false;
  const staticRoot = options.staticRoot ? await realpath(options.staticRoot) : undefined;
  const lockPath = join(home, 'bridge.lock');
  try {
    const previous = JSON.parse(await readBounded(lockPath, 1024));
    if (!Number.isSafeInteger(previous.pid) || previous.pid < 1)
      throw new Error('Invalid bridge lock; inspect local runtime directory');
    try {
      process.kill(previous.pid, 0);
      throw new Error('Bridge already running');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const lock = await open(lockPath, 'wx', 0o600);
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  await lock.close();
  const events: Array<{ cursor: number; event: AgentEvent }> = [],
    buckets = new Map<string, { start: number; count: number }>();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const address = server.address();
      if (!address || typeof address === 'string') return json(503, { error: 'busy' });
      const host = `127.0.0.1:${address.port}`,
        origin = `http://${host}`;
      if (
        req.headers.host !== host ||
        (req.headers.origin &&
          ![origin, 'http://tauri.localhost', 'tauri://localhost'].includes(req.headers.origin))
      )
        return json(403, { error: 'unauthorized' });
      if (req.headers.origin === 'http://tauri.localhost' || req.headers.origin === 'tauri://localhost') {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
      }
      const key = req.socket.remoteAddress ?? '';
      const bucket = buckets.get(key) ?? { start: Date.now(), count: 0 };
      if (Date.now() - bucket.start > 1000) {
        bucket.start = Date.now();
        bucket.count = 0;
      }
      buckets.set(key, bucket);
      if (++bucket.count > 120) return json(429, { error: 'busy' });
      const url = new URL(req.url ?? '/', origin);
      if (url.pathname === '/rpc' || url.pathname === '/events' || url.pathname === '/hook') {
        const hook = url.pathname === '/hook';
        const pairToken = (await readFile(join(home, 'pairing-secret'), 'utf8')).trim();
        if (!tokenMatches(req.headers.authorization, hook ? tokens.emitterToken : pairToken))
          return json(401, { error: 'unauthorized' });
        if (hook) {
          if (req.method !== 'POST' || req.headers.origin) return json(403, { error: 'unauthorized' });
          const event = agentEventSchema.parse(await body(req));
          if (Math.abs(Date.now() - Date.parse(event.occurredAt)) > 60_000)
            return json(400, { error: 'invalid' });
          const prior = state.sessions[`${event.provider}:${event.sessionId}`];
          const next = reduceAgentEvent(state, event);
          if (next !== state) {
            const accepted =
              !state.seen.includes(event.eventId) && (!prior || event.occurredAt >= prior.lastSeenAt);
            state = next;
            if (accepted) {
              events.push({ cursor: ++cursor, event });
              if (events.length > 256) events.shift();
              if (event.type === 'agent.started') options.onAgentStart?.(event);
            }
          }
          return json(200, { ok: true });
        }
        if (url.pathname === '/events') {
          if (req.method !== 'GET') return json(405, { error: 'invalid' });
          const after = Number(url.searchParams.get('after') ?? 0);
          if (!Number.isSafeInteger(after) || after < 0) return json(400, { error: 'invalid' });
          return json(200, {
            v: 1,
            sessions: getSessions(state),
            events: events.filter((x) => x.cursor > after).map((x) => x.event),
            cursor,
          });
        }
        if (req.method !== 'POST') return json(405, { error: 'invalid' });
        const rpc = rpcSchema.parse(await body(req));
        const reply = (data: unknown) => json(200, { v: 1, id: rpc.id, ok: true, data });
        if (rpc.method === 'health') return reply({ protocol: 1, connected: true });
        if (rpc.method === 'listSessions') return reply(getSessions(state));
        if (!rpc.folderGrantId) return json(200, { v: 1, id: rpc.id, ok: false, error: 'invalid' });
        const path = (await readGrants(home))[rpc.folderGrantId];
        if (!path || (await realpath(path)) !== path)
          return json(200, { v: 1, id: rpc.id, ok: false, error: 'not_found' });
        if (busy) return json(200, { v: 1, id: rpc.id, ok: false, error: 'busy' });
        busy = true;
        try {
          const descriptor = await options.inspect?.(path);
          if (!descriptor) return json(200, { v: 1, id: rpc.id, ok: false, error: 'unsupported' });
          if (rpc.method === 'inspectRepo') {
            const p = (descriptor as { publicAggregates?: Record<string, unknown> }).publicAggregates ?? {};
            return reply({
              snapshot: 'HEAD',
              fileCount: p.fileCount ?? 0,
              commitCount: p.commitCount ?? 0,
              languages: p.languages ?? {},
              dirty: p.dirty ?? false,
            });
          }
          if (!options.generate) return json(200, { v: 1, id: rpc.id, ok: false, error: 'unsupported' });
          return reply(await options.generate(descriptor, rpc.difficulty));
        } catch {
          return json(200, { v: 1, id: rpc.id, ok: false, error: 'internal' });
        } finally {
          busy = false;
        }
      }
      if (req.method !== 'GET' || !staticRoot) return json(404, { error: 'not_found' });
      const requested = decodeURIComponent(url.pathname);
      if (requested.includes('\0')) return json(400, { error: 'invalid' });
      let path = resolve(staticRoot, `.${requested === '/' ? '/index.html' : requested}`);
      path = await realpath(path);
      const rel = relative(staticRoot, path);
      if (rel.startsWith('..') || isAbsolute(rel)) return json(403, { error: 'unauthorized' });
      if ((await stat(path)).size > 10_000_000) return json(413, { error: 'invalid' });
      const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
        '.webmanifest': 'application/manifest+json',
      };
      res.writeHead(200, {
        'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
      });
      res.end(await readFile(path));
    } catch {
      if (!res.headersSent) json(400, { error: 'invalid' });
      else res.end();
    }
  });
  server.requestTimeout = 2000;
  server.headersTimeout = 2000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 32;
  try {
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', done);
    });
  } catch (error) {
    await unlink(lockPath);
    throw error;
  }
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Bind failed');
  const discovery = { protocol: 1 as const, port: addr.port, pid: process.pid, instanceId: randomUUID() };
  await atomicWrite(join(home, 'runtime.json'), JSON.stringify(discovery));
  try {
    const pending = agentEventSchema.parse(
      JSON.parse(await readBounded(join(home, 'pending-event.json'), 4096)),
    );
    if (Math.abs(Date.now() - Date.parse(pending.occurredAt)) < 60_000) {
      state = reduceAgentEvent(state, pending);
      events.push({ cursor: ++cursor, event: pending });
    }
    await unlink(join(home, 'pending-event.json'));
  } catch {}
  return {
    server,
    ...discovery,
    ...tokens,
    close: async () => {
      await new Promise<void>((done, reject) => server.close((e) => (e ? reject(e) : done())));
      try {
        const d = JSON.parse(await readBounded(join(home, 'runtime.json')));
        if (d.instanceId === discovery.instanceId) {
          await unlink(join(home, 'runtime.json'));
          await unlink(lockPath);
        }
      } catch {}
    },
  };
}
