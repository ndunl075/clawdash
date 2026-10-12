import { parseLevel, type LevelSpec, type Obstacle } from '../../level-schema/src/index';
import { createRun, PHYSICS_VERSION, stepRun } from '../../game/src/simulation/index';

export const SEGMENT_CATALOG_VERSION = 'clawdash-catalog-1';
export type CertifiedPattern = Readonly<{
  id: string;
  physicsVersion: string;
  speed: number;
  width: number;
  durationTicks: number;
  bpm: number;
  beats: number;
  difficultyCost: number;
  entry: Readonly<{ grounded: true; y: 0; vy: 0; jumpHeld: false }>;
  exit: Readonly<{ grounded: true; y: 0; vy: 0; jumpHeld: false }>;
  terrain: 'flat' | 'gap' | 'platform';
  safeEntry: number;
  safeExit: number;
  maxConsecutivePreciseJumps: number;
  cooldownTicks: number;
  obstacles: readonly Obstacle[];
  witness: readonly number[];
}>;
const neutral = Object.freeze({ grounded: true, y: 0, vy: 0, jumpHeld: false } as const);
const spike = (x: number, width = 28): Obstacle => ({ kind: 'spike', x, y: 0, width, height: 28 });
function pattern(
  id: string,
  difficultyCost: number,
  obstacles: Obstacle[],
  witness: number[],
  terrain: CertifiedPattern['terrain'] = 'flat',
): CertifiedPattern {
  const last = Math.max(0, ...obstacles.map((o) => o.x + o.width));
  return Object.freeze({
    id,
    physicsVersion: PHYSICS_VERSION,
    speed: 4,
    width: 960,
    durationTicks: 240,
    bpm: 120,
    beats: 8,
    difficultyCost,
    entry: neutral,
    exit: neutral,
    terrain,
    safeEntry: obstacles.length ? obstacles[0]!.x - 28 : 960,
    safeExit: 960 - last,
    maxConsecutivePreciseJumps: witness.length,
    cooldownTicks: 240 - (witness.at(-1) ?? 0) - 34,
    obstacles: Object.freeze(obstacles.map((o) => Object.freeze(o))),
    witness: Object.freeze(witness),
  });
}
/** Original, beat-grid-authored motifs. Safe zones return to neutral grounded state.
 * A witness is a constructive simulation proof, never a human playtest claim.
 */
export const certifiedPatterns: readonly CertifiedPattern[] = Object.freeze([
  pattern('breath-v1', 0, [], []),
  pattern('single-v1', 1, [spike(336)], [72]),
  pattern('double-v1', 2, [spike(336), spike(364)], [72]),
  pattern('gap-v1', 2, [{ kind: 'gap', x: 336, y: 0, width: 88, height: 160 }], [76], 'gap'),
  pattern('step-v1', 2, [{ kind: 'platform', x: 336, y: 32, width: 120, height: 16 }], [72], 'platform'),
  pattern('block-v1', 3, [{ kind: 'block', x: 336, y: 0, width: 48, height: 36 }], [72]),
  pattern('offbeat-v1', 3, [spike(336), spike(624)], [72, 144]),
  pattern(
    'twin-gap-v1',
    4,
    [
      { kind: 'gap', x: 336, y: 0, width: 88, height: 160 },
      { kind: 'gap', x: 624, y: 0, width: 88, height: 160 },
    ],
    [76, 148],
    'gap',
  ),
  pattern('double-time-v1', 4, [spike(336), spike(364), spike(624), spike(652)], [72, 144]),
]);
const byId = new Map(certifiedPatterns.map((p) => [p.id, p]));
export type CompileOptions = Partial<
  Omit<
    LevelSpec,
    'chunks' | 'schemaVersion' | 'physicsVersion' | 'finishX' | 'totalTicksEstimate' | 'segmentCatalogVersion'
  >
