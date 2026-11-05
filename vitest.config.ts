import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['web/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    globals: true,
    testTimeout: 120000,
    hookTimeout: 180000,
    fileParallelism: false,
    maxWorkers: 1,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
