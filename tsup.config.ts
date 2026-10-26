import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    // serve 時にブラウザへ配信するスクリプト（dist/client.js）
    entry: { client: 'src/client/live.ts' },
    format: ['esm'],
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
  },
]);
