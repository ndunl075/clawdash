import { readFile, stat, writeFile, open, unlink } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { normalizeClaudeHook } from '../../agent-adapters/claude/index';
import { discover, runtimeHome } from '../../local-bridge/src/runtime';
import { readBounded } from '../../storage/src/atomic';

export async function maybeLaunch(home: string, event: ReturnType<typeof normalizeClaudeHook>) {
  if (event?.type !== 'agent.started') return;
  const prefs = JSON.parse(await readBounded(join(home, 'launcher.json'), 8192));
  if (
    prefs.autoOpen !== true ||
    typeof prefs.executable !== 'string' ||
    !isAbsolute(prefs.executable) ||
    (process.platform === 'win32' && !/\.exe$/i.test(prefs.executable))
  )
    return;
  if (!(await stat(prefs.executable)).isFile()) return;
  const lock = join(home, 'launch.lock');
  try {
    if (Date.now() - (await stat(lock)).mtimeMs < 5000) return;
    await unlink(lock);
  } catch {}
  const handle = await open(lock, 'wx', 0o600);
  await handle.close();
  // One bounded pending lifecycle event, no original hook payload.
  await writeFile(join(home, 'pending-event.json'), JSON.stringify(event), { mode: 0o600 });
  const child = spawn(
    prefs.executable,
    ['--agent-start', ...(prefs.focus === true ? ['--focus-game'] : [])],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.on('error', () => {});
  child.unref();
}
/** Silent fail-open path. Never writes output or returns Claude decisions. */
export async function emitHook(input: unknown, home = runtimeHome()): Promise<void> {
  try {
    const secret = (await readFile(join(home, 'emitter-secret'), 'utf8')).trim();
    const event = normalizeClaudeHook(input, secret);
    if (!event) return;
    try {
      const runtime = await discover(home);
      await fetch(`http://127.0.0.1:${runtime.port}/hook`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(150),
      });
    } catch {
      await maybeLaunch(home, event);
    }
  } catch {}
}
export async function readHookStdin(): Promise<unknown> {
  return new Promise((resolve) => {
    let text = '',
      done = false;
    const finish = (value: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.pause();
      process.stdin.removeAllListeners('data');
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 200);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      text += chunk;
      if (Buffer.byteLength(text) > 65_536) finish(null);
    });
    process.stdin.once('end', () => {
      try {
        finish(JSON.parse(text));
      } catch {
        finish(null);
      }
    });
    process.stdin.once('error', () => finish(null));
  });
}
