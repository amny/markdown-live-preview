import { defineConfig } from 'tsup';

// 単一実行ファイル（SEA）用。依存パッケージを含む全コードを 1 つの CommonJS ファイルにまとめる
// （SEA の起動スクリプトは CommonJS で、node の組み込みモジュール以外を require できないため）
export default defineConfig({
  entry: { mdlive: 'src/cli.ts' },
  outDir: 'dist-sea',
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  // node:sea は node: 接頭辞なしでは読み込めないため、接頭辞を残す
  removeNodeProtocol: false,
  noExternal: [/.*/],
  splitting: false,
  sourcemap: false,
  clean: true,
  outExtension: () => ({ js: '.cjs' }),
  esbuildOptions: (options) => {
    // import.meta はパッケージからアセットを読むときだけ使い、SEA では参照しない
    options.logOverride = { 'empty-import-meta': 'silent' };
  },
});
