import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const LEVEL_LIMITS = { chunks: 256, obstacles: 4096, finishX: 250_000, bytes: 1_000_000 } as const;
const coordinate = z.number().finite().min(0).max(LEVEL_LIMITS.finishX);
const identifier = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
export const obstacleSchema = z
  .object({
    kind: z.enum(['spike', 'platform', 'gap', 'block', 'decoration']),
    x: coordinate,
    y: z.number().finite().min(0).max(2000),
    width: z.number().finite().positive().max(4000),
    height: z.number().finite().positive().max(2000),
    variant: identifier.optional(),
  })
  .strict();
export const chunkSchema = z
  .object({
    patternId: identifier,
    startX: coordinate,
    obstacleInstances: z.array(obstacleSchema).max(128),
  })
  .strict();
export const levelSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    physicsVersion: identifier,
    generatorVersion: identifier.optional(),
    segmentCatalogVersion: identifier.optional(),
    levelId: identifier,
    mode: z.enum(['arcade', 'repo']),
    displayName: z
      .string()
      .min(1)
      .max(80)
      .refine((s) => !/[\u0000-\u001f]/.test(s)),
    seed: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .optional(),
    themeId: identifier,
    bpm: z.number().finite().min(40).max(240),
    audioId: identifier,
    totalTicksEstimate: z.number().int().min(1).max(100_000),
    finishX: coordinate.refine((x) => x >= 120),
    difficultyTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    chunks: z.array(chunkSchema).min(1).max(LEVEL_LIMITS.chunks),
  })
  .strict()
  .superRefine((level, context) => {
    let count = 0;
    let previous = -1;
    for (const chunk of level.chunks) {
      count += chunk.obstacleInstances.length;
      if (chunk.startX < previous || chunk.startX >= level.finishX)
        context.addIssue({ code: 'custom', message: 'Chunks must be ordered inside the level' });
      previous = chunk.startX;
      for (const obstacle of chunk.obstacleInstances) {
        // Instance coordinates are absolute world pixels, including inside compiled chunks.
        if (obstacle.x < chunk.startX || obstacle.x + obstacle.width > level.finishX)
          context.addIssue({ code: 'custom', message: 'Obstacle is outside its level/chunk boundary' });
        if (obstacle.kind === 'gap' && obstacle.y !== 0)
          context.addIssue({ code: 'custom', message: 'Gaps must begin at ground altitude' });
      }
    }
    if (count > LEVEL_LIMITS.obstacles) context.addIssue({ code: 'custom', message: 'Too many obstacles' });
  });

export type Obstacle = z.infer<typeof obstacleSchema>;
export type LevelChunk = z.infer<typeof chunkSchema>;
export type LevelSpec = z.infer<typeof levelSchema>;

/** Every imported artifact crosses this strict, bounded data-only boundary. */
export function parseLevel(value: unknown): LevelSpec {
  if (typeof value === 'string') {
    if (value.length > LEVEL_LIMITS.bytes || new TextEncoder().encode(value).byteLength > LEVEL_LIMITS.bytes)
      throw new Error('Level exceeds import byte limit');
    value = JSON.parse(value) as unknown;
  }
  return levelSchema.parse(value);
}
