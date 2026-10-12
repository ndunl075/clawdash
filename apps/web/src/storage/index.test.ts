import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { curatedLevels } from '../../../../packages/level-content/src/index';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());
it('uses the native atomic save boundary on desktop without opening IndexedDB', async () => {
  const store = await import('./index');
  invoke.mockResolvedValueOnce(null);
  const save = await store.loadSave();
  expect(invoke).toHaveBeenCalledWith('load_save');
  invoke.mockResolvedValueOnce(undefined);
  expect(await store.persist(save)).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith('persist_save', { save });
});
it('preserves an existing native save when loading fails', async () => {
  const store = await import('./index');
  invoke.mockRejectedValueOnce(new Error('damaged save'));
  const save = await store.loadSave();
  expect(await store.persist(save)).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it('preserves unknown native schemas instead of overwriting them', async () => {
  const store = await import('./index');
  invoke.mockResolvedValueOnce({ version: 55, original: true });
  const save = await store.loadSave();
  expect(await store.persist(save)).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it('migrates known legacy curated scores once and retains unknown legacy IDs', async () => {
  const store = await import('./index');
  const level = curatedLevels[0]!;
  const legacyKey = `${level.levelId}:normal`;
  const migratedKey = `${level.levelId}:${level.physicsVersion}:normal`;
  const record = { best: 34, attempts: 4, completed: false };
  invoke.mockResolvedValueOnce({
    version: 1,
    records: { [legacyKey]: record, 'unidentified-repo:normal': record },
  });
  const save = await store.loadSave();
  expect(save.records[migratedKey]).toEqual(record);
  expect(save.records[legacyKey]).toBeUndefined();
  expect(save.records['unidentified-repo:normal']).toEqual(record);
  invoke.mockResolvedValueOnce(save);
  expect((await store.loadSave()).records[migratedKey]?.attempts).toBe(4);
});
