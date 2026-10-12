import { describe, expect, it } from 'vitest';
import { parseLevel, LEVEL_LIMITS } from './index';
import { compilePatterns } from '../../level-content/src/index';

describe('untrusted level artifacts', () => {
  const valid = compilePatterns(['single-v1']);
  it('round trips JSON without retaining executable/unknown fields', () => {
    expect(parseLevel(JSON.stringify(valid))).toEqual(valid);
    expect(() => parseLevel({ ...valid, secretPath: 'private' })).toThrow();
    expect(() => parseLevel({ ...valid, chunks: [{ ...valid.chunks[0], callback() {} }] })).toThrow();
  });
  it.each([
    { schemaVersion: 2 },
    { finishX: Infinity },
    { finishX: -1 },
    { bpm: NaN },
    { difficultyTier: 6 },
    { levelId: '../../private' },
    { displayName: 'hidden\nmetadata' },
  ])('rejects incompatible or invalid fields %j', (fields) => {
    expect(() => parseLevel({ ...valid, ...fields })).toThrow();
  });
  it('bounds import size, geometry, instance count and chunk order', () => {
    expect(() => parseLevel(' '.repeat(LEVEL_LIMITS.bytes + 1))).toThrow('byte limit');
    const obstacle = valid.chunks[0]!.obstacleInstances[0]!;
    for (const mutation of [
      { x: -1 },
      { x: valid.finishX },
      { width: 0 },
      { height: 9000 },
      { kind: 'code' },
      { kind: 'gap', y: 20 },
    ]) {
      expect(() =>
        parseLevel({
          ...valid,
          chunks: [{ ...valid.chunks[0], obstacleInstances: [{ ...obstacle, ...mutation }] }],
        }),
      ).toThrow();
    }
    expect(() =>
      parseLevel({ ...valid, chunks: Array.from({ length: 257 }, () => valid.chunks[0]) }),
    ).toThrow();
    expect(() =>
      parseLevel({
        ...valid,
        chunks: [{ ...valid.chunks[0], obstacleInstances: Array.from({ length: 129 }, () => obstacle) }],
      }),
    ).toThrow();
    const two = compilePatterns(['single-v1', 'double-v1']);
    expect(() => parseLevel({ ...two, chunks: [...two.chunks].reverse() })).toThrow();
  });
});
