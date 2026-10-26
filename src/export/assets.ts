import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ExportAssets } from '../render/page.js';

const require = createRequire(import.meta.url);

/** パッケージ内のファイルの絶対パス */
export const ASSET_FILES = {
  githubCss: () => require.resolve('github-markdown-css/github-markdown.css'),
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

let builtinAssets: Promise<BuiltinAssets> | undefined;

/** 組み込みアセットはプロセス内で一度だけ読み込む */
const loadBuiltinAssets = (): Promise<BuiltinAssets> => {
  builtinAssets ??= Promise.all([
    readText(ASSET_FILES.githubCss(), 'GitHub Markdown CSS'),
    loadKatexCss(),
    readText(ASSET_FILES.mermaidJs(), 'mermaid.js'),
  ]).then(([githubCss, katexCss, mermaidJs]) => ({ githubCss, katexCss, mermaidJs }));
  // 失敗した読み込みをキャッシュし続けないようにする
  builtinAssets.catch(() => {
    builtinAssets = undefined;
  });
  return builtinAssets;
};

/** 出力 HTML に埋め込むアセットを読み込む。カスタム CSS は変更され得るため毎回読む */
export const loadExportAssets = async (customCssPath?: string): Promise<ExportAssets> => {
  const [builtin, customCss] = await Promise.all([
    loadBuiltinAssets(),
    customCssPath === undefined ? undefined : readText(customCssPath, 'custom CSS'),
  ]);
  return customCss === undefined ? builtin : { ...builtin, customCss };
};
