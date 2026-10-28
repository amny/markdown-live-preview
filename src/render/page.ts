import { viewerScript } from '../client/viewer.js';
import type { RenderMeta } from './vfile-data.js';

/** 配色。`auto` は OS のライト／ダーク設定（prefers-color-scheme）に追従する */
export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const isTheme = (value: unknown): value is Theme => THEMES.some((theme) => theme === value);

export type PageBody = RenderMeta & {
  readonly html: string;
};

export type ServePageInput = PageBody & {
  /** ルートからの相対パス。ファイル一覧ページでは空文字 */
  readonly filePath: string;
  readonly hasCustomCss: boolean;
  readonly theme: Theme;
  /** デフォルトスタイル（GitHub スタイルとレイアウト）を使うか */
  readonly defaultCss: boolean;
  /** 変換エラー。指定時はエラーバナーを表示する */
  readonly error?: string;
};

/** serve 用ページのエラーバナーの id（ブラウザ側スクリプトと共有） */
export const ERROR_BANNER_ID = 'mdlive-error';

/** 出力 HTML に埋め込むアセット。katexCss はフォントを data URI 化済みであること */
export type ExportAssets = {
  readonly theme: Theme;
  /** theme に対応する GitHub スタイル。デフォルトスタイル無効時は指定しない */
  readonly githubCss?: string;
  readonly katexCss: string;
  readonly mermaidJs: string;
  readonly customCss?: string;
};

export const SERVE_PATHS = {
  githubCss: '/__mdlive/assets/github-markdown.css',
  katexCss: '/__mdlive/assets/katex.css',
  mermaidJs: '/__mdlive/assets/mermaid.min.js',
  customCss: '/__mdlive/assets/custom.css',
  client: '/__mdlive/client.js',
} as const;

export const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** `<style>` / `<script>` 内に埋め込む文字列が、閉じタグで要素を抜け出さないようにする */
export const escapeRawText = (text: string, tagName: 'style' | 'script'): string =>
  text.replace(new RegExp(`</(${tagName})`, 'gi'), '<\\/$1');

// 以下の LAYOUT_CSS・BACKGROUND_CSS は見た目のためのデフォルトスタイル（--no-default-css で外す）
const LAYOUT_CSS = `
.markdown-body { box-sizing: border-box; min-width: 200px; max-width: 980px; margin: 0 auto; padding: 45px; }
@media (max-width: 767px) { .markdown-body { padding: 15px; } }
/* コードブロックの背景は Shiki のテーマ色ではなく GitHub と同じ色にする */
.markdown-body pre.shiki { background-color: var(--bgColor-muted) !important; }
`;

const BACKGROUND_CSS = {
  light: 'body { margin: 0; background-color: #ffffff; }',
  dark: 'body { margin: 0; background-color: #0d1117; }',
} as const;

// 以下はデフォルトスタイルの有無に関わらず表示に必要なもの
// 脚注の見出しなど、スクリーンリーダー向けの要素（GitHub 本体の CSS にある定義）
const SR_ONLY_CSS =
  '.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }';
const SHIKI_DARK_CSS = '.shiki span { color: var(--shiki-dark) !important; }';

/**
 * 配色に応じたページ共通の CSS。auto のときだけ OS の設定でダーク用の指定を切り替える。
 * `defaultCss` が false のときは表示に必要な最小限の指定だけを返す
 */
export const baseCss = (theme: Theme, defaultCss: boolean): string => {
  const light = defaultCss ? [BACKGROUND_CSS.light] : [];
  const dark = [...(defaultCss ? [BACKGROUND_CSS.dark] : []), SHIKI_DARK_CSS];
  const colors = ((): readonly string[] => {
    switch (theme) {
      case 'auto':
        return ['html { color-scheme: light dark; }', ...light, `@media (prefers-color-scheme: dark) {\n${dark.join('\n')}\n}`];
      case 'light':
        return ['html { color-scheme: light; }', ...light];
      case 'dark':
        return ['html { color-scheme: dark; }', ...dark];
    }
  })();
  return [...colors, SR_ONLY_CSS, ...(defaultCss ? [LAYOUT_CSS] : [])].join('\n');
};

