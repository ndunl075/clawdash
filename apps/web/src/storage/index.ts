export type Settings = {
  theme: 'signal' | 'glacier' | 'ember';
  music: number;
  sfx: number;
  muted: boolean;
  reducedMotion: boolean;
  offline: boolean;
};
export type RecordEntry = { best: number; attempts: number; completed: boolean; ticks?: number };
export type Save = {
  version: 1;
  settings: Settings;
  records: Record<string, RecordEntry>;
  lastLevel: string;
};
const defaults = (): Save => ({
  version: 1,
  settings: {
    theme: 'signal',
    music: 0.3,
    sfx: 0.45,
    muted: false,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    offline: false,
  },
  records: {},
  lastLevel: '',
});
let database: Promise<IDBDatabase> | undefined;
let readOnly = false;
function db(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Storage unavailable'));
      return;
    }
    const r = indexedDB.open('clawdash-local', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('saves');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export async function loadSave(): Promise<Save> {
  const result = defaults();
  try {
    let raw: unknown;
    if ('__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      raw = await invoke<unknown>('load_save');
    } else {
      const d = await db();
      raw = await new Promise((resolve, reject) => {
        const r = d.transaction('saves').objectStore('saves').get('v1');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    if (raw === undefined || raw === null) return result;
    if (typeof raw !== 'object') {
      readOnly = true;
      return result;
    }
    const v = raw as Partial<Save>;
    if (v.version !== 1) {
      // Preserve an unknown/newer save verbatim instead of replacing it during startup.
      readOnly = true;
      return result;
    }
    const s = v.settings;
    if (s) {
      if (['signal', 'glacier', 'ember'].includes(s.theme)) result.settings.theme = s.theme;
      for (const key of ['music', 'sfx'] as const)
        if (Number.isFinite(s[key])) result.settings[key] = Math.max(0, Math.min(1, s[key]));
      for (const key of ['muted', 'reducedMotion', 'offline'] as const)
        if (typeof s[key] === 'boolean') result.settings[key] = s[key];
    }
    if (typeof v.lastLevel === 'string' && v.lastLevel.length < 160) result.lastLevel = v.lastLevel;
    if (v.records && typeof v.records === 'object')
      for (const [key, r] of Object.entries(v.records).slice(0, 500)) {
        if (key.length < 200 && r && Number.isFinite(r.best) && Number.isFinite(r.attempts))
          result.records[key] = {
            best: Math.max(0, Math.min(100, r.best)),
            attempts: Math.max(0, Math.floor(r.attempts)),
            completed: r.completed === true,
            ...(Number.isFinite(r.ticks) ? { ticks: r.ticks } : {}),
          };
      }
  } catch {
    // A failed read must not replace a damaged or inaccessible existing save.
    readOnly = true;
  }
  return result;
}
export async function persist(save: Save): Promise<boolean> {
  if (readOnly) return false;
  try {
    if ('__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('persist_save', { save });
      return true;
    }
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const t = d.transaction('saves', 'readwrite');
      t.objectStore('saves').put(save, 'v1');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    return true;
  } catch {
    return false;
  }
}
