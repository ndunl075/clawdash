import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, delimiter, isAbsolute } from 'node:path';
import {
  compilePatterns,
  certifiedPatterns,
  verifyLevel,
  SEGMENT_CATALOG_VERSION,
} from '../../level-content/src/index';
import type { LevelSpec } from '../../level-schema/src/index';
import { PHYSICS_VERSION } from '../../game/src/simulation/index';

export const GENERATOR_VERSION = 'repo-v2';
export const CATALOG_VERSION = SEGMENT_CATALOG_VERSION;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_MANIFESTS = 24;
const exclusions = new Set([
  'node_modules',
  'dist',
  'build',
  'vendor',
  '.git',
  'coverage',
  'target',
  '.next',
]);
export interface RepoAggregates {
  fileCount: number;
  directoryCount: number;
  maxDepth: number;
  commitCount: number;
  dependencyCount: number;
  testFileCount: number;
  languages: Record<string, number>;
  dirty: boolean;
}
export interface RepoDescriptor {
  version: typeof GENERATOR_VERSION;
  snapshotId: string;
  entries: { mode: string; object: string; path: string }[];
  manifests: { path: string; dependencies: string[] }[];
  publicAggregates: RepoAggregates;
  fingerprint: string;
}

/** Bytewise key sorting, NFC strings and finite integer JSON; no locale-dependent operations. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC').replace(/\r\n?/g, '\n'));
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${canonicalJson(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  throw new Error('Unsupported canonical value');
}
export function fingerprintDescriptor(descriptor: Omit<RepoDescriptor, 'fingerprint'>): string {
  // Dirty state is informative only, never part of committed-snapshot identity.
  const { dirty: _dirty, ...aggregates } = descriptor.publicAggregates;
  return createHash('sha256')
    .update(
      canonicalJson({
        version: descriptor.version,
        snapshotId: descriptor.snapshotId,
        entries: descriptor.entries,
        manifests: descriptor.manifests,
        publicAggregates: aggregates,
      }),
    )
    .digest('hex');
}

/** xoshiro128** with explicit big-endian seed words, unsigned 32-bit transitions. */
export function seededRandom(seed: string): () => number {
  if (!/^[a-f0-9]{64}$/.test(seed)) throw new Error('Invalid seed');
  const s = [0, 1, 2, 3].map((i) => Number.parseInt(seed.slice(i * 8, i * 8 + 8), 16) >>> 0);
  if (s.reduce((a, b) => a | b, 0) === 0) s[0] = 1;
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result / 4294967296;
  };
}

