import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { curatedLevels } from '../../packages/level-content/src/index';
import {
  defaultGameSave,
  migrateGameSave,
  gameSaveStore,
  readGameSaveInput,
} from '../../packages/storage/src/game-save';

describe('Native game save boundary', () => {
  it('supports the native CLI stdin/stdout protocol without replacing invalid files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clawdash-storage-cli-'));
    const cli = (command: string, input?: string) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(createRequire(resolve('package.json')).resolve('tsx')).href,
            resolve('packages/cli/src/index.ts'),
            command,
          ],
          {
            env: { ...process.env, CLAWDASH_HOME: home },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          },
        );
        let stdout = '',
          stderr = '';
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('error', reject);
        child.on('close', (code) => done({ code, stdout, stderr }));
        child.stdin.end(input);
      });
    try {
      const initial = await cli('storage-load');
      expect(initial.code, initial.stderr).toBe(0);
      expect(JSON.parse(initial.stdout)).toEqual(defaultGameSave());
      const save = { ...defaultGameSave(), lastLevel: 'night-shift' };
      const saved = await cli('storage-save', JSON.stringify(save));
      expect(saved.code).toBe(0);
      expect(JSON.parse(saved.stdout)).toEqual(save);
      const original = await readFile(join(home, 'game-save.json'), 'utf8');
      const malformed = await cli('storage-save', '{broken');
      expect(malformed.code).toBe(1);
      expect(await readFile(join(home, 'game-save.json'), 'utf8')).toBe(original);
      expect(JSON.parse((await cli('storage-load')).stdout)).toEqual(save);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it('validates writes strictly and recovers each settings/record field on load', async () => {
    const save = defaultGameSave();
    expect(await readGameSaveInput(Readable.from([JSON.stringify(save)]))).toEqual(save);
    await expect(readGameSaveInput(Readable.from(['{bad']))).rejects.toThrow();
    await expect(
      readGameSaveInput(
        Readable.from([JSON.stringify({ ...save, settings: { ...save.settings, music: 2 } })]),
      ),
    ).rejects.toThrow();
    await expect(readGameSaveInput(Readable.from([' '.repeat(2_000_001)]))).rejects.toThrow('2 MB');
    const recovered = migrateGameSave({
      version: 1,
      settings: { music: 'bad', sfx: 0.7, theme: 'ember', muted: true },
      lastLevel: 'night',
      records: {
        good: { best: 80, attempts: 2, completed: true, ticks: 400 },
        partial: { best: -1, attempts: 4.2, completed: true, ticks: -9 },
        bad: null,
      },
    });
    expect(recovered.settings).toMatchObject({ music: 0.3, sfx: 0.7, theme: 'ember', muted: true });
    expect(recovered.records.good).toEqual({ best: 80, attempts: 2, completed: true, ticks: 400 });
    expect(recovered.records.partial).toEqual({ best: 0, attempts: 0, completed: true });
    expect(recovered.records.bad).toBeUndefined();
    expect(() => migrateGameSave({ ...save, version: 2 })).toThrow('Unsupported');
    const repo = { ...curatedLevels[0], mode: 'repo' as const, seed: 'PRIVATE' };
    expect(
      migrateGameSave({ ...save, cachedRepoLevels: [repo, { ...repo, physicsVersion: 'future' }, null] })
        .cachedRepoLevels,
    ).toHaveLength(1);
    const cached = await readGameSaveInput(
      Readable.from([JSON.stringify({ ...save, cachedRepoLevels: [repo] })]),
    );
    expect(cached.cachedRepoLevels[0].seed).toBeUndefined();
    await expect(
      readGameSaveInput(Readable.from([JSON.stringify({ ...save, cachedRepoLevels: Array(6).fill(repo) })])),
    ).rejects.toThrow();
  });
  it('serializes writers and preserves malformed/newer originals and backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clawdash-native-save-')),
      path = join(dir, 'game-save.json');
    try {
      const first = gameSaveStore(path),
        second = gameSaveStore(path);
      expect(await first.load()).toEqual(defaultGameSave());
      await Promise.all([
        first.update((v) => ({ ...v, lastLevel: 'first' })),
        second.update((v) => ({ ...v, settings: { ...v.settings, muted: true } })),
      ]);
      expect(await first.load()).toMatchObject({ lastLevel: 'first', settings: { muted: true } });
      const backup = await readFile(`${path}.backup`, 'utf8');
      const data = { ...defaultGameSave(), version: 2 },
        future = JSON.stringify({
          version: 1,
          data,
          checksum: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
        });
      await writeFile(path, future);
      await expect(first.load()).rejects.toThrow('Unsupported');
      await expect(first.update(() => defaultGameSave())).rejects.toThrow('Unsupported');
      expect(await readFile(path, 'utf8')).toBe(future);
      expect(await readFile(`${path}.backup`, 'utf8')).toBe(backup);
      await writeFile(path, '{corrupt');
      await expect(first.load()).rejects.toThrow();
      await expect(first.update(() => defaultGameSave())).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe('{corrupt');
      expect(await readFile(`${path}.backup`, 'utf8')).toBe(backup);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
