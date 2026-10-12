import { z } from 'zod';
import { AtomicJsonStore } from './atomic';
import { parseLevel, type LevelSpec } from '../../level-schema/src/index';
import { PHYSICS_VERSION } from '../../game/src/simulation/index';

const cachedLevelSchema = z.unknown().transform((value, context): LevelSpec => {
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 128 * 1024)
      throw new Error('Cached level too large');
    const level = parseLevel(value);
    if (level.mode !== 'repo' || level.physicsVersion !== PHYSICS_VERSION)
      throw new Error('Incompatible cached level');
    const { seed: _privateSeed, ...baked } = level;
    return baked;
  } catch {
    context.addIssue({ code: 'custom', message: 'Invalid cached repository level' });
    return z.NEVER;
  }
});
const cachedLevelsSchema = z
  .array(cachedLevelSchema)
  .max(5)
  .refine((levels) => Buffer.byteLength(JSON.stringify(levels), 'utf8') <= 512 * 1024)
  .default([]);

export const gameSettingsSchema = z
  .object({
    theme: z.enum(['signal', 'glacier', 'ember']),
    music: z.number().min(0).max(1),
    sfx: z.number().min(0).max(1),
    muted: z.boolean(),
    reducedMotion: z.boolean(),
    offline: z.boolean(),
  })
  .strict();
export const gameRecordSchema = z
  .object({
    best: z.number().min(0).max(100),
    attempts: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    completed: z.boolean(),
    ticks: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
const recordKey = z
  .string()
  .max(199)
  .refine((key) => !['__proto__', 'constructor', 'prototype'].includes(key));
export const gameSaveSchema = z
  .object({
    version: z.literal(1),
    settings: gameSettingsSchema,
    records: z.record(recordKey, gameRecordSchema).refine((records) => Object.keys(records).length <= 500),
    lastLevel: z.string().max(159),
    cachedRepoLevels: cachedLevelsSchema,
  })
  .strict();
export type GameSave = z.infer<typeof gameSaveSchema>;
export const defaultGameSave = (): GameSave => ({
  version: 1,
  settings: { theme: 'signal', music: 0.3, sfx: 0.45, muted: false, reducedMotion: false, offline: false },
  records: {},
  lastLevel: '',
  cachedRepoLevels: [],
});

/** Recover independently valid fields; never migrate an unknown/newer version. */
export function migrateGameSave(input: unknown): GameSave {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid game save');
  const source = input as Record<string, unknown>;
  if (source.version !== 1) throw new Error('Unsupported game save version; original preserved');
  const result = defaultGameSave();
  if (Array.isArray(source.cachedRepoLevels)) {
    for (const raw of source.cachedRepoLevels.slice(0, 5)) {
      const parsed = cachedLevelSchema.safeParse(raw);
      if (parsed.success) {
        const next = [...result.cachedRepoLevels, parsed.data];
        if (Buffer.byteLength(JSON.stringify(next), 'utf8') <= 512 * 1024) result.cachedRepoLevels = next;
      }
    }
  }
  if (source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings)) {
    for (const [key, schema] of Object.entries(gameSettingsSchema.shape)) {
      const parsed = schema.safeParse((source.settings as Record<string, unknown>)[key]);
      if (parsed.success) (result.settings as Record<string, unknown>)[key] = parsed.data;
    }
  }
  const lastLevel = gameSaveSchema.shape.lastLevel.safeParse(source.lastLevel);
  if (lastLevel.success) result.lastLevel = lastLevel.data;
  if (source.records && typeof source.records === 'object' && !Array.isArray(source.records)) {
    for (const [key, raw] of Object.entries(source.records).slice(0, 500)) {
      if (!recordKey.safeParse(key).success || !raw || typeof raw !== 'object' || Array.isArray(raw))
        continue;
      const record = { best: 0, attempts: 0, completed: false } as z.infer<typeof gameRecordSchema>;
      for (const [field, schema] of Object.entries(gameRecordSchema.shape)) {
        const parsed = schema.safeParse((raw as Record<string, unknown>)[field]);
        if (parsed.success && parsed.data !== undefined)
          (record as Record<string, unknown>)[field] = parsed.data;
      }
      result.records[key] = record;
    }
  }
  return gameSaveSchema.parse(result);
}

export function gameSaveStore(path: string): AtomicJsonStore<GameSave> {
  return new AtomicJsonStore(path, migrateGameSave, defaultGameSave);
}

/** Native host closes its pipe after one JSON document. This is separate from hook stdin. */
export async function readGameSaveInput(stream: AsyncIterable<Uint8Array | string>): Promise<GameSave> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new Error('Game save exceeds 2 MB limit');
    chunks.push(buffer);
  }
  return gameSaveSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
