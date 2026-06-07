import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  bundle: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    'node:fs',
    'node:path',
    'node:os',
    'node:process',
    'node:child_process',
    'better-sqlite3',
  ],
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
    options.define = {
      ...options.define,
      __dirname: 'import.meta.dirname',
    };
  },
  outDir: 'dist',
  clean: true,
  async onSuccess() {
    cpSync('../../packages/shared/src/ast/wasm', 'dist/wasm', { recursive: true });
  },
});
