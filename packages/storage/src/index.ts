import { z } from 'zod';
export const userSettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  musicVolume: z.number().min(0).max(1).default(0.5),
  effectsVolume: z.number().min(0).max(1).default(0.6),
  reducedMotion: z.boolean().default(false),
  themeId: z.string().max(64).default('first-light'),
  autoOpenAgentRun: z.boolean().default(false),
  focusOnAutoOpen: z.boolean().default(false),
  alwaysOnTop: z.boolean().default(false),
  lastMode: z.enum(['arcade', 'repo', 'agent']).default('arcade'),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;
export const defaultSettings = (): UserSettings => userSettingsSchema.parse({});
export function migrateSettings(input: unknown): UserSettings {
  if (!input || typeof input !== 'object') throw new Error('Invalid saved settings');
  const data = input as Record<string, unknown>;
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1)
    throw new Error('Unsupported settings version');
  const result: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(userSettingsSchema.shape)) {
    const parsed = schema.safeParse(data[key]);
    result[key] = parsed.success ? parsed.data : schema.parse(undefined);
  }
  return userSettingsSchema.parse(result);
}

export const levelProgressSchema = z.object({
  attemptsNormal: z.number().int().min(0).max(1_000_000).default(0),
  attemptsPractice: z.number().int().min(0).max(1_000_000).default(0),
  bestNormalPercent: z.number().min(0).max(100).default(0),
  bestPracticePercent: z.number().min(0).max(100).default(0),
  completedNormal: z.boolean().default(false),
  completedPractice: z.boolean().default(false),
  bestCompletionTicks: z.number().int().positive().max(10_000_000).optional(),
  updatedAt: z.iso.datetime(),
});
export type LevelProgress = z.infer<typeof levelProgressSchema>;
export type SavedProgress = { schemaVersion: 1; levels: Record<string, LevelProgress> };
export const defaultProgress = (): SavedProgress => ({ schemaVersion: 1, levels: {} });
export const progressKey = (levelId: string, physicsVersion: string) => `${levelId}:${physicsVersion}`;
export function migrateProgress(input: unknown): SavedProgress {
  if (!input || typeof input !== 'object' || (input as { schemaVersion?: unknown }).schemaVersion !== 1)
    throw new Error('Unsupported progress version');
  const levels = (input as { levels?: unknown }).levels;
  if (!levels || typeof levels !== 'object' || Array.isArray(levels) || Object.keys(levels).length > 2000)
    throw new Error('Invalid progress');
  const result = defaultProgress();
  for (const [key, value] of Object.entries(levels)) {
    if (key.length > 256 || !value || typeof value !== 'object') continue;
    const record: Record<string, unknown> = {};
    for (const [field, schema] of Object.entries(levelProgressSchema.shape)) {
      const parsed = schema.safeParse((value as Record<string, unknown>)[field]);
      if (parsed.success) record[field] = parsed.data;
      else if (field === 'updatedAt') record[field] = '1970-01-01T00:00:00.000Z';
      else record[field] = schema.parse(undefined);
    }
    result.levels[key] = levelProgressSchema.parse(record);
  }
  return result;
}
export function recordRun(
  progress: SavedProgress,
  key: string,
  run: { practice: boolean; percent: number; completed: boolean; ticks: number },
): SavedProgress {
  if (
    !Number.isFinite(run.percent) ||
    run.percent < 0 ||
    run.percent > 100 ||
    !Number.isInteger(run.ticks) ||
    run.ticks < 0
  )
    throw new Error('Invalid run');
  const old = progress.levels[key] ?? levelProgressSchema.parse({ updatedAt: new Date().toISOString() }),
    next = { ...old, updatedAt: new Date().toISOString() };
  if (run.practice) {
    next.attemptsPractice++;
    next.bestPracticePercent = Math.max(old.bestPracticePercent, run.percent);
    next.completedPractice ||= run.completed;
  } else {
    next.attemptsNormal++;
    next.bestNormalPercent = Math.max(old.bestNormalPercent, run.percent);
    next.completedNormal ||= run.completed;
    if (run.completed && run.ticks > 0)
      next.bestCompletionTicks = Math.min(old.bestCompletionTicks ?? Infinity, run.ticks);
  }
  return { ...progress, levels: { ...progress.levels, [key]: levelProgressSchema.parse(next) } };
}
