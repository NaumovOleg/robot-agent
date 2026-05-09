import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  bundle: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['node:fs', 'node:path', 'node:os', 'node:process', 'node:child_process'],
  noExternal: [
    '@robocode-packages/agent',
    '@robocode-packages/config',
    '@robocode-packages/core',
    '@robocode-packages/providers',
    '@robocode-packages/shared',
    '@robocode-packages/tools',
    '@robocode-packages/ui',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  outDir: 'dist',
  clean: true,
});
