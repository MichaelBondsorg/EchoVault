import { defineConfig } from 'vitest/config';

// Without a local config, vitest walks up and loads the repo-root
// vitest.config.js, whose imports (@vitejs/plugin-react etc.) aren't
// installed in the relay-only CI job. Keep the relay suite self-contained.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
