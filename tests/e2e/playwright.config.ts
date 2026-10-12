import { defineConfig } from '@playwright/test';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4178', viewport: { width: 1280, height: 800 }, headless: true },
  webServer: {
    command: `node "${vite}" preview apps/web --host 127.0.0.1 --port 4178 --strictPort`,
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: true,
    timeout: 20000,
  },
  reporter: 'list',
});
