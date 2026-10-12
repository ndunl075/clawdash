import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:47931', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite preview apps/web --host 127.0.0.1 --port 47931 --strictPort',
    url: 'http://127.0.0.1:47931',
    reuseExistingServer: false,
  },
});
