import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalJson,
  seededRandom,
  inspectRepository,
  generateRepoLevel,
  exportChallenge,
  fingerprintDescriptor,
} from './index';
import { verifyLevel } from '../../level-content/src/index';

describe('canonical data and PRNG', () => {
  it('sorts keys, normalizes Unicode/newlines and rejects floats', () => {
    expect(canonicalJson({ z: 'e\u0301\r\n', a: 1 })).toBe('{"a":1,"z":"é\\n"}');
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => canonicalJson(0.3)).toThrow();
  });
  it('matches xoshiro128** published state transition vectors', () => {
    const next = seededRandom('00000001000000020000000300000004' + '0'.repeat(32));
    expect([next(), next(), next()].map((v) => v * 4294967296)).toEqual([11520, 0, 5927040]);
  });
});

describe('committed metadata and playable generation', () => {
  it('ignores dirty contents, bounds summaries, never leaks sentinel paths into challenges', async () => {
    const path = await mkdtemp(join(tmpdir(), 'clawdash-git-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
        cwd: path,
        windowsHide: true,
        stdio: 'pipe',
      });
    try {
      git('init');
      await mkdir(join(path, 'src'));
      await writeFile(join(path, 'src', 'PRIVATE_SENTINEL.ts'), 'SECRET_DO_NOT_READ');
      await writeFile(
        join(path, 'package.json'),
        JSON.stringify({ scripts: { prepare: 'DO_NOT_EXECUTE' }, dependencies: { zod: '^4' } }),
      );
      git('add', '.');
      git('commit', '-m', 'private message never collected');
      const marker = join(path, '.git', 'fsmonitor-executed');
      const monitor = join(path, '.git', 'monitor.cjs');
      await writeFile(monitor, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
      git(
        'config',
        'core.fsmonitor',
        `"${process.execPath.replace(/\\/g, '/')}" "${monitor.replace(/\\/g, '/')}"`,
      );
      const first = await inspectRepository(path);
      await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(first.publicAggregates.dependencyCount).toBe(1);
      await writeFile(join(path, 'src', 'PRIVATE_SENTINEL.ts'), 'DIRTY_PRIVATE_CONTENT');
      const second = await inspectRepository(path);
      expect(second.publicAggregates.dirty).toBe(true);
      expect(second.fingerprint).toBe(first.fingerprint);
      const level = generateRepoLevel(first);
      expect(level.generatorVersion).toBe('repo-v2');
      expect(level.levelId).toMatch(/^repo-v2-[a-f0-9]{20}$/);
      expect(generateRepoLevel(second)).toEqual(level);
      expect(verifyLevel(level).valid).toBe(true);
      const exported = exportChallenge(level);
      for (const privateValue of [
        'PRIVATE_SENTINEL',
        'SECRET_DO_NOT_READ',
        first.snapshotId,
        first.fingerprint,
        path,
        'DO_NOT_EXECUTE',
      ])
        expect(exported).not.toContain(privateValue);
      for (let i = 0; i < 128; i++) {
        const descriptor = { ...first, snapshotId: i.toString(16).padStart(40, '0') };
        descriptor.fingerprint = fingerprintDescriptor(descriptor);
        expect(verifyLevel(generateRepoLevel(descriptor, ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5)).valid).toBe(
          true,
        );
      }
      const remoteMarker = join(path, '.git', 'remote-executed');
      const remoteHelper = join(path, '.git', 'remote-helper.cjs');
      await writeFile(
        remoteHelper,
        `require('node:fs').writeFileSync(${JSON.stringify(remoteMarker)}, 'executed'); process.exit(1);`,
      );
      git(
        'config',
        'core.sshCommand',
        `"${process.execPath.replace(/\\/g, '/')}" "${remoteHelper.replace(/\\/g, '/')}"`,
      );
      git('config', 'remote.origin.url', 'ssh://fixture.invalid/private');
      git('config', 'remote.origin.promisor', 'true');
      const manifestObject = first.entries.find((entry) => entry.path === 'package.json')!.object;
      await rm(join(path, '.git', 'objects', manifestObject.slice(0, 2), manifestObject.slice(2)));
      await expect(inspectRepository(path)).rejects.toThrow('complete local clone');
      git('config', '--unset', 'remote.origin.promisor');
      await expect(inspectRepository(path)).rejects.toThrow('Cannot inspect');
      await expect(stat(remoteMarker)).rejects.toMatchObject({ code: 'ENOENT' });
      await writeFile(join(path, '.git', 'shallow'), first.snapshotId + '\n');
      await expect(inspectRepository(path)).rejects.toThrow('full repository history');
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });
});
