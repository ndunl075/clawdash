import { expect, it } from 'vitest';
import { curatedLevels } from '../../../../packages/level-content/src/index';
import { createRun } from '../../../../packages/game/src/simulation/index';
import { applyRunProgress, recordKey, RunProgressTracker } from './progress';
import { cacheRepoLevel, prepareRepoLevel, readRepoCache, REPO_CACHE_LIMITS } from './repo-cache';
import type { Save } from './index';

const level = curatedLevels[0]!;
const emptySave = (): Save => ({
  version: 1,
  settings: { theme: 'signal', music: 0.3, sfx: 0.4, muted: false, reducedMotion: false, offline: false },
  records: {},
  lastLevel: '',
  cachedRepoLevels: [],
});

it('counts attempt start and retry once, never recounting terminal or pause snapshots', () => {
  const tracker = new RunProgressTracker(level);
  const start = createRun(level);
  let save = applyRunProgress(emptySave(), tracker.observe(start)!);
  expect(save.records[recordKey(level, false)]?.attempts).toBe(1);
  expect(tracker.observe(start)).toBeUndefined();
  const dead = { ...start, tick: 200, progress: 30, status: 'dead' as const };
  save = applyRunProgress(save, tracker.observe(dead)!);
  const afterDeath = save;
  save = applyRunProgress(save, tracker.observe(dead, true)!);
  expect(save).toBe(afterDeath);
  expect(save.records[recordKey(level, false)]).toEqual({ best: 30, attempts: 1, completed: false });
  save = applyRunProgress(save, tracker.observe({ ...start, attempt: 2 })!);
  expect(save.records[recordKey(level, false)]?.attempts).toBe(2);
  expect(tracker.observe({ ...start, attempt: 2 })).toBeUndefined();
});

it('retains a partial best on early exit and snapshots progress at most every 120 ticks', () => {
  const tracker = new RunProgressTracker(level);
  const start = createRun(level);
  let save = applyRunProgress(emptySave(), tracker.observe(start)!);
  for (let tick = 1; tick < 120; tick++)
    expect(tracker.observe({ ...start, tick, progress: tick / 10 })).toBeUndefined();
  save = applyRunProgress(save, tracker.observe({ ...start, tick: 120, progress: 12 })!);
  expect(save.records[recordKey(level, false)]?.best).toBe(12);
  expect(tracker.observe({ ...start, tick: 130, progress: 13 })).toBeUndefined();
  save = applyRunProgress(save, tracker.observe({ ...start, tick: 131, progress: 13.1 }, true)!);
  expect(save.records[recordKey(level, false)]).toEqual({ best: 13.1, attempts: 1, completed: false });
});

it('separates normal, practice and physics versions', () => {
  let save = emptySave();
  for (const [physicsVersion, practice, progress] of [
    [level.physicsVersion, false, 20],
    [level.physicsVersion, true, 70],
    ['future-physics', false, 90],
  ] as const) {
    const tracker = new RunProgressTracker({ ...level, physicsVersion });
    save = applyRunProgress(save, tracker.observe({ ...createRun(level, practice), progress }, true)!);
  }
  expect(Object.keys(save.records)).toHaveLength(3);
  expect(save.records[recordKey(level, false)]).toEqual({ best: 20, attempts: 1, completed: false });
  expect(save.records[recordKey(level, true)]?.best).toBe(70);
  expect(save.records[recordKey({ ...level, physicsVersion: 'future-physics' }, false)]?.best).toBe(90);
});

it('keeps only five recent valid baked repo tracks and removes private seeds', () => {
  let save = emptySave();
  for (let i = 0; i < 7; i++)
    save = cacheRepoLevel(save, {
      ...level,
      levelId: `repo-${i}`,
      mode: 'repo',
      seed: 'private-fingerprint',
    });
  expect(save.cachedRepoLevels.map((item) => item.levelId)).toEqual([
    'repo-6',
    'repo-5',
    'repo-4',
    'repo-3',
    'repo-2',
  ]);
  expect(save.cachedRepoLevels.every((item) => item.seed === undefined)).toBe(true);
  save = cacheRepoLevel(save, save.cachedRepoLevels[2]);
  expect(save.cachedRepoLevels.map((item) => item.levelId)).toEqual([
    'repo-4',
    'repo-6',
    'repo-5',
    'repo-3',
    'repo-2',
  ]);
});

it('rejects unsupported, oversized and malformed cached levels while preserving valid siblings', () => {
  const valid = { ...level, mode: 'repo' as const };
  expect(() => prepareRepoLevel({ ...valid, physicsVersion: 'unknown' })).toThrow(/unsupported/);
  expect(() => prepareRepoLevel({ ...valid, oversized: 'x'.repeat(REPO_CACHE_LIMITS.levelBytes) })).toThrow(
    /size limit/,
  );
  expect(readRepoCache([{ schemaVersion: 500 }, valid])).toEqual([valid]);
  expect(readRepoCache([level])).toEqual([]);
});
