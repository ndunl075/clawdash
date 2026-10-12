import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
// Original pixel geometry, encoded without an image service or external asset.
const size = 64;
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const cube = x >= 12 && x < 52 && y >= 12 && y < 52;
    const eye = y >= 24 && y < 31 && ((x >= 23 && x < 28) || (x >= 37 && x < 42));
    raw.set(cube && !eye ? [174, 255, 65, 255] : [8, 13, 24, 255], i);
  }
function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type);
  const b = Buffer.alloc(data.length + 12);
  b.writeUInt32BE(data.length);
  t.copy(b, 4);
  data.copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([t, data])), b.length - 4);
  return b;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = size;
header[7] = size;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await mkdir('apps/desktop/src-tauri/icons', { recursive: true });
await writeFile('apps/desktop/src-tauri/icons/icon.ico', Buffer.concat([header, png]));
await writeFile('apps/desktop/src-tauri/icons/icon.png', png);
