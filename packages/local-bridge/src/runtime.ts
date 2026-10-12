import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, stat, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { atomicWrite, readBounded } from '../../storage/src/atomic';
export const runtimeHome = () =>
  process.env.CLAWDASH_HOME ??
  (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Clawdash')
    : join(homedir(), '.local', 'share', 'clawdash'));
export async function protect(path: string) {
  if (process.platform === 'win32') {
    const identity = process.env.USERDOMAIN
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : process.env.USERNAME;
    if (!identity) throw new Error('Cannot establish current user ACL');
    await promisify(execFile)('icacls.exe', [path, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`], {
      windowsHide: true,
      timeout: 3000,
    });
  }
}
export async function ensureRuntime(home = runtimeHome()) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(home, 0o700);
  await protect(home);
  for (const name of ['emitter-secret', 'pairing-secret']) {
    const path = join(home, name);
    try {
      await stat(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await atomicWrite(path, randomBytes(32).toString('hex'));
    }
    if (process.platform !== 'win32') await chmod(path, 0o600);
  }
  const result = {
    emitterToken: (await readFile(join(home, 'emitter-secret'), 'utf8')).trim(),
    pairingToken: (await readFile(join(home, 'pairing-secret'), 'utf8')).trim(),
  };
  if (!/^[a-f0-9]{64}$/.test(result.emitterToken) || !/^[a-f0-9]{64}$/.test(result.pairingToken))
    throw new Error('Invalid runtime secret; preserve and inspect local runtime files');
  return result;
}
export type Discovery = { protocol: 1; port: number; pid: number; instanceId: string };
export async function discover(home = runtimeHome()): Promise<Discovery> {
  const data = JSON.parse(await readBounded(join(home, 'runtime.json'), 4096));
  if (data.protocol !== 1 || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535)
    throw new Error('Invalid discovery');
  return data;
}
