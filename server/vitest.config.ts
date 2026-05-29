import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Encryption / DB tests touch the filesystem and a native addon; keep them
    // serial and give them room so flaky parallelism never masks a real failure.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