>;
export function compilePatterns(patternIds: readonly string[], options: CompileOptions = {}): LevelSpec {
  if (patternIds.length < 1 || patternIds.length > 256) throw new Error('Pattern count is outside bounds');
  if (options.bpm !== undefined && options.bpm !== 120)
    throw new Error('Catalog requires a 120 BPM beat grid');
  const patterns = patternIds.map((id) => {
    const p = byId.get(id);
    if (!p) throw new Error(`Unknown certified pattern: ${id}`);
    return p;
  });
  let startX = 0;
  const chunks = patterns.map((p) => {
    const chunk = {
      patternId: p.id,
      startX,
      obstacleInstances: p.obstacles.map((o) => ({ ...o, x: o.x + startX })),
    };
    startX += p.width;
    return chunk;
  });
  return parseLevel({
    schemaVersion: 1,
    physicsVersion: PHYSICS_VERSION,
    segmentCatalogVersion: SEGMENT_CATALOG_VERSION,
    levelId: 'compiled-v1',
    mode: 'repo',
    displayName: 'Repository Run',
    themeId: 'aurora',
    bpm: 120,
    audioId: 'pulse-120',
    difficultyTier: 1,
    ...options,
    totalTicksEstimate: patterns.reduce((sum, p) => sum + p.durationTicks, 0),
    finishX: startX,
    chunks,
  });
}
function sameObstacle(a: Obstacle, b: Obstacle): boolean {
  return (
    a.kind === b.kind &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.variant === b.variant
  );
}
/** Never certify a forged/mutated pattern reference: the full baked geometry must match. */
export function witnessForLevel(value: LevelSpec): number[] {
  const level = parseLevel(value);
  if (
    level.physicsVersion !== PHYSICS_VERSION ||
    level.segmentCatalogVersion !== SEGMENT_CATALOG_VERSION ||
    level.bpm !== 120
  )
    throw new Error('Unsupported certification versions or beat grid');
  const result: number[] = [];
  let offset = 0;
  for (const chunk of level.chunks) {
    const p = byId.get(chunk.patternId);
    if (
      !p ||
      chunk.startX !== offset ||
      chunk.obstacleInstances.length !== p.obstacles.length ||
      !chunk.obstacleInstances.every((o, i) =>
        sameObstacle(o, { ...p.obstacles[i]!, x: p.obstacles[i]!.x + offset }),
      )
    )
      throw new Error('Level geometry does not match its certified patterns');
    result.push(...p.witness.map((tick) => tick + offset / 4));
    offset += p.width;
  }
  if (offset !== level.finishX || level.totalTicksEstimate !== offset / 4)
    throw new Error('Invalid certified level finish or duration');
  return result;
}
export function verifyLevel(level: LevelSpec): { valid: boolean; ticks: number } {
  try {
    const witness = new Set(witnessForLevel(level));
    let state = createRun(level);
    const budget = Math.min(100_000, Math.ceil(level.finishX / 4) + 1);
    for (let tick = 0; tick < budget && state.status === 'playing'; tick++)
      state = stepRun(level, state, { jumpPressed: witness.has(tick), jumpHeld: false });
    return { valid: state.status === 'completed', ticks: state.tick };
  } catch {
    return { valid: false, ticks: 0 };
  }
}

export const curatedLevels: LevelSpec[] = [
  compilePatterns(
    [
      'breath-v1',
      'single-v1',
      'single-v1',
      'double-v1',
      'breath-v1',
      'gap-v1',
      'single-v1',
      'step-v1',
      'double-v1',
    ],
    {
      levelId: 'first-light-v1',
      mode: 'arcade',
      displayName: 'First Light',
      themeId: 'aurora',
      audioId: 'first-light',
      difficultyTier: 1,
    },
  ),
  compilePatterns(
    [
      'breath-v1',
      'double-v1',
      'offbeat-v1',
      'gap-v1',
      'step-v1',
      'block-v1',
      'breath-v1',
      'offbeat-v1',
      'double-time-v1',
      'gap-v1',
      'double-v1',
    ],
    {
      levelId: 'overclock-v1',
      mode: 'arcade',
      displayName: 'Overclock',
      themeId: 'ember',
      audioId: 'overclock',
      difficultyTier: 3,
    },
  ),
  compilePatterns(
    [
      'breath-v1',
      'offbeat-v1',
      'double-time-v1',
      'step-v1',
      'twin-gap-v1',
      'block-v1',
      'breath-v1',
      'double-time-v1',
      'offbeat-v1',
      'twin-gap-v1',
      'block-v1',
      'double-time-v1',
      'offbeat-v1',
    ],
    {
      levelId: 'night-shift-v1',
      mode: 'arcade',
      displayName: 'Night Shift',
      themeId: 'violet',
      audioId: 'night-shift',
      difficultyTier: 4,
    },
  ),
];
