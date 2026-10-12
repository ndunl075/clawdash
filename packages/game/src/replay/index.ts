import { type LevelSpec } from '../../../level-schema/src/index';
import { createRun, PHYSICS_VERSION, stepRun, type RunState } from '../simulation/index';

export type Replay = {
  version: 1;
  physicsVersion: string;
  levelId: string;
  jumpTicks: number[];
  totalTicks: number;
};
export function parseReplay(value: unknown): Replay {
  if (!value || typeof value !== 'object') throw new Error('Invalid replay');
  const r = value as Replay;
  if (
    Object.keys(r).sort().join(',') !== 'jumpTicks,levelId,physicsVersion,totalTicks,version' ||
    r.version !== 1 ||
    r.physicsVersion !== PHYSICS_VERSION ||
    typeof r.levelId !== 'string' ||
    r.levelId.length > 96 ||
    !Number.isInteger(r.totalTicks) ||
    r.totalTicks < 1 ||
    r.totalTicks > 100_000 ||
    !Array.isArray(r.jumpTicks) ||
    r.jumpTicks.length > 100_000
  )
    throw new Error('Invalid replay header');
  let previous = -1;
  for (const tick of r.jumpTicks) {
    if (!Number.isInteger(tick) || tick <= previous || tick >= r.totalTicks)
      throw new Error('Invalid replay input order');
    previous = tick;
  }
  return { ...r, jumpTicks: [...r.jumpTicks] };
}
export function replayLevel(level: LevelSpec, value: Replay): RunState {
  const replay = parseReplay(value);
  if (level.levelId !== replay.levelId || level.physicsVersion !== replay.physicsVersion)
    throw new Error('Replay level/version mismatch');
  let state = createRun(level);
  const presses = new Set(replay.jumpTicks);
  for (let tick = 0; tick < replay.totalTicks && state.status === 'playing'; tick++)
    state = stepRun(level, state, { jumpPressed: presses.has(tick), jumpHeld: false });
  return state;
}
/** Portable FNV-1a state fingerprint for regression/replay parity, not cryptography. */
export function stateHash(state: RunState): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      state.tick,
      state.fixed.x,
      state.fixed.y,
      state.fixed.vy,
      state.fixed.buffer,
      state.fixed.coyote,
      state.grounded,
      state.status,
      state.attempt,
      state.practice,
    ]),
  );
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
