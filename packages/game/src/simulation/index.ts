import { parseLevel, type LevelSpec, type Obstacle } from '../../../level-schema/src/index';

export const PHYSICS_VERSION = 'clawdash-physics-1';
export const PHYSICS = Object.freeze({
  ticksPerSecond: 60,
  scale: 1000,
  size: 28,
  speed: 4,
  gravity: 0.65,
  jump: 11,
  bufferTicks: 3,
  coyoteTicks: 2,
});
const SCALE = PHYSICS.scale;
export type TickInput = { jumpPressed: boolean; jumpHeld: boolean };
type FixedState = Readonly<{ x: number; y: number; vy: number; buffer: number; coyote: number }>;
export type Checkpoint = Readonly<{
  tick: number;
  fixed: FixedState;
  levelId: string;
  physicsVersion: string;
}>;
export type RunState = Readonly<{
  tick: number;
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  status: 'playing' | 'dead' | 'completed';
  attempt: number;
  progress: number;
  practice: boolean;
  checkpoint?: Checkpoint;
  readonly fixed: FixedState;
}>;
type World = { grid: Map<number, Obstacle[]>; gaps: Obstacle[] };
const worlds = new WeakMap<LevelSpec, World>();
const CELL = 128;
function worldFor(level: LevelSpec): World {
  let world = worlds.get(level);
  if (world) return world;
  if (level.physicsVersion !== PHYSICS_VERSION) throw new Error('Unsupported physics version');
  parseLevel(level);
  const obstacles = level.chunks
    .flatMap((c) => c.obstacleInstances)
    .sort((a, b) => a.x - b.x || a.y - b.y || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  const grid = new Map<number, Obstacle[]>();
  for (const obstacle of obstacles) {
    for (
      let cell = Math.floor(obstacle.x / CELL);
      cell <= Math.floor((obstacle.x + obstacle.width) / CELL);
      cell++
    ) {
      const bucket = grid.get(cell) ?? [];
      bucket.push(obstacle);
      grid.set(cell, bucket);
    }
  }
  world = { grid, gaps: obstacles.filter((o) => o.kind === 'gap') };
  worlds.set(level, world);
  return world;
}
function nearby(world: World, x0: number, x1: number): Obstacle[] {
  const result = new Set<Obstacle>();
  for (let i = Math.floor(x0 / CELL); i <= Math.floor((x1 + PHYSICS.size) / CELL); i++)
    for (const obstacle of world.grid.get(i) ?? []) result.add(obstacle);
  return [...result];
}
function hasGround(world: World, x: number): boolean {
  const center = x + PHYSICS.size / 2;
  return !world.gaps.some((gap) => center >= gap.x && center < gap.x + gap.width);
}
function snapshot(
  level: LevelSpec,
  fixed: FixedState,
  rest: Omit<RunState, 'x' | 'y' | 'vy' | 'progress' | 'fixed'>,
): RunState {
  return Object.freeze({
    ...rest,
    x: fixed.x / SCALE,
    y: fixed.y / SCALE,
    vy: fixed.vy / SCALE,
    progress: Math.max(0, Math.min(100, (fixed.x / SCALE / level.finishX) * 100)),
    fixed: Object.freeze(fixed),
  });
}
export function createRun(level: LevelSpec, practice = false): RunState {
  const world = worldFor(level);
  return snapshot(
    level,
    { x: 0, y: 0, vy: 0, buffer: 0, coyote: 2 },
    { tick: 0, grounded: hasGround(world, 0), status: 'playing', attempt: 1, practice },
  );
}

/** Continuous SAT: moving axis-aligned body against a static convex collider.
 * Position math is fixed point; SAT only compares normalized collision times.
 * Art rotation never changes the body. Axes and contacts have stable order.
 */
function sweptPolygon(
  x: number,
  y: number,
  dx: number,
  dy: number,
  vertices: ReadonlyArray<readonly [number, number]>,
): boolean {
  const axes: Array<readonly [number, number]> = [
    [1, 0],
    [0, 1],
  ];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!,
      b = vertices[(i + 1) % vertices.length]!;
    axes.push([-(b[1] - a[1]), b[0] - a[0]]);
  }
  let entry = 0,
    exit = 1;
  for (const [ax, ay] of axes) {
    const projections = vertices.map(([vx, vy]) => vx * ax + vy * ay);
    const low = Math.min(...projections),
      high = Math.max(...projections);
    const origin = x * ax + y * ay;
    const bodyLow = origin + Math.min(0, PHYSICS.size * ax) + Math.min(0, PHYSICS.size * ay);
    const bodyHigh = origin + Math.max(0, PHYSICS.size * ax) + Math.max(0, PHYSICS.size * ay);
    const velocity = dx * ax + dy * ay;
    if (velocity === 0) {
      if (bodyHigh <= low || bodyLow >= high) return false;
      continue;
    }
    const a = (low - bodyHigh) / velocity,
      b = (high - bodyLow) / velocity;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry >= exit) return false;
  }
  return exit > 0 && entry < 1;
}
function spikeHit(obstacle: Obstacle, x: number, y: number, dx: number, dy: number): boolean {
  // 2px forgiving inset; use a true triangle, not the art's bounding rectangle.
  const inset = Math.min(2, obstacle.width / 8, obstacle.height / 8);
  return sweptPolygon(x, y, dx, dy, [
    [obstacle.x + inset, obstacle.y + inset],
    [obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height - inset],
    [obstacle.x + obstacle.width - inset, obstacle.y + inset],
  ]);
}

