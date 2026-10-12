import { describe, expect, it } from 'vitest';
import {
  certifiedPatterns,
  compilePatterns,
  curatedLevels,
  witnessForLevel,
  verifyLevel,
  SEGMENT_CATALOG_VERSION,
} from './index';
import { createRun, stepRun } from '../../game/src/simulation/index';
describe('certified content and continuous whole-level proof', () => {
  it.each(certifiedPatterns.map((p) => [p.id, p] as const))(
    'certifies %s with neutral grounded exit',
    (_id, p) => {
      const level = compilePatterns([p.id]);
      expect(verifyLevel(level)).toEqual({ valid: true, ticks: p.durationTicks });
      const witness = new Set(p.witness);
      let state = createRun(level);
      for (let tick = 0; tick < p.durationTicks; tick++)
        state = stepRun(level, state, { jumpPressed: witness.has(tick), jumpHeld: false });
      expect([state.y, state.vy, state.grounded]).toEqual([0, 0, true]);
      expect(p.safeEntry).toBeGreaterThanOrEqual(280);
      expect(p.safeExit).toBeGreaterThanOrEqual(240);
    },
  );
  it.each(curatedLevels.map((l) => [l.displayName, l] as const))(
    'proves the entire original curated track %s',
    (_name, level) => {
      expect(verifyLevel(level)).toEqual({ valid: true, ticks: level.totalTicksEstimate });
      expect(level.totalTicksEstimate / 60).toBeGreaterThanOrEqual(30);
      expect(witnessForLevel(level).length).toBeGreaterThan(5);
    },
  );
  it('checks all ordered pattern boundary combinations continuously', () => {
    for (const a of certifiedPatterns)
      for (const b of certifiedPatterns)
        expect(verifyLevel(compilePatterns([a.id, b.id])).valid, `${a.id} -> ${b.id}`).toBe(true);
  });
  it('proves a reproducible corpus of 120 mixed multi-section levels within budget', () => {
    let seed = 0x12345678;
    for (let i = 0; i < 120; i++) {
      const ids = Array.from({ length: 4 + (i % 9) }, () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return certifiedPatterns[(seed >>> 0) % certifiedPatterns.length]!.id;
      });
      const level = compilePatterns(ids);
      expect(verifyLevel(level)).toEqual({ valid: true, ticks: ids.length * 240 });
      expect(compilePatterns(ids)).toEqual(level);
    }
  });
  it('rejects geometry mutation, boundary changes, unsupported versions and finish tampering', () => {
    const level = compilePatterns(['single-v1', 'double-v1']);
    const mutated = structuredClone(level);
    mutated.chunks[0]!.obstacleInstances[0]!.width = 400;
    expect(verifyLevel(mutated).valid).toBe(false);
    expect(() => witnessForLevel(mutated)).toThrow('geometry');
    for (const mutation of [
      { physicsVersion: 'new-physics' },
      { segmentCatalogVersion: 'new-catalog' },
      { bpm: 121 },
      { finishX: level.finishX + 4 },
      { totalTicksEstimate: 1 },
    ])
      expect(verifyLevel({ ...level, ...mutation }).valid).toBe(false);
    const moved = structuredClone(level);
    moved.chunks[1]!.startX += 4;
    expect(verifyLevel(moved).valid).toBe(false);
    expect(() => compilePatterns(['unknown-v1'])).toThrow();
    expect(() => compilePatterns([])).toThrow();
    expect(() => compilePatterns(['single-v1'], { bpm: 140 })).toThrow();
    expect(level.segmentCatalogVersion).toBe(SEGMENT_CATALOG_VERSION);
  });
});
