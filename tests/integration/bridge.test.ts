import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBridge, grantFolder } from '../../packages/local-bridge/src/index';
import { normalizeClaudeHook } from '../../packages/agent-adapters/claude/index';
import { emitHook } from '../../packages/cli/src/emitter';
import { atomicWrite } from '../../packages/storage/src/atomic';
import { ensureRuntime } from '../../packages/local-bridge/src/runtime';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

describe('Authenticated loopback bridge', () => {
  it('replaces pre-existing broad Windows directory and secret ACL entries', async () => {
    if (process.platform !== 'win32') return;
    const home = await mkdtemp(join(tmpdir(), 'clawdash-runtime-acl-'));
    try {
      await writeFile(join(home, 'emitter-secret'), 'a'.repeat(64));
      await promisify(execFile)('icacls.exe', [home, '/grant', '*S-1-1-0:(OI)(CI)R'], { windowsHide: true });
      await promisify(execFile)('icacls.exe', [join(home, 'emitter-secret'), '/grant', '*S-1-1-0:R'], {
        windowsHide: true,
      });
      await ensureRuntime(home);
      const script =
        "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach($path in @($env:CLAWDASH_ACL_TARGET,[System.IO.Path]::Combine($env:CLAWDASH_ACL_TARGET,'emitter-secret'))) { $item=if([System.IO.Directory]::Exists($path)){[System.IO.DirectoryInfo]::new($path)}else{[System.IO.FileInfo]::new($path)}; foreach($rule in $item.GetAccessControl().GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) { if($rule.IdentityReference.Value -ne $sid) { throw 'Unexpected ACL identity' } }; [Console]::WriteLine('owner-only') }";
      const result = await promisify(execFile)(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 10_000, env: { ...process.env, CLAWDASH_ACL_TARGET: home } },
      );
      expect(result.stdout.match(/owner-only/g)).toHaveLength(2);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it('creates stable secrets across concurrent first launches', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clawdash-runtime-race-'));
    try {
      const results = await Promise.all(Array.from({ length: 20 }, () => ensureRuntime(home)));
      expect(new Set(results.map((r) => r.emitterToken)).size).toBe(1);
      expect(new Set(results.map((r) => r.pairingToken)).size).toBe(1);
      expect(await ensureRuntime(home)).toEqual(results[0]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it('enforces authentication, origins, quotas, age, schemas and folder grants', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clawdash-bridge-'));
    const bridge = await startBridge({
      home,
      inspect: async () => ({
        publicAggregates: { fileCount: 3, commitCount: 1, languages: { typescript: 3 } },
        fingerprint: 'PRIVATE',
        entries: ['SECRET'],
      }),
      generate: () => ({ levelId: 'safe' }),
    });
    const url = `http://127.0.0.1:${bridge.port}`;
    const rpc = (data: unknown, token = bridge.pairingToken, extra: Record<string, string> = {}) =>
      fetch(`${url}/rpc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
        body: JSON.stringify(data),
      });
    try {
      expect(bridge.server.address()).toMatchObject({ address: '127.0.0.1' });
      const health = { v: 1, id: 'h', method: 'health' };
      expect((await rpc(health, 'bad')).status).toBe(401);
      expect((await rpc(health, bridge.pairingToken, { Origin: 'https://evil.example' })).status).toBe(403);
      expect((await rpc({ ...health, method: 'execute', command: 'evil' })).status).toBe(400);
      expect((await rpc({ ...health, path: home })).status).toBe(400);
      expect((await rpc({ ...health, id: 'x'.repeat(20_000) })).status).toBe(400);
      const id = await grantFolder(home, home),
        response = await (await rpc({ v: 1, id: 'r', method: 'inspectRepo', folderGrantId: id })).text();
      expect(response).toContain('fileCount');
      expect(response).not.toMatch(/PRIVATE|SECRET/);
      expect(
        await (await rpc({ v: 1, id: 'r', method: 'generateRepoLevel', folderGrantId: id })).json(),
      ).toMatchObject({ ok: true, data: { levelId: 'safe' } });
      expect(
        await (
          await rpc({
            v: 1,
            id: 'r',
            method: 'inspectRepo',
            folderGrantId: '00000000-0000-4000-8000-000000000000',
          })
        ).json(),
      ).toMatchObject({ ok: false, error: 'not_found' });
      const event = normalizeClaudeHook(
        { session_id: 'private', hook_event_name: 'Stop' },
        bridge.emitterToken,
      )!;
      const hook = (data: unknown, token = bridge.emitterToken, headers: Record<string, string> = {}) =>
        fetch(`${url}/hook`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(data),
        });
      expect((await hook(event, bridge.pairingToken)).status).toBe(401);
      expect((await hook(event, bridge.emitterToken, { Origin: url })).status).toBe(403);
      expect((await hook({ ...event, occurredAt: '2000-01-01T00:00:00.000Z' })).status).toBe(400);
      expect((await hook({ ...event, prompt: 'SECRET' })).status).toBe(400);
      await hook(event);
      await hook(event);
      let poll = await (
        await fetch(`${url}/events`, { headers: { Authorization: `Bearer ${bridge.pairingToken}` } })
      ).json();
      expect(poll.events).toHaveLength(1);
      expect(poll.sessions[0].state).toBe('turn_ended');
      await emitHook({ session_id: 'second', hook_event_name: 'UserPromptSubmit', prompt: 'SECRET' }, home);
      poll = await (
        await fetch(`${url}/events?after=1`, { headers: { Authorization: `Bearer ${bridge.pairingToken}` } })
      ).json();
      expect(poll.events).toHaveLength(1);
      expect(JSON.stringify(poll)).not.toContain('SECRET');
      await atomicWrite(join(home, 'pairing-secret'), 'a'.repeat(64));
      expect((await rpc(health)).status).toBe(401);
      await expect(startBridge({ home })).rejects.toThrow('already running');
    } finally {
      await bridge.close();
      await rm(home, { recursive: true, force: true });
    }
    await expect(emitHook({ bad: true }, home)).resolves.toBeUndefined();
  });
  it('serves same-origin static files and rejects symlink/path escapes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clawdash-static-'));
    await writeFile(join(home, 'index.html'), '<html>game</html>');
    const bridge = await startBridge({ home, staticRoot: home });
    try {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/`);
      expect(await response.text()).toContain('game');
      expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect((await fetch(`http://127.0.0.1:${bridge.port}/%2e%2e%2fpackage.json`)).status).not.toBe(200);
    } finally {
      await bridge.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});
