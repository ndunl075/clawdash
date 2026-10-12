import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const home = await mkdtemp(join(tmpdir(), 'clawdash-sea-'));
let bridge;
try {
  const exe = resolve('apps/desktop/src-tauri/binaries/clawdash-cli-x86_64-pc-windows-msvc.exe');
  const env = {
    ...process.env,
    CLAWDASH_HOME: home,
    USERPROFILE: home,
    HOME: home,
    PATH: process.env.SystemRoot
      ? `${process.env.SystemRoot}/System32;${process.env.SystemRoot};${process.env.SystemRoot}/System32/WindowsPowerShell/v1.0`
      : '',
  };
  const invoke = (args, input) =>
    execFileSync(exe, args, { env, input, timeout: 10000, encoding: 'utf8', windowsHide: true });
  const result = invoke(['diagnostics']);
  if (JSON.parse(result).protocol !== 1) throw new Error('Standalone diagnostics produced no valid response');
  bridge = spawn(exe, ['bridge'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let bridgeError = '';
  bridge.stderr.on('data', (chunk) => {
    bridgeError += chunk.toString();
  });
  let discovery;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      discovery = JSON.parse(await readFile(join(home, 'runtime.json'), 'utf8'));
      break;
    } catch {}
    if (bridge.exitCode !== null)
      throw new Error(`Standalone bridge exited before discovery: ${bridgeError}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!discovery) throw new Error('Standalone bridge startup exceeded 10 seconds');
  const token = (await readFile(join(home, 'pairing-secret'), 'utf8')).trim();
  const url = `http://127.0.0.1:${discovery.port}`;
  const timings = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = performance.now();
    invoke(
      ['hook'],
      JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'smoke-session',
        prompt: 'PRIVATE_NOT_FORWARDED',
      }),
    );
    timings.push(performance.now() - start);
  }
  invoke(['hook'], JSON.stringify({ hook_event_name: 'Stop', session_id: 'smoke-session' }));
  const data = await (await fetch(`${url}/events`, { headers: { Authorization: `Bearer ${token}` } })).json();
  if (data.sessions[0]?.state !== 'turn_ended' || JSON.stringify(data).includes('PRIVATE_NOT_FORWARDED'))
    throw new Error('Standalone lifecycle semantics/privacy failed');
  const save = JSON.parse(invoke(['storage-load']));
  save.settings.music = 0.42;
  invoke(['storage-save'], JSON.stringify(save));
  if (JSON.parse(invoke(['storage-load'])).settings.music !== 0.42)
    throw new Error('Standalone persistence failed');
  await mkdir(join(home, '.claude'), { recursive: true });
  const settings = join(home, '.claude/settings.json');
  const original = {
    theme: 'fixture',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'unrelated-fixture-hook' }] }] },
  };
  await writeFile(settings, JSON.stringify(original));
  invoke(['integrations', 'install', 'claude']);
  if (!(await readFile(settings, 'utf8')).includes('--clawdash-managed-v1'))
    throw new Error('Standalone hook install failed');
  invoke(['integrations', 'uninstall', 'claude']);
  if (JSON.stringify(JSON.parse(await readFile(settings, 'utf8'))) !== JSON.stringify(original))
    throw new Error('Standalone hook uninstall damaged unrelated configuration');
  const p95 = timings.sort((a, b) => a - b)[18];
  console.log(
    `Standalone bridge, emitter, save and reversible hook install pass with Node excluded from PATH; hook p95 ${p95.toFixed(1)}ms.`,
  );
} finally {
  if (bridge && bridge.exitCode === null) {
    const exited = new Promise((resolve) => bridge.once('exit', resolve));
    bridge.kill();
    await exited;
  }
  await rm(home, { recursive: true, force: true });
}
