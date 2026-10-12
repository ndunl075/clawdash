import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    maxWorkers: 2,
  },
});
