import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 120000,
    hookTimeout: 120000,
    fileParallelism: false,
    maxWorkers: 1,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
