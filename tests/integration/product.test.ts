import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBridge, grantFolder } from '../../packages/local-bridge/src/index';
import { inspectRepository, generateRepoLevel } from '../../packages/level-generator/src/index';
import { emitHook } from '../../packages/cli/src/emitter';
import { parseLevel } from '../../packages/level-schema/src/index';
import { verifyLevel } from '../../packages/level-content/src/index';

describe('Integrated local product', () => {
  it('pairs, inspects committed metadata, generates certified geometry and receives real hook lifecycle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawdash-product-'));
    const home = join(root, 'runtime');
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
        cwd: root,
        stdio: 'pipe',
        windowsHide: true,
      });
    let bridge: Awaited<ReturnType<typeof startBridge>> | undefined;
    try {
      git('init');
      await writeFile(join(root, 'PRIVATE_SOURCE.ts'), 'THIS_PRIVATE_BODY_MUST_NEVER_LEAVE');
      git('add', 'PRIVATE_SOURCE.ts');
      git('commit', '-m', 'PRIVATE_COMMIT_MESSAGE');
      const grant = await grantFolder(root, home);
      bridge = await startBridge({
        home,
        inspect: inspectRepository,
        generate: (descriptor, tier) =>
          generateRepoLevel(
            descriptor as Awaited<ReturnType<typeof inspectRepository>>,
            tier as 1 | 2 | 3 | 4 | 5 | undefined,
          ),
      });
      const rpc = async (method: string) => {
        const response = await fetch(`http://127.0.0.1:${bridge!.port}/rpc`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bridge!.pairingToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ v: 1, id: method, method, folderGrantId: grant }),
        });
        const payload = await response.json();
        expect(payload.ok).toBe(true);
        expect(JSON.stringify(payload)).not.toMatch(
          /PRIVATE_SOURCE|THIS_PRIVATE_BODY|PRIVATE_COMMIT_MESSAGE/,
        );
        return payload.data;
      };
      const summary = await rpc('inspectRepo');
      expect(summary.fileCount).toBe(1);
      const level = parseLevel(await rpc('generateRepoLevel'));
      expect(verifyLevel(level).valid).toBe(true);
      await emitHook(
        { hook_event_name: 'UserPromptSubmit', session_id: 'private-real-session', prompt: 'PRIVATE_PROMPT' },
        home,
      );
      await emitHook(
        {
          hook_event_name: 'PermissionRequest',
          session_id: 'private-real-session',
          tool_input: { command: 'PRIVATE_COMMAND' },
        },
        home,
      );
      await emitHook(
        { hook_event_name: 'PostToolUse', session_id: 'private-real-session', tool_name: 'Edit' },
        home,
      );
      await emitHook(
        {
          hook_event_name: 'Stop',
          session_id: 'private-real-session',
          transcript_path: 'PRIVATE_TRANSCRIPT',
        },
        home,
      );
      const events = await (
        await fetch(`http://127.0.0.1:${bridge.port}/events`, {
          headers: { Authorization: `Bearer ${bridge.pairingToken}` },
        })
      ).json();
      expect(events.sessions).toHaveLength(1);
      expect(events.sessions[0].state).toBe('turn_ended');
      expect(events.sessions[0].verification).toBe('unknown');
      expect(JSON.stringify(events)).not.toMatch(/PRIVATE_|private-real-session/);
      expect(events.events).toHaveLength(4);
      await bridge.close();
      bridge = undefined;
      const reopened = await startBridge({ home });
      await reopened.close();
    } finally {
      await bridge?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
