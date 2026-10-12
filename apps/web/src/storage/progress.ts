import type { LevelSpec } from '../../../../packages/level-schema/src/index';
import type { RunState } from '../../../../packages/game/src/simulation/index';
import type { Save } from './index';

export const recordKey = (level: Pick<LevelSpec, 'levelId' | 'physicsVersion'>, practice: boolean): string =>
  `${level.levelId}:${level.physicsVersion}:${practice ? 'practice' : 'normal'}`;

export type ProgressUpdate = {
  key: string;
  levelId: string;
  best: number;
  attempts: number;
  completed: boolean;
  ticks?: number;
};

/** One tracker per logical run. Rendering/effect replay cannot count an attempt twice. */
export class RunProgressTracker {
  private attempt = 0;
  private savedTick = 0;
  constructor(private level: Pick<LevelSpec, 'levelId' | 'physicsVersion'>) {}
  observe(state: RunState, flush = false): ProgressUpdate | undefined {
    const attempts = Math.max(0, state.attempt - this.attempt);
    if (!attempts && !flush && state.status === 'playing' && state.tick - this.savedTick < 120) return;
    this.attempt = Math.max(this.attempt, state.attempt);
    this.savedTick = state.tick;
    return {
      key: recordKey(this.level, state.practice),
      levelId: this.level.levelId,
      best: state.progress,
      attempts,
      completed: state.status === 'completed',
      ...(state.status === 'completed' ? { ticks: state.tick } : {}),
    };
  }
}

export function applyRunProgress(save: Save, update: ProgressUpdate): Save {
  const old = save.records[update.key];
  const record = {
    best: Math.max(old?.best ?? 0, update.best),
    attempts: (old?.attempts ?? 0) + update.attempts,
    completed: !!old?.completed || update.completed,
    ...(update.ticks !== undefined
      ? { ticks: Math.min(old?.ticks ?? Infinity, update.ticks) }
      : old?.ticks !== undefined
        ? { ticks: old.ticks }
        : {}),
  };
  if (
    old &&
    old.best === record.best &&
    old.attempts === record.attempts &&
    old.completed === record.completed &&
    old.ticks === record.ticks &&
    save.lastLevel === update.levelId
  )
    return save;
  return { ...save, lastLevel: update.levelId, records: { ...save.records, [update.key]: record } };
}