let trustedGit: string | undefined;
export async function resolveGitExecutable(): Promise<string> {
  if (trustedGit) return trustedGit;
  // Search only absolute PATH entries, never a repository's working directory.
  for (const directory of (process.env.PATH ?? '').split(delimiter).slice(0, 128)) {
    if (!isAbsolute(directory) || (process.platform === 'win32' && directory.startsWith('\\\\'))) continue;
    const candidate = join(directory, process.platform === 'win32' ? 'git.exe' : 'git');
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      trustedGit = await realpath(candidate);
      return trustedGit;
    } catch {
      /* Continue through the trusted process PATH. */
    }
  }
  throw new Error('Git is unavailable. Install Git and restart the companion.');
}
async function gitBounded(
  cwd: string,
  args: string[],
  maxBuffer = MAX_BYTES,
  deadline = Date.now() + 6000,
): Promise<Buffer> {
  const executable = await resolveGitExecutable();
  return new Promise((resolveOutput, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new Error('Repository inspection exceeded its 15-second budget.'));
      return;
    }
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
    );
    execFile(
      executable,
      ['--no-optional-locks', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', ...args],
      {
        cwd,
        windowsHide: true,
        timeout: Math.min(6000, remaining),
        maxBuffer,
        encoding: 'buffer',
        env: {
          ...environment,
          GIT_TERMINAL_PROMPT: '0',
          GIT_NO_REPLACE_OBJECTS: '1',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_NO_LAZY_FETCH: '1',
          GIT_ALLOW_PROTOCOL: '',
        },
      },
      (error, stdout) =>
        error
          ? reject(
              new Error(
                'Cannot inspect this committed repository. Check Git, permissions and repository size.',
              ),
            )
          : resolveOutput(stdout),
    );
  });
}
const extensions: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  cs: 'C#',
  java: 'Java',
  cpp: 'C++',
  c: 'C',
  css: 'CSS',
  html: 'HTML',
  md: 'Markdown',
};
export async function inspectRepository(directory: string): Promise<RepoDescriptor> {
  const deadline = Date.now() + 15000;
  const git = (cwd: string, args: string[], maxBuffer = MAX_BYTES) =>
    gitBounded(cwd, args, maxBuffer, deadline);
  const root = await realpath(resolve(directory));
  const reported = (await git(root, ['rev-parse', '--show-toplevel'])).toString('utf8').trim();
  if ((await realpath(reported)) !== root) throw new Error('Choose the repository root folder.');
  const snapshotId = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).toString('ascii').trim();
  if (!/^[a-f0-9]{40,64}$/.test(snapshotId))
    throw new Error('Make an initial commit before generating a Repo Run.');
  if ((await git(root, ['rev-parse', '--is-shallow-repository'], 64)).toString('ascii').trim() === 'true')
    throw new Error('Fetch full repository history before generating a reproducible Repo Run.');
  const partial = await git(
    root,
    ['config', '--local', '--get-regexp', '^(extensions\\.partialclone|remote\\..*\\.promisor)$'],
    4096,
  ).catch(() => Buffer.alloc(0));
  if (partial.length)
    throw new Error('Use a complete local clone; partial-clone network fetching is disabled.');
  const tree = (await git(root, ['ls-tree', '-rz', '--full-tree', snapshotId])).toString('utf8');
  const records = tree.split('\0').filter(Boolean);
  if (records.length > MAX_FILES)
    throw new Error('Repository exceeds the 20,000 tracked-entry inspection limit.');
  const entries: RepoDescriptor['entries'] = [];
  const directories = new Set<string>();
  const languages: Record<string, number> = {};
  let maxDepth = 0,
    testFileCount = 0;
  for (const record of records) {
    const match = /^([0-7]{6}) (blob|commit) ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error('Unsupported Git tree record.');
    const [, mode, , object, rawPath] = match;
    const path = rawPath.normalize('NFC');
    const parts = path.split('/');
    if (parts.some((part) => exclusions.has(part.toLowerCase()))) continue;
    entries.push({ mode, object, path });
    maxDepth = Math.max(maxDepth, parts.length - 1);
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
    const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
    const language = extensions[extension] ?? 'Other';
    languages[language] = (languages[language] ?? 0) + 1;
    if (/(^|\/)(__tests__|tests?|spec)(\/|\.)|\.(test|spec)\./i.test(path)) testFileCount++;
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.object < b.object ? -1 : 1));
  const manifests: RepoDescriptor['manifests'] = [];
  for (const entry of entries
    .filter((e) => e.mode === '100644' || e.mode === '100755')
    .filter((e) => e.path.split('/').at(-1) === 'package.json')
    .slice(0, MAX_MANIFESTS)) {
    // Missing objects are a repository error, not an invalid manifest to silently omit.
    const size = Number((await git(root, ['cat-file', '-s', entry.object], 64)).toString('ascii').trim());
    if (!Number.isSafeInteger(size) || size > 65536) continue;
    const manifest = (await git(root, ['cat-file', 'blob', entry.object], 65536)).toString('utf8');
    try {
      // Object ID originates in bounded ls-tree, never from browser or path interpolation.
      const parsed: unknown = JSON.parse(manifest);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const names = new Set<string>();
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = (parsed as Record<string, unknown>)[field];
        if (deps && typeof deps === 'object' && !Array.isArray(deps)) {
          for (const [name, version] of Object.entries(deps)) {
            if (
              /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]{1,100}$/.test(name) &&
              typeof version === 'string' &&
              version.length <= 128
            )
              names.add(name);
          }
        }
      }
      manifests.push({ path: entry.path, dependencies: [...names].sort().slice(0, 1000) });
    } catch {
      /* An invalid/oversized manifest does not prevent metadata generation. */
    }
  }
  const ancestry = (await git(root, ['rev-list', '--max-count=1000', snapshotId])).toString('ascii').trim();
  const dirty = (await git(root, ['status', '--porcelain', '-uno', '--ignore-submodules=all'])).length > 0;
  const descriptor: Omit<RepoDescriptor, 'fingerprint'> = {
    version: GENERATOR_VERSION,
    snapshotId,
    entries,
    manifests,
    publicAggregates: {
      fileCount: entries.length,
      directoryCount: directories.size,
      maxDepth,
      commitCount: ancestry ? ancestry.split('\n').length : 0,
      dependencyCount: manifests.reduce((n, m) => n + m.dependencies.length, 0),
      testFileCount,
      languages,
      dirty,
    },
  };
  return { ...descriptor, fingerprint: fingerprintDescriptor(descriptor) };
}

