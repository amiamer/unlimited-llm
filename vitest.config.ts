import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // odysseus/ is a cloned reference repo (gitignored), not part of this
    // project — keep its test suite out of `npm test`.
    exclude: [
      ...configDefaults.exclude,
      '**/odysseus/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