export function stepRun(level: LevelSpec, state: RunState, input: TickInput): RunState {
  if (state.status !== 'playing') return state;
  const world = worldFor(level);
  let { x, y, vy, buffer, coyote } = state.fixed;
  buffer = input.jumpPressed ? PHYSICS.bufferTicks : Math.max(0, buffer - 1);
  coyote = state.grounded ? PHYSICS.coyoteTicks : Math.max(0, coyote - 1);
  if ((buffer > 0 || input.jumpHeld) && (state.grounded || coyote > 0)) {
    vy = PHYSICS.jump * SCALE;
    buffer = 0;
    coyote = 0;
  }
  vy -= PHYSICS.gravity * SCALE;
  const oldX = x / SCALE,
    oldY = y / SCALE;
  x += PHYSICS.speed * SCALE;
  y += vy;
  let grounded = false,
    dead = false;
  const obstacles = nearby(world, oldX, x / SCALE);
  // First resolve safe top/underside contacts, then lethal side contacts, then spikes.
  const solids = obstacles.filter((o) => o.kind === 'platform' || o.kind === 'block');
  const horizontalOverlap = (o: Obstacle, px: number) => px + PHYSICS.size > o.x && px < o.x + o.width;
  let landing = -Infinity;
  for (const obstacle of solids) {
    const top = obstacle.kind === 'platform' ? obstacle.y : obstacle.y + obstacle.height;
    if (vy <= 0 && oldY >= top && y / SCALE <= top) {
      const t = oldY === y / SCALE ? 0 : (oldY - top) / (oldY - y / SCALE);
      if (horizontalOverlap(obstacle, oldX + PHYSICS.speed * t)) landing = Math.max(landing, top);
    }
  }
  if (vy <= 0 && oldY >= 0 && y <= 0 && hasGround(world, x / SCALE)) landing = Math.max(landing, 0);
  if (landing !== -Infinity) {
    y = Math.round(landing * SCALE);
    vy = 0;
    grounded = true;
  }
  for (const obstacle of solids) {
    const top = obstacle.kind === 'platform' ? obstacle.y : obstacle.y + obstacle.height;
    const bottom = obstacle.kind === 'platform' ? obstacle.y - obstacle.height : obstacle.y;
    if (oldY >= top && y / SCALE >= top) continue;
    if (
      vy > 0 &&
      oldY + PHYSICS.size <= bottom &&
      y / SCALE + PHYSICS.size >= bottom &&
      horizontalOverlap(obstacle, x / SCALE)
    ) {
      y = Math.round((bottom - PHYSICS.size) * SCALE);
      vy = 0;
      continue;
    }
    if (
      sweptPolygon(oldX, oldY, x / SCALE - oldX, y / SCALE - oldY, [
        [obstacle.x, bottom],
        [obstacle.x + obstacle.width, bottom],
        [obstacle.x + obstacle.width, top],
        [obstacle.x, top],
      ])
    )
      dead = true;
  }
  for (const obstacle of obstacles)
    if (obstacle.kind === 'spike' && spikeHit(obstacle, oldX, oldY, x / SCALE - oldX, y / SCALE - oldY))
      dead = true;
  if (y < -160 * SCALE) dead = true;
  const status = dead ? 'dead' : x / SCALE >= level.finishX ? 'completed' : 'playing';
  return snapshot(
    level,
    { x, y, vy, buffer, coyote },
    {
      tick: state.tick + 1,
      grounded,
      status,
      attempt: state.attempt,
      practice: state.practice,
      ...(state.checkpoint ? { checkpoint: state.checkpoint } : {}),
    },
  );
}
export function restartRun(level: LevelSpec, state: RunState): RunState {
  return Object.freeze({ ...createRun(level, state.practice), attempt: state.attempt + 1 });
}
export function setCheckpoint(level: LevelSpec, state: RunState): RunState {
  if (!state.practice || state.status !== 'playing' || !state.grounded) return state;
  // Only neutral ground may be checkpointed; keep a short readable recovery zone.
  const world = worldFor(level);
  if (
    !Number.isInteger(state.tick) ||
    state.tick < 0 ||
    state.tick > 100_000 ||
    !Object.values(state.fixed).every(Number.isSafeInteger) ||
    state.fixed.x < 0 ||
    state.fixed.x >= level.finishX * SCALE ||
    state.fixed.y !== 0 ||
    state.fixed.vy !== 0 ||
    state.y !== 0 ||
    !hasGround(world, state.x) ||
    !hasGround(world, state.x + 24) ||
    nearby(world, state.x, state.x + 24).some(
      (o) =>
        o.kind !== 'decoration' &&
        o.kind !== 'gap' &&
        sweptPolygon(state.x, state.y, 24, 0, [
          [o.x, 0],
          [o.x + o.width, 0],
          [o.x + o.width, Math.max(o.y + o.height, 1)],
          [o.x, Math.max(o.y + o.height, 1)],
        ]),
    )
  )
    return state;
  const checkpoint = Object.freeze({
    tick: state.tick,
    fixed: Object.freeze({ ...state.fixed, vy: 0, buffer: 0, coyote: 2 }),
    levelId: level.levelId,
    physicsVersion: PHYSICS_VERSION,
  });
  return Object.freeze({ ...state, checkpoint });
}
export function restoreCheckpoint(level: LevelSpec, state: RunState): RunState {
  const checkpoint = state.checkpoint;
  if (
    !state.practice ||
    !checkpoint ||
    checkpoint.levelId !== level.levelId ||
    checkpoint.physicsVersion !== PHYSICS_VERSION
  )
    return restartRun(level, state);
  const restored = snapshot(
    level,
    { ...checkpoint.fixed },
    { tick: checkpoint.tick, grounded: true, status: 'playing', attempt: state.attempt + 1, practice: true },
  );
  const validated = setCheckpoint(level, restored);
  return validated.checkpoint ? validated : restartRun(level, state);
}
