import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    // node:sea は node: 接頭辞なしでは読み込めないため、接頭辞を残す
    removeNodeProtocol: false,
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
