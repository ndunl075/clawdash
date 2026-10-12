import { mkdir, open, readFile, rename, copyFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const writers = new Map<string, Promise<unknown>>();
export async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`,
    handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}
export async function readBounded(path: string, max = 2_000_000): Promise<string> {
  if ((await stat(path)).size > max) throw new Error('File too large');
  return readFile(path, 'utf8');
}
export class AtomicJsonStore<T> {
  constructor(
    readonly path: string,
    private parse: (input: unknown) => T,
    private initial: () => T,
  ) {}
  async load(): Promise<T> {
    try {
      const envelope = JSON.parse(await readBounded(this.path));
      if (
        envelope.version !== 1 ||
        createHash('sha256').update(JSON.stringify(envelope.data)).digest('hex') !== envelope.checksum
      )
        throw new Error('Save integrity failure');
      return this.parse(envelope.data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.initial();
      throw error;
    }
  }
  update(change: (value: T) => T): Promise<T> {
    const work = (writers.get(this.path) ?? Promise.resolve()).then(async () => {
      const value = this.parse(change(await this.load()));
      try {
        await copyFile(this.path, `${this.path}.backup`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      await atomicWrite(
        this.path,
        JSON.stringify({
          version: 1,
          data: value,
          checksum: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
        }),
      );
      return value;
    });
    const queued = work.catch(() => {});
    writers.set(this.path, queued);
    void queued.then(() => {
      if (writers.get(this.path) === queued) writers.delete(this.path);
    });
    return work;
  }
}
