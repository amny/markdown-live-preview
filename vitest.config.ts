import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Shiki の初期化やファイル監視を含むため、並列実行時の負荷を見込んで長めにする
    testTimeout: 20_000,
  },
});
