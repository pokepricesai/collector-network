import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Node tests do not run inside Next.js, so the server-only guard
      // import becomes a hard failure. Point it at an empty shim.
      'server-only': path.resolve(__dirname, 'src/server/__mocks__/server-only.ts'),
    },
  },
});
