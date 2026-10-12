import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentState,
  reduceAgentEvent,
  getSessions,
  type AgentEvent,
} from '../../packages/agent-core/src/index';
import { normalizeClaudeHook, CLAUDE_HOOK_EVENTS } from '../../packages/agent-adapters/claude/index';
import { installClaudeHooks, uninstallClaudeHooks } from '../../packages/cli/src/hooks';
import { AtomicJsonStore } from '../../packages/storage/src/atomic';
import {
  defaultSettings,
  migrateSettings,
  defaultProgress,
  recordRun,
  migrateProgress,
} from '../../packages/storage/src/index';

describe('Agent lifecycle and privacy', () => {
  const normalize = (name: string, extra: Record<string, unknown> = {}) =>
    normalizeClaudeHook({ hook_event_name: name, session_id: 'private-provider-id', ...extra }, 'secret')!;
  it('maps documented lifecycle without forwarding private fields', () => {
    for (const hook of CLAUDE_HOOK_EVENTS) {
      const event = normalize(hook, {
        prompt: 'SECRET',
        cwd: 'PRIVATE',
        transcript_path: 'PRIVATE',
        tool_input: { command: 'SECRET' },
        notification_type: 'permission_prompt',
      });
      expect(event).toBeTruthy();
      expect(JSON.stringify(event)).not.toMatch(/SECRET|PRIVATE|private-provider-id/);
    }
    expect(normalize('Notification', { notification_type: 'auth_success' })).toBeNull();
    expect(normalize('Stop', { agent_id: 'child' })).toBeNull();
    expect(normalize('SubagentStop')).toBeNull();
    expect(normalize('TaskCompleted')).toBeNull();
  });
  it('deduplicates, rejects old states, separates concurrent sessions, never claims success', () => {
    const start = normalize('UserPromptSubmit');
    let state = reduceAgentEvent(createAgentState(), start);
    expect(reduceAgentEvent(state, start)).toBe(state);
    const end = {
      ...normalize('Stop'),
      occurredAt: new Date(Date.parse(start.occurredAt) + 10).toISOString(),
    };
    state = reduceAgentEvent(state, end);
    state = reduceAgentEvent(state, { ...start, eventId: 'older' });
    expect(getSessions(state)[0].state).toBe('turn_ended');
    expect(getSessions(state)[0].verification).toBe('unknown');
    state = reduceAgentEvent(state, { ...start, eventId: 'new', sessionId: 'second' });
    expect(getSessions(state)).toHaveLength(2);
    expect(getSessions(state, Date.now() + 200_000).every((s) => s.connection === 'unknown')).toBe(true);
  });
  it('tool failure does not become a turn failure and SessionStart stays idle', () => {
    let state = reduceAgentEvent(createAgentState(), normalize('SessionStart'));
    expect(getSessions(state)[0].state).toBe('idle');
    state = reduceAgentEvent(state, normalize('PostToolUseFailure'));
    expect(getSessions(state)[0].state).toBe('working');
  });
});
describe('Safe settings and atomic persistence', () => {
  it('keeps practice completion separate and salvages fields without wiping valid records', () => {
    const progress = recordRun(defaultProgress(), 'level:physics-v1', {
      practice: true,
      percent: 100,
      completed: true,
      ticks: 500,
    });
    expect(progress.levels['level:physics-v1'].completedNormal).toBe(false);
    expect(progress.levels['level:physics-v1'].completedPractice).toBe(true);
    const migrated = migrateProgress({
      schemaVersion: 1,
      levels: { good: { ...progress.levels['level:physics-v1'], bestNormalPercent: 'bad' }, broken: null },
    });
    expect(migrated.levels.good.completedPractice).toBe(true);
    expect(migrated.levels.good.bestNormalPercent).toBe(0);
  });
  it('idempotently merges and removes exact owned hooks, preserving unrelated data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clawdash-hooks-'));
    try {
      const path = join(dir, 'settings.json'),
        userHook = { matcher: 'Edit', hooks: [{ type: 'command', command: 'user-command' }] },
        original = { theme: 'dark', hooks: { PostToolUse: [userHook] } };
      await writeFile(path, JSON.stringify(original));
      const invocation = { command: process.execPath, args: ['C:\\path with spaces\\hook.js'] };
      await installClaudeHooks(invocation, path);
      const once = await readFile(path, 'utf8');
      await installClaudeHooks(invocation, path);
      expect(await readFile(path, 'utf8')).toBe(once);
      expect(JSON.parse(once).hooks.PostToolUse[0]).toEqual(userHook);
      expect(JSON.parse(once).hooks.UserPromptSubmit[0].hooks[0].args).toContain('--clawdash-managed-v1');
      await uninstallClaudeHooks(path);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(original);
      await uninstallClaudeHooks(path);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(original);
      await writeFile(path, '{broken');
      await expect(installClaudeHooks(invocation, path)).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe('{broken');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('serializes updates, detects corruption, preserves originals and defaults individual fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clawdash-store-'));
    try {
      const path = join(dir, 'save.json'),
        store = new AtomicJsonStore(path, migrateSettings, defaultSettings);
      await Promise.all([
        store.update((x) => ({ ...x, reducedMotion: true })),
        store.update((x) => ({ ...x, musicVolume: 0.1 })),
      ]);
      expect((await store.load()).reducedMotion).toBe(true);
      expect((await store.load()).musicVolume).toBe(0.1);
      expect(migrateSettings({ musicVolume: 'bad', effectsVolume: 0.2 }).effectsVolume).toBe(0.2);
      await writeFile(path, '{"version":99}');
      await expect(store.load()).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe('{"version":99}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
