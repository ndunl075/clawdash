import { describe, expect, it } from 'vitest';
import { type LevelSpec, type Obstacle } from '../../../level-schema/src/index';
import { compilePatterns } from '../../../level-content/src/index';
import {
  createRun,
  stepRun,
  restartRun,
  setCheckpoint,
  restoreCheckpoint,
  PHYSICS_VERSION,
  type RunState,
} from './index';
const released = { jumpPressed: false, jumpHeld: false };
const pressed = { jumpPressed: true, jumpHeld: false };
function levelWith(obstacles: Obstacle[], finishX = 960): LevelSpec {
  return {
    ...compilePatterns(['breath-v1']),
    finishX,
    chunks: [{ patternId: 'test-v1', startX: 0, obstacleInstances: obstacles }],
  };
}
function ticks(level: LevelSpec, count: number, state = createRun(level), jumps: number[] = []): RunState {
  for (let i = 0; i < count; i++) state = stepRun(level, state, jumps.includes(i) ? pressed : released);
  return state;
}
describe('fixed-tick authoritative simulation', () => {
  it('uses exact fixed-point trajectory, immutable snapshots and one fixed jump impulse', () => {
    const level = levelWith([]),
      initial = createRun(level);
    const first = stepRun(level, initial, pressed);
    expect([first.x, first.y, first.vy, first.tick]).toEqual([4, 10.35, 10.35, 1]);
    expect([initial.x, initial.y, initial.tick]).toEqual([0, 0, 0]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.fixed)).toBe(true);
    let state = first,
      apex = first.y;
    for (let i = 1; i < 33; i++) {
      state = stepRun(level, state, released);
      apex = Math.max(apex, state.y);
    }
    expect(apex).toBe(87.6);
    expect(state.y).toBe(0);
    expect(state.grounded).toBe(true);
  });
  it('buffers a press shortly before landing and holds to chain jump', () => {
    const level = levelWith([]);
    let state = ticks(level, 31, createRun(level), [0]);
    state = stepRun(level, state, pressed);
    state = stepRun(level, state, released);
    expect(state.grounded).toBe(true);
    state = stepRun(level, state, released);
    expect(state.vy).toBe(10.35);
    const held = { jumpPressed: false, jumpHeld: true };
    state = createRun(level);
    for (let i = 0; i < 34; i++) state = stepRun(level, state, held);
    expect(state.vy).toBe(10.35);
  });
  it('supports the short coyote margin over a ground edge, then expires it', () => {
    const level = levelWith([{ kind: 'gap', x: 20, y: 0, width: 180, height: 160 }]);
    let state = ticks(level, 2);
    expect(state.grounded).toBe(false);
    expect(stepRun(level, state, pressed).vy).toBe(10.35);
    state = ticks(level, 3);
    expect(stepRun(level, state, pressed).vy).toBeLessThan(0);
  });
  it('falls into gaps, dies below the world, freezes dead state and retries immediately', () => {
    const level = levelWith([{ kind: 'gap', x: 40, y: 0, width: 600, height: 160 }]);
    const dead = ticks(level, 80);
    expect(dead.status).toBe('dead');
    expect(dead.y).toBeLessThan(-160);
    expect(stepRun(level, dead, pressed)).toBe(dead);
    const retry = restartRun(level, dead);
    expect([retry.status, retry.attempt, retry.tick, retry.x]).toEqual(['playing', 2, 0, 0]);
  });
  it('kills on block side contact, lands on safe tops, and walks off platforms safely', () => {
    const block = levelWith([{ kind: 'block', x: 100, y: 0, width: 48, height: 36 }]);
    expect(ticks(block, 40).status).toBe('dead');
    const platform = compilePatterns(['step-v1']);
    let state = ticks(platform, 103, createRun(platform), [72]);
    expect(state.y).toBe(32);
    expect(state.grounded).toBe(true);
    state = ticks(platform, 40, state);
    expect(state.y).toBe(0);
    expect(state.status).toBe('playing');
  });
  it('uses triangle hazards and catches thin swept obstacles', () => {
    const thin = levelWith([{ kind: 'spike', x: 30, y: 0, width: 0.5, height: 40 }]);
    expect(ticks(thin, 2).status).toBe('dead');
    const spike = levelWith([{ kind: 'spike', x: 32, y: 0, width: 40, height: 40 }]);
    const base = createRun(spike);
    const corner = {
      ...base,
      x: 0,
      y: 35,
      vy: 0,
      grounded: false,
      fixed: { ...base.fixed, x: 0, y: 35000, vy: 0, coyote: 0 },
    };
    expect(stepRun(spike, corner, released).status).toBe('playing');
    const apex = { ...corner, x: 30, fixed: { ...corner.fixed, x: 30000 } };
    expect(stepRun(spike, apex, released).status).toBe('dead');
  });
  it('stops at completion with clamped progress and rejects another physics version', () => {
    const level = levelWith([], 121),
      state = ticks(level, 40);
    expect(state.status).toBe('completed');
    expect(state.progress).toBe(100);
    expect(state.tick).toBe(31);
    expect(stepRun(level, state, pressed)).toBe(state);
    expect(() => createRun({ ...level, physicsVersion: `${PHYSICS_VERSION}-next` })).toThrow(
      'physics version',
    );
  });
});
describe('validated practice checkpoints', () => {
  it('keeps practice separate and restores a safe exact snapshot with a new attempt', () => {
    const level = compilePatterns(['single-v1']);
    const normal = ticks(level, 20);
    expect(setCheckpoint(level, normal)).toBe(normal);
    const checkpointed = setCheckpoint(level, ticks(level, 20, createRun(level, true)));
    expect(checkpointed.checkpoint).toBeDefined();
    const dead = ticks(level, 100, checkpointed);
    expect(dead.status).toBe('dead');
    const restored = restoreCheckpoint(level, dead);
    expect([restored.tick, restored.x, restored.y, restored.attempt, restored.practice]).toEqual([
      20,
      80,
      0,
      2,
      true,
    ]);
  });
  it('rejects aerial, nearby-hazard, forged and wrong-level checkpoints', () => {
    const level = compilePatterns(['single-v1']);
    const air = stepRun(level, createRun(level, true), pressed);
    expect(setCheckpoint(level, air)).toBe(air);
    const near = ticks(level, 73, createRun(level, true));
    expect(setCheckpoint(level, near).checkpoint).toBeUndefined();
    const safe = setCheckpoint(level, createRun(level, true));
    expect(restoreCheckpoint({ ...level, levelId: 'other-v1' }, safe).x).toBe(0);
    const forged = { ...safe, checkpoint: { ...safe.checkpoint!, fixed: { ...safe.fixed, y: NaN } } };
    expect(restoreCheckpoint(level, forged).checkpoint).toBeUndefined();
  });
});
