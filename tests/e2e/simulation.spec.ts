import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { curatedLevels, witnessForLevel } from '../../packages/level-content/src/index';
import { createRun, stepRun } from '../../packages/game/src/simulation/index';

test('shipping physics produces identical complete replays in Node and Chromium', async ({ page }) => {
  const bundled = await build({
    entryPoints: ['packages/game/src/simulation/index.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    globalName: 'ClawdashSimulation',
  });
  await page.goto('/');
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  for (const level of curatedLevels) {
    const witness = witnessForLevel(level),
      press = new Set(witness);
    let state = createRun(level);
    const nodeTrace = [];
    while (state.status === 'playing') {
      state = stepRun(level, state, { jumpPressed: press.has(state.tick), jumpHeld: false });
      nodeTrace.push([state.tick, state.fixed, state.grounded, state.status, state.progress]);
    }
    const expected = createHash('sha256').update(JSON.stringify(nodeTrace)).digest('hex');
    const observed = await page.evaluate(
      async ({ level, witness }) => {
        const sim = (
          window as unknown as {
            ClawdashSimulation: { createRun: typeof createRun; stepRun: typeof stepRun };
          }
        ).ClawdashSimulation;
        let state = sim.createRun(level);
        const presses = new Set(witness),
          trace = [];
        while (state.status === 'playing') {
          state = sim.stepRun(level, state, { jumpPressed: presses.has(state.tick), jumpHeld: false });
          trace.push([state.tick, state.fixed, state.grounded, state.status, state.progress]);
        }
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(trace)));
        return {
          status: state.status,
          hash: [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join(''),
        };
      },
      { level, witness },
    );
    expect(observed).toEqual({ status: 'completed', hash: expected });
  }
});
