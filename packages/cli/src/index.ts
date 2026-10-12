import { join, resolve } from 'node:path';
import { isSea } from 'node:sea';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { startBridge, grantFolder } from '../../local-bridge/src/index';
import { ensureRuntime, runtimeHome, discover } from '../../local-bridge/src/runtime';
import { atomicWrite, readBounded } from '../../storage/src/atomic';
import { installClaudeHooks, uninstallClaudeHooks, settingsPath } from './hooks';
import { emitHook, readHookStdin, maybeLaunch } from './emitter';
import { gameSaveStore, readGameSaveInput } from '../../storage/src/game-save';

export async function main(args = process.argv.slice(isSea() ? 1 : 2)) {
  const [command, ...rest] = args,
    home = runtimeHome();
  if (command === 'hook') {
    await emitHook(await readHookStdin(), home);
    return;
  }
  if (command === 'storage-load' || command === 'storage-save') {
    await ensureRuntime(home);
    const store = gameSaveStore(join(home, 'game-save.json'));
    if (command === 'storage-load') console.log(JSON.stringify(await store.load()));
    else {
      const save = await readGameSaveInput(process.stdin);
      console.log(JSON.stringify(await store.update(() => save)));
    }
    return;
  }
  if (command === 'bridge') {
    const staticIndex = rest.indexOf('--static'),
      staticRoot = staticIndex >= 0 ? resolve(rest[staticIndex + 1] ?? '') : undefined;
    // Lazy import keeps the emitter path free of Git, generation and simulation work.
    const generator = await import('../../level-generator/src/index');
    const bridge = await startBridge({
      home,
      staticRoot,
      inspect: generator.inspectRepository,
      generate: (d, t) =>
        generator.generateRepoLevel(
          d as Parameters<typeof generator.generateRepoLevel>[0],
          t as 1 | 2 | 3 | 4 | 5 | undefined,
        ),
      onAgentStart: (event) => {
        void maybeLaunch(home, event).catch(() => {});
      },
    });
    console.log(
      JSON.stringify({
        protocol: bridge.protocol,
        port: bridge.port,
        pid: bridge.pid,
        instanceId: bridge.instanceId,
        url: `http://127.0.0.1:${bridge.port}`,
      }),
    );
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void bridge.close().then(() => process.exit(0));
      });
    return;
  }
  if (command === 'grant') {
    if (!rest[0]) throw new Error('Usage: clawdash grant PATH');
    console.log(await grantFolder(rest[0], home));
    return;
  }
  if (command === 'pair') {
    await ensureRuntime(home);
    if (rest[0] === '--revoke')
      await atomicWrite(join(home, 'pairing-secret'), randomBytes(32).toString('hex'));
    console.log((await ensureRuntime(home)).pairingToken);
    return;
  }
  if (command === 'configure-launcher') {
    if (!rest[0] || !existsSync(rest[0])) throw new Error('Installed desktop executable required');
    await ensureRuntime(home);
    await atomicWrite(
      join(home, 'launcher.json'),
      JSON.stringify({
        executable: resolve(rest[0]),
        autoOpen: rest.includes('--auto-open'),
        focus: rest.includes('--focus'),
      }),
    );
    console.log('Launcher preference saved.');
    return;
  }
  if (command === 'integrations' && rest[1] === 'claude') {
    console.log(`Claude settings: ${settingsPath()}`);
    if (rest[0] === 'install') {
      await ensureRuntime(home);
      const exeIndex = rest.indexOf('--executable');
      const invocation =
        exeIndex >= 0
          ? { command: resolve(rest[exeIndex + 1]), args: [] }
          : isSea()
            ? { command: process.execPath, args: [] }
            : {
                command: process.execPath,
                args: [
                  '--import',
                  pathToFileURL(createRequire(resolve('package.json')).resolve('tsx')).href,
                  resolve(process.argv[1]),
                ],
              };
      await installClaudeHooks(invocation);
      console.log('Installed opt-in Clawdash hooks (current Claude exec-form support required).');
      return;
    }
    if (rest[0] === 'uninstall') {
      await uninstallClaudeHooks();
      await atomicWrite(join(home, 'launcher.json'), JSON.stringify({ autoOpen: false, focus: false }));
      console.log('Removed owned hooks and disabled auto-open.');
      return;
    }
  }
  if (command === 'diagnostics') {
    let available = false;
    try {
      const d = await discover(home),
        t = await ensureRuntime(home);
      available = (
        await fetch(`http://127.0.0.1:${d.port}/rpc`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${t.pairingToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ v: 1, id: 'diagnostics', method: 'health' }),
          signal: AbortSignal.timeout(300),
        })
      ).ok;
    } catch {}
    console.log(
      JSON.stringify({
        protocol: 1,
        bridgeAvailable: available,
        settingsFile: settingsPath(),
        hookExecForm: 'Requires current Claude Code',
        runtimeHome: home,
      }),
    );
    return;
  }
  console.log(
    'clawdash bridge [--static PATH] | grant PATH | pair [--revoke] | integrations install|uninstall claude [--executable EXE] | configure-launcher EXE [--auto-open] [--focus] | storage-load | storage-save | diagnostics',
  );
}
// Bundlers define this constant for SEA entrypoints. Importing main in tests stays inert.
declare const CLAWDASH_STANDALONE: boolean | undefined;
if (
  isSea() ||
  (typeof CLAWDASH_STANDALONE !== 'undefined' && CLAWDASH_STANDALONE) ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('/packages/cli/src/index.ts')
) {
  main().catch((error) => {
    if (process.argv.includes('hook')) {
      process.exitCode = 0;
      return;
    }
    console.error(error instanceof Error ? error.message : 'Command failed');
    process.exitCode = 1;
  });
}
