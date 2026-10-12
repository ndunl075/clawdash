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
          : 'Companion unavailable. Open its local game address and try again.',
      );
    const body = (await response.json()) as { ok: boolean; data: T; error?: string };
    if (!body.ok) throw new Error(`Companion: ${body.error ?? 'request failed'}`);
    return body.data;
  }
  async sessions(): Promise<Session[]> {
    const response = await fetch(`${this.base}/events`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Connection lost');
    const data = (await response.json()) as { sessions: Session[] };
    return Array.isArray(data.sessions) ? data.sessions : [];
  }
}
