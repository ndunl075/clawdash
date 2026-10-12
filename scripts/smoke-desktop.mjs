import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'win32') throw new Error('Native WebView smoke requires Windows');
const home = await mkdtemp(join(tmpdir(), 'clawdash-desktop-'));
const runtime = join(home, 'runtime');
const exe = resolve('apps/desktop/src-tauri/target/release/clawdash.exe');
const settings = join(home, '.claude/settings.json');
const original = {
  theme: 'fixture',
  hooks: { Stop: [{ hooks: [{ type: 'command', command: 'unrelated-fixture-hook' }] }] },
};
await mkdir(join(home, '.claude'), { recursive: true });
await mkdir(join(home, 'AppData/Local'), { recursive: true });
await writeFile(settings, JSON.stringify(original));
let browser, app, coldHostPid;
const systemPath = `${process.env.SystemRoot}/System32;${process.env.SystemRoot};${process.env.SystemRoot}/System32/WindowsPowerShell/v1.0`;
const fixtureEnv = {
  ...process.env,
  CLAWDASH_HOME: runtime,
  USERPROFILE: home,
  HOME: home,
  LOCALAPPDATA: join(home, 'AppData/Local'),
  PATH: systemPath,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=47932',
  CLAWDASH_DIAGNOSTICS: '1',
};
try {
  app = spawn(exe, ['--agent-start'], {
    windowsHide: true,
    stdio: 'ignore',
    env: fixtureEnv,
  });
  for (let attempt = 0; attempt < 100 && !browser; attempt++) {
    if (app.exitCode !== null) throw new Error('Native app exited before WebView startup');
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:47932', { timeout: 500 });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!browser) throw new Error('Native WebView did not start');
  let page;
  for (let attempt = 0; attempt < 50 && !page; attempt++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().startsWith('http://tauri.localhost'));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('Owned Tauri page not available');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: /Less waiting/ })).toBeVisible({ timeout: 15000 });
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/clawdash-native-home.png' });
  await page.getByRole('button', { name: /Run your repo/ }).click();
  await expect(page.getByText('Connected locally')).toBeVisible({ timeout: 15000 });
  const previous = JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8'));
  process.kill(previous.pid);
  await expect
    .poll(
      async () => {
        try {
          return JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8')).pid;
        } catch {
          return previous.pid;
        }
      },
      { timeout: 15000 },
    )
    .not.toBe(previous.pid);
  await expect
    .poll(
      async () => {
        const connection = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bridge_connection'));
        const response = await page.evaluate(
          async (c) =>
            (
              await fetch(`${c.url}/rpc`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ v: 1, id: 'smoke-health', method: 'health' }),
              })
            ).ok,
          connection,
        );
        return response;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Clawdash home' }).click();
  await page.getByRole('button', { name: /Let’s play/ }).click();
  await page.locator('.level-card').first().click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hud-progress')).not.toHaveText('0%');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Back to tracks' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'glacier', exact: true }).click();
  await page.getByRole('button', { name: 'Compact', exact: true }).click();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(640);
  await page.screenshot({ path: 'test-results/clawdash-native-settings.png' });
  await page.getByRole('button', { name: 'Normal', exact: true }).click();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1120);
  await page.getByRole('button', { name: /Fullscreen/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.__TAURI_INTERNALS__.invoke('get_desktop_preferences')).fullscreen,
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: /Fullscreen/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.__TAURI_INTERNALS__.invoke('get_desktop_preferences')).fullscreen,
      ),
    )
    .toBe(false);
  await page.getByLabel('I agree to install Clawdash’s Claude hooks').check();
  await page.getByRole('button', { name: 'Install hooks', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('hooks installed', { timeout: 15000 });
  if (!(await readFile(settings, 'utf8')).includes('--clawdash-managed-v1'))
    throw new Error('Native hook UI failed');
  await page.getByRole('button', { name: 'Remove Clawdash hooks', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('hooks removed', { timeout: 15000 });
  if (JSON.stringify(JSON.parse(await readFile(settings, 'utf8'))) !== JSON.stringify(original))
    throw new Error('Native uninstall altered unrelated hooks');
  await expect
    .poll(
      async () => {
        try {
          const envelope = JSON.parse(await readFile(join(runtime, 'game-save.json'), 'utf8'));
          return envelope.data.settings.theme;
        } catch {
          return '';
        }
      },
      { timeout: 15000 },
    )
    .toBe('glacier');
  await page.reload();
  await expect(page.locator('.app')).toHaveClass(/theme-glacier/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Open game when a prompt starts').click();
  await expect(page.getByLabel('Open game when a prompt starts')).toBeChecked({ timeout: 10000 });
  await expect
    .poll(async () => JSON.parse(await readFile(join(runtime, 'launcher.json'), 'utf8')).autoOpen)
    .toBe(true);
  const beforeCold = JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8'));
  await browser.close();
  browser = undefined;
  const exited = new Promise((resolve) => app.once('exit', resolve));
  app.kill();
  await exited;
  app = undefined;
  try {
    process.kill(beforeCold.pid);
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 300));
  const cli = resolve('apps/desktop/src-tauri/target/release/clawdash-cli.exe');
  const start = performance.now();
  execFileSync(cli, ['hook'], {
    env: fixtureEnv,
    windowsHide: true,
    timeout: 2000,
    input: JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'cold-launch-fixture',
      prompt: 'PRIVATE_COLD_PROMPT',
    }),
  });
  const emitterMs = performance.now() - start;
  await expect
    .poll(
      async () => {
        try {
          return JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8')).pid;
        } catch {
          return beforeCold.pid;
        }
      },
      { timeout: 15000 },
    )
    .not.toBe(beforeCold.pid);
  const cold = JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8'));
  for (let attempt = 0; attempt < 40 && !browser; attempt++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:47932', { timeout: 500 });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  page = browser
    ?.contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith('http://tauri.localhost'));
  if (!page) throw new Error('Cold auto-open did not restore the native game');
  const connection = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bridge_connection'));
  if (connection.url !== `http://127.0.0.1:${cold.port}`) throw new Error('Unexpected native test profile');
  coldHostPid = await page.evaluate(
    async () => (await window.__TAURI_INTERNALS__.invoke('get_desktop_preferences')).processId,
  );
  if (!Number.isSafeInteger(coldHostPid) || coldHostPid <= 0)
    throw new Error('Native cold-launch PID unavailable');
  await expect(page.locator('.app')).toHaveClass(/theme-glacier/);
  await page.getByRole('button', { name: /Run your repo/ }).click();
  await expect(page.getByText('Agent working', { exact: true }).first()).toBeVisible({ timeout: 15000 });
  execFileSync(cli, ['hook'], {
    env: fixtureEnv,
    windowsHide: true,
    timeout: 2000,
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'cold-launch-fixture' }),
  });
  await expect(page.getByText('Turn ended', { exact: true }).first()).toBeVisible({ timeout: 15000 });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    `Native WebView: Arcade, saves, compact/fullscreen, crash recovery, hook consent and cold auto-open/turn-ended pass without Node on PATH; cold emitter returned in ${emitterMs.toFixed(1)}ms.`,
  );
} catch (error) {
  try {
    console.error(await readFile(join(runtime, 'supervisor.log'), 'utf8'));
  } catch {}
  throw error;
} finally {
  await browser?.close();
  if (coldHostPid) {
    try {
      process.kill(coldHostPid);
    } catch {}
  }
  if (app && app.exitCode === null && app.signalCode === null) {
    const exit = new Promise((resolve) => app.once('exit', resolve));
    app.kill();
    await exit;
  }
  // Killing a Windows GUI does not run Rust destructors. Stop only this fixture's known companion.
  try {
    const discovery = JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8'));
    process.kill(discovery.pid);
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
