import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ExportAssets, Theme } from '../render/page.js';

const require = createRequire(import.meta.url);

const GITHUB_CSS_FILES: Readonly<Record<Theme, string>> = {
  auto: 'github-markdown.css',
  light: 'github-markdown-light.css',
  dark: 'github-markdown-dark.css',
};

/** パッケージ内のファイルの絶対パス */
export const ASSET_FILES = {
  githubCss: (theme: Theme) => require.resolve(`github-markdown-css/${GITHUB_CSS_FILES[theme]}`),
  katexCss: () => require.resolve('katex/dist/katex.min.css'),
  mermaidJs: () => require.resolve('mermaid/dist/mermaid.min.js'),
} as const;

const readText = async (filePath: string, label: string): Promise<string> =>
  readFile(filePath, 'utf8').catch((cause: unknown) => {
    throw new Error(`failed to read ${label}: ${filePath}`, { cause });
  });

// KaTeX の @font-face の src（woff2 / woff / ttf の列挙）
const FONT_SRC = /src:\s*url\(fonts\/([\w-]+)\.woff2\)\s*format\("woff2"\)(?:\s*,\s*url\([^)]*\)\s*format\("[^"]*"\))*/g;

export const katexFontNames = (css: string): readonly string[] =>
  [...css.matchAll(FONT_SRC)].map((match) => match[1] ?? '').filter((name) => name !== '');

/**
 * KaTeX の CSS 内のフォント参照を woff2 の data URI に置き換える。
 * woff / ttf は現行ブラウザでは不要なためサイズ削減のため落とす。
 */
export const inlineKatexFonts = (css: string, fonts: ReadonlyMap<string, string>): string =>
  css.replace(FONT_SRC, (whole, name: string) => {
    const base64 = fonts.get(name);
    if (base64 === undefined) throw new Error(`missing KaTeX font: ${name}.woff2`);
    return `src:url(data:font/woff2;base64,${base64}) format("woff2")`;
  });

const loadKatexCss = async (): Promise<string> => {
  const cssPath = ASSET_FILES.katexCss();
  const css = await readText(cssPath, 'KaTeX CSS');
  const fontDir = path.join(path.dirname(cssPath), 'fonts');
  const fonts = await Promise.all(
    katexFontNames(css).map(async (name) => {
      const fontPath = path.join(fontDir, `${name}.woff2`);
      const data = await readFile(fontPath).catch((cause: unknown) => {
        throw new Error(`failed to read KaTeX font: ${fontPath}`, { cause });
      });
      return [name, data.toString('base64')] as const;
    }),
  );
  return inlineKatexFonts(css, new Map(fonts));
};

type BuiltinAssets = Omit<ExportAssets, 'customCss'>;

const builtinAssets = new Map<Theme, Promise<BuiltinAssets>>();

/** 組み込みアセットはプロセス内で配色ごとに一度だけ読み込む */
const loadBuiltinAssets = (theme: Theme): Promise<BuiltinAssets> => {
  const cached = builtinAssets.get(theme);
  if (cached !== undefined) return cached;
  const loading = Promise.all([
    readText(ASSET_FILES.githubCss(theme), 'GitHub Markdown CSS'),
    loadKatexCss(),
    readText(ASSET_FILES.mermaidJs(), 'mermaid.js'),
  ]).then(([githubCss, katexCss, mermaidJs]) => ({ theme, githubCss, katexCss, mermaidJs }));
  builtinAssets.set(theme, loading);
  // 失敗した読み込みをキャッシュし続けないようにする
  loading.catch(() => {
    builtinAssets.delete(theme);
  });
  return loading;
};

export type ExportAssetOptions = {
  readonly theme: Theme;
  /** false のとき GitHub スタイルを含めない */
  readonly defaultCss: boolean;
  readonly customCss?: string;
};

/** build / serve --out のオプションからアセットの指定を取り出す */
export const exportAssetOptions = (options: {
  readonly theme: Theme;
  readonly defaultCss: boolean;
  readonly css?: string;
}): ExportAssetOptions => ({
  theme: options.theme,
  defaultCss: options.defaultCss,
  ...(options.css === undefined ? {} : { customCss: options.css }),
});

/** 出力 HTML に埋め込むアセットを読み込む。カスタム CSS は変更され得るため毎回読む */
export const loadExportAssets = async (options: ExportAssetOptions): Promise<ExportAssets> => {
  const [{ githubCss, ...builtin }, customCss] = await Promise.all([
    loadBuiltinAssets(options.theme),
    options.customCss === undefined ? undefined : readText(options.customCss, 'custom CSS'),
  ]);
  return {
    ...builtin,
    ...(options.defaultCss && githubCss !== undefined ? { githubCss } : {}),
    ...(customCss === undefined ? {} : { customCss }),
  };
};
