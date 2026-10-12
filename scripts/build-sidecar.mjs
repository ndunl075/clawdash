import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, readdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { inject } from 'postject';

// Node 22 SEA embeds the complete bundled TypeScript CLI, requiring no installed Node at runtime.
const root = resolve(import.meta.dirname, '..');
await import('./collect-notices.mjs');
const out = resolve(root, 'dist/sidecar');
await mkdir(out, { recursive: true });
await build({
  entryPoints: [resolve(root, 'packages/cli/src/index.ts')],
  outfile: resolve(out, 'cli.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  define: { 'import.meta.url': '"file:///clawdash-cli.cjs"', CLAWDASH_STANDALONE: 'true' },
});
const config = {
  main: resolve(out, 'cli.cjs'),
  output: resolve(out, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
};
await writeFile(resolve(out, 'sea-config.json'), JSON.stringify(config));
execFileSync(process.execPath, ['--experimental-sea-config', resolve(out, 'sea-config.json')], {
  stdio: 'inherit',
});
const triple =
  process.platform === 'win32'
    ? 'x86_64-pc-windows-msvc'
    : process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'aarch64-apple-darwin'
        : 'x86_64-apple-darwin'
      : 'x86_64-unknown-linux-gnu';
const dir = resolve(root, 'apps/desktop/src-tauri/binaries');
await mkdir(dir, { recursive: true });
const binary = resolve(dir, `clawdash-cli-${triple}${process.platform === 'win32' ? '.exe' : ''}`);
await copyFile(process.execPath, binary);
if (process.platform === 'win32') {
  const sdk = resolve(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Windows Kits/10/bin');
  let signTool;
  for (const version of (await readdir(sdk)).sort().reverse()) {
    const candidate = resolve(sdk, version, 'x64/signtool.exe');
    try {
      await access(candidate);
      signTool = candidate;
      break;
    } catch {}
  }
  if (!signTool)
    throw new Error(
      'Windows SDK signtool is required to remove the copied Node signature before SEA injection.',
    );
  execFileSync(signTool, ['remove', '/s', binary], { stdio: 'inherit' });
}
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', binary]);
const { readFile } = await import('node:fs/promises');
await inject(binary, 'NODE_SEA_BLOB', await readFile(config.output), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
});
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', binary]);
console.log(`Standalone sidecar built: ${binary}`);
