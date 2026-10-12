import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
const folder = 'apps/desktop/src-tauri/target/release/bundle/nsis';
const lines = [];
for (const file of (await readdir(folder)).filter((f) => f.endsWith('.exe')).sort()) {
  lines.push(
    `${createHash('sha256')
      .update(await readFile(`${folder}/${file}`))
      .digest('hex')}  ${file}`,
  );
}
if (!lines.length) throw new Error('No Windows installer artifacts found');
await mkdir('dist', { recursive: true });
await writeFile('dist/SHA256SUMS.txt', lines.join('\n') + '\n');
