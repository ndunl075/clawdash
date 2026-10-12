import { test, expect } from '@playwright/test';
import { curatedLevels } from '../../packages/level-content/src/index';

test('Arcade plays, dies, retries, pauses, and persists a normal best', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Less waiting/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/clawdash-home.png' });
  await page.getByRole('button', { name: /Let’s play/ }).click();
  await expect(page.locator('.level-card')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/clawdash-tracks.png' });
  await page.locator('.level-card').first().click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  const progress = await page.locator('.hud-progress').innerText();
  await page.keyboard.press('Space');
  await expect(page.locator('.hud-progress')).toHaveText(progress);
  // Keyboard activation of a focused Resume is allowed; resume explicitly if still paused.
  if (await page.getByRole('button', { name: /Keep going/ }).isVisible())
    await page.getByRole('button', { name: /Keep going/ }).click();
  await expect(page.getByRole('dialog', { name: 'Try again' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Run it back/ }).click();
  await expect(page.locator('.hud-title')).toContainText('ATTEMPT 2');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Back to tracks' }).click();
  await expect(page.locator('.level-card').first().locator('.best-line b')).not.toHaveText('0%');
  const best = await page.locator('.level-card').first().locator('.best-line b').innerText();
  await page.reload();
  await page.getByRole('button', { name: /Let’s play/ }).click();
  await expect(page.locator('.level-card').first().locator('.best-line b')).toHaveText(best);
  expect(errors).toEqual([]);
});

test('practice checkpoint, input isolation and compact playfield', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto('/');
  await page.getByRole('button', { name: /Let’s play/ }).click();
  await page.getByRole('button', { name: 'Practice', exact: true }).click();
  await page.locator('.level-card').first().click();
  await page.keyboard.press('KeyC');
  await expect(page.locator('.game-bottom')).toContainText('CHECKPOINT SAVED');
  await page.screenshot({ path: 'test-results/clawdash-compact.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to tracks' }).click();
  await expect(page.getByRole('button', { name: 'Practice', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(480);
});

test('settings persist and opt-in installed Arcade survives offline reload', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'glacier', exact: true }).click();
  await page.getByLabel('Reduced motion').check();
  await page.getByRole('button', { name: 'Install for offline play' }).click();
  await expect(page.getByRole('status')).toContainText('Offline ready', { timeout: 20000 });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Less waiting/ })).toBeVisible();
  await expect(page.locator('.app')).toHaveClass(/theme-glacier/);
  await expect(page.locator('.app')).toHaveClass(/reduced-motion/);
  await page.getByRole('button', { name: /Let’s play/ }).click();
  await page.locator('.level-card').first().click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
});

test('unavailable companion reports failure without preventing Arcade', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Run your repo/ }).click();
  await page.getByLabel('Local companion address').fill('http://127.0.0.1:1');
  await page.getByLabel('Pairing token').fill('invalid-local-test-token');
  await page.getByRole('button', { name: /Pair companion/ }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.getByRole('button', { name: 'Clawdash home' }).click();
  await page.getByRole('button', { name: /Let’s play/ }).click();
  await expect(page.locator('.level-card')).toHaveCount(3);
});

test('paired repo generation uses grant IDs and bearer headers, with independent agent signals', async ({
  page,
}) => {
  const methods: string[] = [];
  await page.route('**/rpc', async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe('Bearer test-limited-pairing-token');
    expect(request.url()).not.toContain('token');
    const body = request.postDataJSON() as { method: string; folderGrantId?: string; id: string };
    methods.push(body.method);
    if (body.method !== 'health') expect(body.folderGrantId).toBe('local-folder-grant');
    await route.fulfill({
      json: {
        v: 1,
        id: body.id,
        ok: true,
        data:
          body.method === 'health'
            ? { healthy: true }
            : body.method === 'inspectRepo'
              ? { snapshot: 'HEAD', fileCount: 42, commitCount: 7, verified: true }
              : { ...curatedLevels[0], mode: 'repo', displayName: 'Local signal' },
      },
    });
  });
  await page.route('**/events', (route) =>
    route.fulfill({
      json: {
        v: 1,
        cursor: 1,
        events: [],
        sessions: [
          {
            sessionId: 'opaque-local-session',
            provider: 'claude',
            state: 'turn_ended',
            lastSeenAt: new Date().toISOString(),
            toolActivityCount: 3,
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /Run your repo/ }).click();
  await page.getByLabel('Pairing token').fill('test-limited-pairing-token');
  await page.getByRole('button', { name: /Pair companion/ }).click();
  await expect(page.getByText('Connected locally')).toBeVisible();
  await expect(page.locator('.session')).toContainText('Turn ended');
  await page.getByLabel('Folder grant ID').fill('local-folder-grant');
  await page.getByRole('button', { name: /Generate track/ }).click();
  await expect(page.getByText(/42 tracked files/)).toBeVisible();
  await page.getByRole('button', { name: /Play repo run/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.agent-indicator')).toContainText('Turn ended');
  expect(methods).toEqual(['health', 'inspectRepo', 'generateRepoLevel']);
});

test('unknown saved schema is preserved and Arcade remains playable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Less waiting/ })).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('clawdash-local', 1);
      request.onsuccess = () => {
        const tx = request.result.transaction('saves', 'readwrite');
        tx.objectStore('saves').put({ version: 999, sentinel: 'preserve-me' }, 'v1');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Storage is unavailable');
  await page.getByRole('button', { name: /Let’s play/ }).click();
  await expect(page.locator('.level-card')).toHaveCount(3);
  const saved = await page.evaluate(
    async () =>
      await new Promise((resolve) => {
        const request = indexedDB.open('clawdash-local', 1);
        request.onsuccess = () => {
          const read = request.result.transaction('saves').objectStore('saves').get('v1');
          read.onsuccess = () => resolve(read.result);
        };
      }),
  );
  expect(saved).toEqual({ version: 999, sentinel: 'preserve-me' });
});
