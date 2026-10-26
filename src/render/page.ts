import type { RenderMeta } from './vfile-data.js';

export type PageBody = RenderMeta & {
  readonly html: string;
};

export type ServePageInput = PageBody & {
  /** ルートからの相対パス。ファイル一覧ページでは空文字 */
  readonly filePath: string;
  readonly hasCustomCss: boolean;
  /** 変換エラー。指定時はエラーバナーを表示する */
  readonly error?: string;
};

/** serve 用ページのエラーバナーの id（ブラウザ側スクリプトと共有） */
export const ERROR_BANNER_ID = 'mdlive-error';

/** 出力 HTML に埋め込むアセット。katexCss はフォントを data URI 化済みであること */
export type ExportAssets = {
  readonly githubCss: string;
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

const BASE_CSS = `
html { color-scheme: light dark; }
body { margin: 0; background-color: #ffffff; }
.markdown-body { box-sizing: border-box; min-width: 200px; max-width: 980px; margin: 0 auto; padding: 45px; }
@media (max-width: 767px) { .markdown-body { padding: 15px; } }
/* コードブロックの背景は Shiki のテーマ色ではなく GitHub と同じ色にする */
.markdown-body pre.shiki { background-color: var(--bgColor-muted) !important; }
/* 脚注の見出しなど、スクリーンリーダー向けの要素（GitHub 本体の CSS にある定義） */
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (prefers-color-scheme: dark) {
  body { background-color: #0d1117; }
  .shiki span { color: var(--shiki-dark) !important; }
}
`;

// mermaid.js の描画。OS のライト／ダーク切り替え時は元のソースから描き直す。
// serve ではライブ更新後にクライアントから window.__mdliveRenderMermaid を呼ぶ
const MERMAID_BOOTSTRAP = `
(() => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
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
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: media.matches ? 'dark' : 'default' });
    try {
      await mermaid.run({ nodes });
    } catch (error) {
      console.error('mdlive: failed to render mermaid diagram', error);
    }
  };
  window.__mdliveRenderMermaid = render;
  media.addEventListener('change', () => { void render(); });
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
      `<link rel="stylesheet" href="${SERVE_PATHS.githubCss}">`,
      `<link rel="stylesheet" href="${SERVE_PATHS.katexCss}">`,
      inlineStyle(BASE_CSS + SERVE_CSS),
      ...(input.hasCustomCss ? [`<link rel="stylesheet" href="${SERVE_PATHS.customCss}" data-mdlive-custom-css>`] : []),
      `<script defer src="${SERVE_PATHS.mermaidJs}"></script>`,
      inlineScript(MERMAID_BOOTSTRAP),
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
      inlineStyle(assets.githubCss),
      ...(body.hasMath ? [inlineStyle(assets.katexCss)] : []),
      inlineStyle(BASE_CSS),
      ...(assets.customCss === undefined ? [] : [inlineStyle(assets.customCss)]),
      ...(body.hasMermaid ? [inlineScript(assets.mermaidJs), inlineScript(MERMAID_BOOTSTRAP)] : []),
    ],
    '',
    body.html,
  );
