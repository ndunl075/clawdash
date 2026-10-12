import { parseLevel, type LevelSpec } from '../../../../packages/level-schema/src/index';
import { PHYSICS_VERSION } from '../../../../packages/game/src/simulation/index';
import type { Save } from './index';

export const REPO_CACHE_LIMITS = { count: 5, levelBytes: 128 * 1024, totalBytes: 512 * 1024 } as const;
const byteSize = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function prepareRepoLevel(value: unknown): LevelSpec {
  if (byteSize(value) > REPO_CACHE_LIMITS.levelBytes)
    throw new Error('This track exceeds the local cache size limit.');
  const parsed = parseLevel(value);
  if (parsed.mode !== 'repo' || parsed.physicsVersion !== PHYSICS_VERSION)
    throw new Error('This repo track uses an unsupported game version.');
  // The baked geometry is sufficient; private generation seeds are unnecessary in local UI saves.
  const { seed: _seed, ...level } = parsed;
  return level;
}

export function readRepoCache(value: unknown): LevelSpec[] {
  if (!Array.isArray(value)) return [];
  const levels: LevelSpec[] = [];
  let bytes = 2;
  for (const candidate of value.slice(0, REPO_CACHE_LIMITS.count)) {
    try {
      const level = prepareRepoLevel(candidate);
      const size = byteSize(level) + 1;
      if (
        bytes + size > REPO_CACHE_LIMITS.totalBytes ||
        levels.some((item) => item.levelId === level.levelId)
      )
        continue;
      levels.push(level);
      bytes += size;
    } catch {
      /* Invalid cache entries cannot reach the renderer; valid siblings remain available. */
    }
  }
  return levels;
}

export function cacheRepoLevel(save: Save, value: unknown): Save {
  const level = prepareRepoLevel(value);
  return {
    ...save,
    cachedRepoLevels: readRepoCache([
      level,
      ...save.cachedRepoLevels.filter((item) => item.levelId !== level.levelId),
    ]),
  };
}
