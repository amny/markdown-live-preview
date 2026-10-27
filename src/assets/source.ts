import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';

/**
 * ツールに同梱するアセット（GitHub スタイル・KaTeX・Mermaid・ブラウザ側スクリプト）の読み込み口。
 * 通常はインストール済みのパッケージから、単一実行ファイル（SEA）では実行ファイルに埋め込んだものから読む。
 */
export type AssetSource = {
  /** アセットの中身。存在しない名前のときは undefined */
  readonly read: (name: string) => Promise<Buffer | undefined>;
};

export const GITHUB_CSS_ASSETS = {
  auto: 'github-markdown.css',
  light: 'github-markdown-light.css',
  dark: 'github-markdown-dark.css',
} as const;
export const KATEX_CSS_ASSET = 'katex.css';
export const MERMAID_ASSET = 'mermaid.min.js';
export const CLIENT_ASSET = 'client.js';

// katex.css 内の相対参照 fonts/*.woff2 などに対応するアセット名
const KATEX_FONT_ASSET = /^fonts\/([\w-]+\.(?:woff2|woff|ttf))$/;
/** 単一実行ファイルに埋め込むフォント（現行ブラウザは woff2 のみを使う） */
const BUNDLED_FONT = /^[\w-]+\.woff2$/;

const nodeRequire = (): NodeJS.Require => createRequire(import.meta.url);

/** パッケージ内の katex.css の絶対パス（フォントの場所の基準になる） */
const katexCssPath = (): string => nodeRequire().resolve('katex/dist/katex.min.css');

/** アセット名をインストール済みパッケージ内のファイルの絶対パスに解決する。未知の名前は undefined */
export const packageAssetPath = (name: string, clientScriptPath: string): string | undefined => {
  const githubCss = Object.values(GITHUB_CSS_ASSETS).find((file) => file === name);
  if (githubCss !== undefined) return nodeRequire().resolve(`github-markdown-css/${githubCss}`);
  if (name === KATEX_CSS_ASSET) return katexCssPath();
  if (name === MERMAID_ASSET) return nodeRequire().resolve('mermaid/dist/mermaid.min.js');
  if (name === CLIENT_ASSET) return clientScriptPath;
  const font = KATEX_FONT_ASSET.exec(name)?.[1];
  return font === undefined ? undefined : path.join(path.dirname(katexCssPath()), 'fonts', font);
};

const isNotFound = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'EISDIR');

/** インストール済みパッケージから読む。`clientScriptPath` はビルド済みのブラウザ側スクリプト */
export const createPackageAssetSource = (clientScriptPath: string): AssetSource => ({
  read: async (name) => {
    const filePath = packageAssetPath(name, clientScriptPath);
    if (filePath === undefined) return undefined;
    return readFile(filePath).catch((cause: unknown) => {
      if (isNotFound(cause)) return undefined;
      throw new Error(`failed to read asset ${name}: ${filePath}`, { cause });
    });
  },
});

type GetAsset = (key: string) => ArrayBuffer;

const isAssetNotFound = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ERR_SINGLE_EXECUTABLE_APPLICATION_ASSET_NOT_FOUND';

/** 単一実行ファイルに埋め込んだアセットから読む */
export const createSeaAssetSource = (get: GetAsset = getAsset): AssetSource => ({
  read: async (name) => {
    try {
      return Buffer.from(get(name));
    } catch (error) {
      if (isAssetNotFound(error)) return undefined;
      throw new Error(`failed to read embedded asset ${name}`, { cause: error });
    }
  },
});

let defaultSource: AssetSource | undefined;

/** 実行形態に応じた読み込み口。通常はビルド済みの cli.js と同じディレクトリの client.js を使う */
export const defaultAssetSource = (): AssetSource => {
  defaultSource ??= isSea()
    ? createSeaAssetSource()
    : createPackageAssetSource(fileURLToPath(new URL(`./${CLIENT_ASSET}`, import.meta.url)));
  return defaultSource;
};

/** 単一実行ファイルに埋め込むアセットの一覧（アセット名 → 埋め込むファイルの絶対パス） */
export const bundledAssetFiles = async (clientScriptPath: string): Promise<ReadonlyMap<string, string>> => {
  const fontDir = path.join(path.dirname(katexCssPath()), 'fonts');
  const fonts = (await readdir(fontDir)).filter((file) => BUNDLED_FONT.test(file)).map((file) => `fonts/${file}`);
  const names = [...Object.values(GITHUB_CSS_ASSETS), KATEX_CSS_ASSET, MERMAID_ASSET, CLIENT_ASSET, ...fonts];
  return new Map(
    names.map((name) => {
      const filePath = packageAssetPath(name, clientScriptPath);
      if (filePath === undefined) throw new Error(`unknown bundled asset: ${name}`);
      return [name, filePath] as const;
    }),
  );
};
