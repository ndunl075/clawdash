import { describe, expect, it } from 'vitest';
import golden from '../../../../tests/fixtures/simulation-v1.json';
import { curatedLevels, witnessForLevel } from '../../../level-content/src/index';
import { createRun, stepRun, PHYSICS_VERSION } from '../simulation/index';
import { replayLevel, parseReplay, stateHash, type Replay } from './index';

describe('portable tick replay and physics goldens', () => {
  for (const level of curatedLevels) {
    it(`reproduces every trajectory tick for ${level.levelId} independently of render cadence`, () => {
      const expected = golden.levels.find((g) => g.levelId === level.levelId)!;
      const replay: Replay = {
        version: 1,
        physicsVersion: PHYSICS_VERSION,
        levelId: level.levelId,
        totalTicks: level.totalTicksEstimate,
        jumpTicks: witnessForLevel(level),
      };
      const terminal = replayLevel(level, replay);
      expect(terminal.status).toBe('completed');
      expect(terminal.tick).toBe(expected.ticks);
      expect(stateHash(terminal)).toBe(expected.final);
      let state = createRun(level),
        digest = 0x811c9dc5;
      const presses = new Set(replay.jumpTicks);
      // Same input timeline stepped in render batches, including irregular dropped frames.
      const frameBatches = [1, 2, 1, 4, 3, 1, 2];
      let frame = 0;
      while (state.status === 'playing') {
        for (
          let sub = 0;
          sub < frameBatches[frame % frameBatches.length]! && state.status === 'playing';
          sub++
        ) {
          state = stepRun(level, state, { jumpPressed: presses.has(state.tick), jumpHeld: false });
          const hash = stateHash(state);
          for (const char of hash) digest = Math.imul(digest ^ char.charCodeAt(0), 0x01000193) >>> 0;
          const sample = golden.airborneSamples.find(([tick]) => tick === state.tick);
          if (sample) expect(hash).toBe(sample[1]);
        }
        frame++;
      }
      expect(digest.toString(16).padStart(8, '0')).toBe(expected.trajectory);
      expect(state).toEqual(terminal);
    });
  }
  it('rejects incompatible versions, unbounded inputs, duplicate/unsorted ticks and wrong levels', () => {
    const level = curatedLevels[0]!;
    const replay: Replay = {
      version: 1,
      physicsVersion: PHYSICS_VERSION,
      levelId: level.levelId,
      totalTicks: 2160,
      jumpTicks: [312],
    };
    expect(parseReplay(replay)).toEqual(replay);
    for (const mutation of [
      { version: 2 },
      { physicsVersion: 'other' },
      { totalTicks: 100001 },
      { totalTicks: NaN },
      { jumpTicks: [-1] },
      { jumpTicks: [2, 1] },
      { jumpTicks: [1, 1] },
      { jumpTicks: [2160] },
      { jumpTicks: [0.1] },
      { privatePath: 'secret' },
    ])
      expect(() => parseReplay({ ...replay, ...mutation })).toThrow();
    expect(() => replayLevel(level, { ...replay, levelId: 'other-level' })).toThrow('mismatch');
  });
});
