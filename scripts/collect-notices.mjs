import { readFile, readdir, mkdir, writeFile, stat, cp } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const out = resolve('dist/licenses');
await mkdir(out, { recursive: true });
const notices = [];
async function collect(folder, label) {
  let files;
  try {
    files = await readdir(folder);
  } catch {
    return;
  }
  for (const file of files.filter((f) => /^(licen[cs]e|copying|notice)([._-]|$)/i.test(f))) {
    const path = join(folder, file);
    if ((await stat(path)).isFile())
      notices.push(`\n==== ${label}: ${file} ====\n${await readFile(path, 'utf8')}`);
  }
}
await collect(dirname(process.execPath), `Node.js ${process.version}`);
if (!notices.length) {
  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!response.ok)
    throw new Error('Matching Node distribution license missing; cannot redistribute sidecar');
  const license = await response.text();
  if (license.length < 1000 || license.length > 2_000_000) throw new Error('Invalid upstream Node license');
  notices.push(`\n==== Node.js ${process.version}: LICENSE ====\n${license}`);
}
// Tauri CLI 2.12.2 downloads this DLL separately from pnpm and Cargo dependencies.
// Keep its release-tag notice aligned when upgrading the CLI's bundled NSIS helper.
const nsisVersion = '0.5.3';
const nsisSource = `https://github.com/tauri-apps/nsis-tauri-utils/tree/nsis_tauri_utils-v${nsisVersion}`;
const nsisLicense = await fetch(
  `https://raw.githubusercontent.com/tauri-apps/nsis-tauri-utils/nsis_tauri_utils-v${nsisVersion}/LICENSE_MIT`,
);
if (!nsisLicense.ok) throw new Error('NSIS helper license notice unavailable; cannot redistribute installer');
const nsisText = await nsisLicense.text();
if (!nsisText.includes('Permission is hereby granted') || nsisText.length > 128_000)
  throw new Error('Invalid NSIS helper notice');
notices.push(`\n==== nsis-tauri-utils ${nsisVersion} (MIT option) ====\nSource: ${nsisSource}\n${nsisText}`);
const store = resolve('node_modules/.pnpm');
for (const entry of await readdir(store, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'node_modules') continue;
  const modules = resolve(store, entry.name, 'node_modules');
  for (const pkg of await readdir(modules, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const dirs = pkg.name.startsWith('@')
      ? (await readdir(join(modules, pkg.name))).map((n) => join(modules, pkg.name, n))
      : [join(modules, pkg.name)];
    for (const dir of dirs) await collect(dir, `${entry.name}/${pkg.name}`);
  }
}
const cargo = process.env.CARGO ?? 'cargo';
const metadata = JSON.parse(
  execFileSync(
    cargo,
    ['metadata', '--locked', '--format-version', '1', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml'],
    { maxBuffer: 20_000_000, encoding: 'utf8' },
  ),
);
const rust = [];
for (const pkg of metadata.packages) {
  rust.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    source: pkg.source,
    sourceUrl: pkg.source?.startsWith('registry+')
      ? `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`
      : undefined,
  });
  if (pkg.license === 'MPL-2.0') {
    await cp(dirname(pkg.manifest_path), join(out, 'mpl-source', `${pkg.name}-${pkg.version}`), {
      recursive: true,
    });
  }
  await collect(dirname(pkg.manifest_path), `${pkg.name}@${pkg.version}`);
}
await writeFile(join(out, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'));
await writeFile(join(out, 'rust-licenses.json'), JSON.stringify(rust, null, 2) + '\n');
await writeFile(join(out, 'Clawdash-LICENSE.txt'), await readFile('LICENSE'));
console.log(`Collected ${notices.length} notice files and ${rust.length} Rust license declarations.`);