export function generateRepoLevel(descriptor: RepoDescriptor, difficulty?: 1 | 2 | 3 | 4 | 5): LevelSpec {
  if (descriptor.version !== GENERATOR_VERSION || !/^[a-f0-9]{64}$/.test(descriptor.fingerprint))
    throw new Error('Unsupported repository descriptor.');
  if (difficulty !== undefined && ![1, 2, 3, 4, 5].includes(difficulty))
    throw new Error('Invalid difficulty');
  const random = seededRandom(descriptor.fingerprint);
  const count = 6 + Math.min(8, Math.floor(Math.log2(descriptor.publicAggregates.fileCount + 1)));
  const tier =
    difficulty ?? (Math.min(3, 1 + Math.floor(descriptor.publicAggregates.maxDepth / 4)) as 1 | 2 | 3);
  const themes = ['aurora', 'ember', 'violet'];
  const options = {
    levelId: `repo-v2-${createHash('sha256')
      .update(
        canonicalJson([descriptor.fingerprint, tier, GENERATOR_VERSION, CATALOG_VERSION, PHYSICS_VERSION]),
      )
      .digest('hex')
      .slice(0, 20)}`,
    displayName: 'Commit Circuit',
    mode: 'repo' as const,
    difficultyTier: tier,
    themeId: themes[Math.floor(random() * themes.length)],
    generatorVersion: GENERATOR_VERSION,
    segmentCatalogVersion: CATALOG_VERSION,
  };
  // Expert keeps the densest certified pool instead of duplicating tier four's geometry.
  const eligible = certifiedPatterns.filter(
    (p) => p.difficultyCost <= tier && (tier < 5 || p.difficultyCost >= 3),
  );
  if (!eligible.length) throw new Error('No certified patterns available');
  for (let attempt = 0; attempt < 4; attempt++) {
    const ids = Array.from({ length: count }, () => eligible[Math.floor(random() * eligible.length)].id);
    const level = compilePatterns(ids, options);
    if (verifyLevel(level).valid) return level;
  }
  const fallback = compilePatterns(
    Array.from({ length: count }, () => eligible[0].id),
    options,
  );
  if (!verifyLevel(fallback).valid) throw new Error('Certified fallback failed verification');
  return fallback;
}

/** Baked challenge exports never include seed, fingerprint, Git identities or arbitrary extension keys. */
export function exportChallenge(level: LevelSpec): string {
  return canonicalJson({
    schemaVersion: level.schemaVersion,
    physicsVersion: level.physicsVersion,
    generatorVersion: level.generatorVersion ?? GENERATOR_VERSION,
    segmentCatalogVersion: level.segmentCatalogVersion ?? CATALOG_VERSION,
    levelId: createHash('sha256').update(canonicalJson(level.chunks)).digest('hex').slice(0, 20),
    mode: 'repo',
    displayName: 'Shared Circuit',
    themeId: level.themeId,
    bpm: level.bpm,
    audioId: level.audioId,
    totalTicksEstimate: level.totalTicksEstimate,
    finishX: level.finishX,
    difficultyTier: level.difficultyTier,
    chunks: level.chunks.map((c) => ({
      patternId: c.patternId,
      startX: c.startX,
      obstacleInstances: c.obstacleInstances.map((o) => ({
        kind: o.kind,
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
      })),
    })),
  });
}
