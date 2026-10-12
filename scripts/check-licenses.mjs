import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const approved =
  /^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|CC0-1\.0|CC-BY-4\.0|Unlicense|Python-2\.0|BlueOak-1\.0\.0|\(?MIT OR Apache-2\.0\)?|Apache-2\.0 OR MIT)$/;
const store = resolve('node_modules/.pnpm');
let checked = 0;
const unknown = [];
for (const entry of await readdir(store, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'node_modules') continue;
  const modules = resolve(store, entry.name, 'node_modules');
  for (const packageEntry of await readdir(modules, { withFileTypes: true })) {
    if (!packageEntry.isDirectory()) continue;
    const candidates = packageEntry.name.startsWith('@')
      ? (await readdir(resolve(modules, packageEntry.name))).map((name) =>
          resolve(modules, packageEntry.name, name),
        )
      : [resolve(modules, packageEntry.name)];
    for (const path of candidates) {
      try {
        const pkg = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'));
        checked++;
        const license = typeof pkg.license === 'object' ? pkg.license.type : pkg.license;
        if (!approved.test(license ?? ''))
          unknown.push(`${pkg.name}@${pkg.version}: ${license ?? 'MISSING'}`);
      } catch {
        /* pnpm symlinks/metadata are not package manifests */
      }
    }
  }
}
if (unknown.length) {
  console.error(unknown.join('\n'));
  process.exitCode = 1;
}
console.log(`Audited ${checked} dependency manifests. Original asset attribution: assets/licenses/README.md`);
