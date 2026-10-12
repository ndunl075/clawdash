import { afterEach, describe, expect, it, vi } from 'vitest';
import { Companion } from './bridge';
afterEach(() => vi.unstubAllGlobals());
describe('Companion response boundary', () => {
  it('rejects malformed sessions before they can reach the game UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ sessions: [null] })),
    );
    await expect(new Companion('http://127.0.0.1:1234', 'fixture').sessions()).rejects.toThrow(
      'Invalid companion status',
    );
  });
  it('bounds sessions and keeps observed lifecycle semantics without untrusted extra fields', async () => {
    const session = {
      sessionId: 'fixture',
      provider: 'claude',
      state: 'turn_ended',
      lastSeenAt: '2026-10-12T00:00:00.000Z',
      toolActivityCount: 1,
      verification: 'unknown',
      privateExtra: 'DO_NOT_KEEP',
    };
    const fetch = vi.fn(async () => Response.json({ sessions: [session] }));
    vi.stubGlobal('fetch', fetch);
    const client = new Companion('http://127.0.0.1:1234', 'fixture');
    const accepted = await client.sessions();
    expect(accepted[0].state).toBe('turn_ended');
    expect(JSON.stringify(accepted)).not.toContain('DO_NOT_KEEP');
    fetch.mockImplementation(async () => Response.json({ sessions: Array(65).fill(session) }));
    await expect(client.sessions()).rejects.toThrow('Invalid companion status');
  });
});
