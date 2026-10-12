import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, open, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readBounded } from '../../storage/src/atomic';
import { setTimeout as delay } from 'node:timers/promises';
export const runtimeHome = () =>
  process.env.CLAWDASH_HOME ??
  (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Clawdash')
    : join(homedir(), '.local', 'share', 'clawdash'));
export async function protect(path: string) {
  if (process.platform === 'win32') {
    // Fixed script; the path is data in the child environment, never shell source.
    // Build a new DACL so pre-existing explicit Everyone/Users grants cannot survive.
    const script = `$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $root=$env:CLAWDASH_ACL_TARGET; $acl=[System.Security.AccessControl.DirectorySecurity]::new(); $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [System.IO.DirectoryInfo]::new($root).SetAccessControl($acl); foreach($name in @('emitter-secret','pairing-secret')) { $file=[System.IO.Path]::Combine($root,$name); if([System.IO.File]::Exists($file)) { $fileAcl=[System.Security.AccessControl.FileSecurity]::new(); $fileAcl.SetOwner($sid); $fileAcl.SetAccessRuleProtection($true,$false); $fileAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow')); [System.IO.FileInfo]::new($file).SetAccessControl($fileAcl) } }`;
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 10_000,
      env: { ...process.env, CLAWDASH_ACL_TARGET: path },
    });
  }
}
const initializations = new Map<string, Promise<{ emitterToken: string; pairingToken: string }>>();
export function ensureRuntime(home = runtimeHome()) {
  const existing = initializations.get(home);
  if (existing) return existing;
  const work = initializeRuntime(home);
  initializations.set(home, work);
  void work
    .finally(() => {
      if (initializations.get(home) === work) initializations.delete(home);
    })
    .catch(() => {});
  return work;
}
async function initializeRuntime(home: string) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(home, 0o700);
  await protect(home);
  for (const name of ['emitter-secret', 'pairing-secret']) {
    const path = join(home, name);
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(randomBytes(32).toString('hex'), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    if (process.platform !== 'win32') await chmod(path, 0o600);
  }
  let result = { emitterToken: '', pairingToken: '' };
  for (let attempt = 0; attempt < 10; attempt++) {
    result = {
      emitterToken: (await readFile(join(home, 'emitter-secret'), 'utf8')).trim(),
      pairingToken: (await readFile(join(home, 'pairing-secret'), 'utf8')).trim(),
    };
    if (/^[a-f0-9]{64}$/.test(result.emitterToken) && /^[a-f0-9]{64}$/.test(result.pairingToken)) break;
    if (attempt < 9) await delay(25);
  }
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
