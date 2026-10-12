import { test, expect, type Page, type Route } from '@playwright/test';
import { curatedLevels } from '../../packages/level-content/src/index';

function gate() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waiting, release };
}
async function respond(route: Route, data: unknown) {
  const request = route.request().postDataJSON() as { id: string };
  await route.fulfill({ json: { v: 1, id: request.id, ok: true, data } });
}
async function pair(page: Page) {
  await page.route('**/events', (route) =>
    route.fulfill({ json: { v: 1, sessions: [], events: [], cursor: 0 } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /Run your repo/ }).click();
  await page.getByLabel('Pairing token').fill('cancellation-test-token');
  await page.getByRole('button', { name: /Pair companion/ }).click();
  await expect(page.getByText('Connected locally')).toBeVisible();
  await page.getByLabel('Folder grant ID').fill('approved-repo');
}
const summary = { fileCount: 42, commitCount: 7, snapshot: 'HEAD', verified: true };
const track = (id: string, name: string) => ({
  ...curatedLevels[0],
  levelId: id,
  displayName: name,
  mode: 'repo',
});

test('metadata inspection can be cancelled at the transport and restarted', async ({ page }) => {
  const inspection = gate();
  let inspections = 0;
  let generations = 0;
  await page.route('**/rpc', async (route) => {
    const method = (route.request().postDataJSON() as { method: string }).method;
    if (method === 'health') return respond(route, {});
    if (method === 'inspectRepo') {
      if (++inspections === 1) await inspection.waiting;
      // A cancelled browser request can already be gone by the time the companion finishes.
      return respond(route, summary).catch(() => undefined);
    }
    generations++;
    return respond(route, track('restarted-track', 'Restarted signal'));
  });
  await pair(page);
  await page.getByRole('button', { name: /Generate track/ }).click();
  await expect(page.getByRole('button', { name: 'Inspecting metadata…' })).toBeDisabled();
  await expect.poll(() => inspections).toBe(1);
  const aborted = page.waitForEvent('requestfailed', {
    predicate: (request) =>
      request.url().endsWith('/rpc') && request.postDataJSON()?.method === 'inspectRepo',
  });
  await page.getByRole('button', { name: 'Cancel generation' }).click();
  await expect(page.getByRole('status')).toContainText('The companion may still finish its current work');
  inspection.release();
  await aborted;
  expect(generations).toBe(0);
  await page.getByRole('button', { name: /Generate track/ }).click();
  await expect(page.getByRole('heading', { name: 'Restarted signal' })).toBeVisible();
  expect(inspections).toBe(2);
  expect(generations).toBe(1);
});

for (const action of ['cancel', 'leave'] as const) {
  test(`a late generation response cannot change cache or UI after ${action}`, async ({ page }) => {
    // Model a response already in flight which finishes despite the caller's abort.
    // This exercises request identity/lifetime guards in addition to real fetch cancellation above.
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      let firstGeneration = true;
      window.fetch = (input, init) => {
        if (
          firstGeneration &&
          typeof input === 'string' &&
          input.endsWith('/rpc') &&
          typeof init?.body === 'string' &&
          JSON.parse(init.body).method === 'generateRepoLevel'
        ) {
          firstGeneration = false;
          return originalFetch(input, { ...init, signal: undefined });
        }
        return originalFetch(input, init);
      };
    });
    const oldResponse = gate();
    let generations = 0;
    await page.route('**/rpc', async (route) => {
      const method = (route.request().postDataJSON() as { method: string }).method;
      if (method === 'health') return respond(route, {});
      if (method === 'inspectRepo') return respond(route, summary);
      if (++generations === 1) {
        await oldResponse.waiting;
        return respond(route, track('stale-track', 'Stale signal'));
      }
      return respond(route, track('fresh-track', 'Fresh signal'));
    });
    await pair(page);
    await page.getByRole('button', { name: /Generate track/ }).click();
    await expect(page.getByRole('button', { name: 'Building & verifying…' })).toBeDisabled();
    await expect.poll(() => generations).toBe(1);
    if (action === 'cancel') {
      await page.getByRole('button', { name: 'Cancel generation' }).click();
    } else {
      await page.getByRole('button', { name: 'Clawdash home' }).click();
      await page.getByRole('button', { name: /Run your repo/ }).click();
      await page.getByLabel('Folder grant ID').fill('approved-repo');
    }
    await page.getByRole('button', { name: /Generate track/ }).click();
    await expect(page.getByRole('heading', { name: 'Fresh signal' })).toBeVisible();
    const delivered = page.waitForResponse(
      async (response) =>
        response.url().endsWith('/rpc') && (await response.json()).data?.levelId === 'stale-track',
    );
    oldResponse.release();
    await delivered;
    // A new UI action flushes pending rendering before checking that the completed response had no effect.
    await page.getByRole('button', { name: 'Clawdash home' }).click();
    await page.getByRole('button', { name: /Run your repo/ }).click();
    await expect(page.getByRole('button', { name: 'Play saved Fresh signal' })).toBeVisible();
    await expect(page.getByText('Stale signal')).toHaveCount(0);
    const ids = await page.evaluate(
      async () =>
        await new Promise<string[]>((resolve, reject) => {
          const request = indexedDB.open('clawdash-local', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const read = request.result.transaction('saves').objectStore('saves').get('v1');
            read.onsuccess = () =>
              resolve(read.result.cachedRepoLevels.map((level: { levelId: string }) => level.levelId));
            read.onerror = () => reject(read.error);
          };
        }),
    );
    expect(ids).toEqual(['fresh-track']);
  });
}
