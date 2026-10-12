import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { stat, copyFile } from 'node:fs/promises';
import { CLAUDE_HOOK_EVENTS } from '../../agent-adapters/claude/index';
import { atomicWrite, readBounded } from '../../storage/src/atomic';

type Config = Record<string, unknown>;
export type HookInvocation = { command: string; args: string[] };
export const settingsPath = () => join(homedir(), '.claude', 'settings.json');
async function readConfig(path: string): Promise<Config> {
  try {
    const data = JSON.parse(await readBounded(path, 1_000_000));
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Invalid settings; original preserved');
    return data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
}
const manifestPath = (path: string) => `${path}.clawdash-managed.json`;
function removeOwned(config: Config, owned: unknown[]) {
  if (config.hooks === undefined) return config;
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks))
    throw new Error('Malformed hook configuration; original preserved');
  const hooks = { ...(config.hooks as Config) };
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new Error('Malformed hook group; original preserved');
    hooks[event] = groups.filter(
      (group) => !owned.some((entry) => JSON.stringify(entry) === JSON.stringify({ event, group })),
    );
    if ((hooks[event] as unknown[]).length === 0) delete hooks[event];
  }
  const result = { ...config };
  if (Object.keys(hooks).length) result.hooks = hooks;
  else delete result.hooks;
  return result;
}
async function readOwned(path: string): Promise<unknown[]> {
  try {
    const data = JSON.parse(await readBounded(manifestPath(path), 65_536));
    if (!Array.isArray(data)) throw new Error('Invalid managed hook record');
    return data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}
async function backup(path: string) {
  try {
    await copyFile(path, `${path}.clawdash-backup`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
/** Current Claude exec-form command+args avoids shell quoting on all platforms. */
export async function installClaudeHooks(invocation: HookInvocation, path = settingsPath()) {
  if (
    !isAbsolute(invocation.command) ||
    (process.platform === 'win32' && !/\.exe$/i.test(invocation.command))
  )
    throw new Error('Use an absolute executable path');
  if (!(await stat(invocation.command)).isFile()) throw new Error('Hook executable missing');
  const previousOwned = await readOwned(path);
  const config = removeOwned(await readConfig(path), previousOwned);
  if (config.allowManagedHooksOnly === true || config.disableAllHooks === true)
    throw new Error('Claude policy disables user hooks; settings preserved');
  const hooks = { ...((config.hooks ?? {}) as Config) };
  const owned: unknown[] = [];
  for (const event of CLAUDE_HOOK_EVENTS) {
    const group = {
      ...(event === 'Notification'
        ? {
            matcher:
              'permission_prompt|idle_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input',
          }
        : {}),
      hooks: [
        {
          type: 'command',
          command: resolve(invocation.command),
          args: [...invocation.args, 'hook', '--clawdash-managed-v1'],
          async: true,
          timeout: 1,
        },
      ],
    };
    hooks[event] = [...((hooks[event] ?? []) as unknown[]), group];
    owned.push({ event, group });
  }
  await backup(path);
  // Persist ownership first: interrupted installs can remove only exact entries, never unrelated hooks.
  await atomicWrite(manifestPath(path), JSON.stringify([...previousOwned, ...owned]));
  await atomicWrite(path, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
  await atomicWrite(manifestPath(path), JSON.stringify(owned));
}
export async function uninstallClaudeHooks(path = settingsPath()) {
  const owned = await readOwned(path),
    before = await readConfig(path),
    after = removeOwned(before, owned);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await backup(path);
    await atomicWrite(path, JSON.stringify(after, null, 2) + '\n');
  }
  await atomicWrite(manifestPath(path), '[]');
}
