import { z } from 'zod';
const sessionsSchema = z
  .array(
    z.object({
      sessionId: z.string().min(1).max(128),
      provider: z.string().min(1).max(32),
      state: z.enum(['idle', 'working', 'attention', 'turn_ended', 'error', 'ended']),
      lastSeenAt: z.iso.datetime(),
      toolActivityCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      category: z.string().max(32).optional(),
      connection: z.enum(['live', 'unknown']).optional(),
      verification: z.literal('unknown').optional(),
    }),
  )
  .max(64);
export type Session = {
  sessionId: string;
  provider: string;
  state: string;
  lastSeenAt: string;
  toolActivityCount: number;
  category?: string;
};
export class Companion {
  constructor(
    private base: string,
    private token: string,
  ) {
    const url = new URL(base);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('Use the local companion address: http://127.0.0.1:PORT');
    this.base = url.origin;
  }
  matchesConnection(url: string, token: string): boolean {
    return this.base === new URL(url).origin && this.token === token;
  }
  async rpc<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${this.base}/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, id: crypto.randomUUID(), method, ...args }),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'Pairing token rejected. Create a new token with the companion.'
          : response.status === 400
            ? 'Request rejected. Choose an approved folder grant ID and a supported difficulty.'
            : 'Companion unavailable. Open its local game address and try again.',
      );
    const body = (await response.json()) as { ok: boolean; data: T; error?: string };
    if (!body.ok) {
      const messages: Record<string, string> = {
        internal:
          'Repository inspection failed. Check Git is installed, select the repository root, make an initial commit, use a complete local clone with full history, and keep below 20,000 tracked entries.',
        not_found: 'That folder grant is unavailable. Choose the repository folder again.',
        busy: 'The companion is already inspecting a repository. Try again shortly.',
        unsupported:
          'This companion does not support repository generation. Update the companion and try again.',
        invalid: 'Use an approved folder grant ID and a supported difficulty.',
        unauthorized: 'Pairing is required. Open the companion’s local game address and pair again.',
      };
      throw new Error(messages[body.error ?? ''] ?? 'The local request failed. Check companion diagnostics.');
    }
    return body.data;
  }
  async sessions(): Promise<Session[]> {
    const response = await fetch(`${this.base}/events`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Connection lost');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') throw new Error('Invalid companion status');
    const parsed = sessionsSchema.safeParse((data as { sessions?: unknown }).sessions);
    if (!parsed.success) throw new Error('Invalid companion status');
    return parsed.data;
  }
}
