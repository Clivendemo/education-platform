import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    maxWorkers: 1,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