// mermaid.js の描画。auto では OS のライト／ダーク切り替え時に元のソースから描き直す。
// serve ではライブ更新後にクライアントから window.__mdliveRenderMermaid を呼ぶ
const mermaidBootstrap = (theme: Theme): string => `
(() => {
  const theme = ${JSON.stringify(theme)};
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (theme === 'auto' ? media.matches : theme === 'dark');
  const render = async (root = document) => {
    const mermaid = window.mermaid;
    if (!mermaid) return;
    const nodes = Array.from(root.querySelectorAll('pre.mermaid'));
    if (nodes.length === 0) return;
    for (const node of nodes) {
      if (node.dataset.source === undefined) {
        node.dataset.source = node.textContent ?? '';
      } else {
        node.removeAttribute('data-processed');
        node.textContent = node.dataset.source;
      }
    }
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default' });
    try {
      await mermaid.run({ nodes });
    } catch (error) {
      console.error('mdlive: failed to render mermaid diagram', error);
    }
  };
  window.__mdliveRenderMermaid = render;
  if (theme === 'auto') media.addEventListener('change', () => { void render(); });
  document.addEventListener('DOMContentLoaded', () => { void render(); });
})();
`;

const SERVE_CSS = `
#${ERROR_BANNER_ID} { position: sticky; top: 0; z-index: 10; margin: 0; padding: 12px 16px; background: #cf222e; color: #ffffff; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
#${ERROR_BANNER_ID}[hidden] { display: none; }
`;

const inlineStyle = (css: string): string => `<style>${escapeRawText(css, 'style')}</style>`;
const inlineScript = (js: string): string => `<script>${escapeRawText(js, 'script')}</script>`;

const htmlDocument = (head: readonly string[], bodyAttributes: string, body: string, beforeArticle = ''): string =>
  [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ...head,
    '</head>',
    `<body${bodyAttributes}>`,
    ...(beforeArticle === '' ? [] : [beforeArticle]),
    `<article class="markdown-body">${body}</article>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');

/**
 * serve 用のページ。ライブ更新で数式や図が後から増えても表示できるよう、
 * KaTeX と Mermaid のアセットは常に読み込む。
 */
export const renderServePage = (input: ServePageInput): string =>
  htmlDocument(
    [
      `<title>${escapeHtml(input.title)}</title>`,
      ...(input.defaultCss ? [`<link rel="stylesheet" href="${SERVE_PATHS.githubCss}">`] : []),
      `<link rel="stylesheet" href="${SERVE_PATHS.katexCss}">`,
      inlineStyle(baseCss(input.theme, input.defaultCss) + SERVE_CSS),
      ...(input.hasCustomCss ? [`<link rel="stylesheet" href="${SERVE_PATHS.customCss}" data-mdlive-custom-css>`] : []),
      `<script defer src="${SERVE_PATHS.mermaidJs}"></script>`,
      inlineScript(mermaidBootstrap(input.theme)),
      inlineScript(viewerScript()),
      `<script type="module" src="${SERVE_PATHS.client}"></script>`,
    ],
    ` data-mdlive-path="${escapeHtml(input.filePath)}"`,
    input.html,
    input.error === undefined
      ? `<pre id="${ERROR_BANNER_ID}" role="alert" hidden></pre>`
      : `<pre id="${ERROR_BANNER_ID}" role="alert">${escapeHtml(input.error)}</pre>`,
  );

/** 外部参照を持たない単一ファイル完結の出力用ページ */
export const renderExportPage = (body: PageBody, assets: ExportAssets): string =>
  htmlDocument(
    [
      `<title>${escapeHtml(body.title)}</title>`,
      ...(assets.githubCss === undefined ? [] : [inlineStyle(assets.githubCss)]),
      ...(body.hasMath ? [inlineStyle(assets.katexCss)] : []),
      inlineStyle(baseCss(assets.theme, assets.githubCss !== undefined)),
      ...(assets.customCss === undefined ? [] : [inlineStyle(assets.customCss)]),
      ...(body.hasMermaid ? [inlineScript(assets.mermaidJs), inlineScript(mermaidBootstrap(assets.theme))] : []),
      ...(body.hasImage || body.hasMermaid ? [inlineScript(viewerScript())] : []),
    ],
    '',
    body.html,
  );
