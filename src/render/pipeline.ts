import path from 'node:path';
import rehypeShiki from '@shikijs/rehype';
import type { Element, Root } from 'hast';
import { toString } from 'hast-util-to-string';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified, type PluggableList } from 'unified';
import { visit } from 'unist-util-visit';
import { VFile } from 'vfile';
import { remarkDirectives, sanitizeSchema } from './directives.js';
import { rehypeLinks, type LinkMode } from './links.js';
import type { RenderMeta } from './vfile-data.js';

export type RenderOptions = {
  /** ルートディレクトリからの相対パス（区切りは `/`） */
  readonly filePath: string;
  readonly linkMode: LinkMode;
};

export type RenderResult = RenderMeta & {
  readonly html: string;
  /** プラグインが報告した警告（画像を埋め込めなかった等） */
  readonly warnings: readonly string[];
  /** 埋め込み対象として参照したローカル画像（画像埋め込みプラグイン使用時のみ） */
  readonly images: readonly string[];
};

export type Renderer = (source: string, options: RenderOptions) => Promise<RenderResult>;

const hasClass = (node: Element, name: string): boolean => {
  const className = node.properties['className'];
  return Array.isArray(className) && className.includes(name);
};

/** ```mermaid のコードブロックを mermaid.js が描画する `<pre class="mermaid">` に置き換える */
const rehypeMermaid = () => (tree: Root): void => {
  visit(tree, 'element', (node: Element) => {
    const [code] = node.children;
    if (
      node.tagName !== 'pre' ||
      node.children.length !== 1 ||
      code?.type !== 'element' ||
      code.tagName !== 'code' ||
      !hasClass(code, 'language-mermaid')
    ) {
      return;
    }
    node.properties = { className: ['mermaid'] };
    node.children = [{ type: 'text', value: toString(code) }];
  });
};

const titleFromPath = (filePath: string): string =>
  path.posix.basename(filePath).replace(/\.(md|markdown)$/i, '') || filePath;

const rehypeCollectMeta = () => (tree: Root, file: VFile): void => {
  let title: string | undefined;
  let hasMath = false;
  let hasMermaid = false;

  visit(tree, 'element', (node: Element) => {
    if (title === undefined && node.tagName === 'h1') {
      const text = toString(node).trim();
      if (text !== '') title = text;
    }
    if (hasClass(node, 'katex')) hasMath = true;
    if (node.tagName === 'pre' && hasClass(node, 'mermaid')) hasMermaid = true;
  });

  file.data.mdliveMeta = { title: title ?? titleFromPath(file.path), hasMath, hasMermaid };
};

/**
 * Markdown → HTML 断片の変換器を作る。
 * プロセッサは一度だけ組み立て、ファイルごとの情報は VFile 経由で渡す。
 * `extraPlugins` はリンク書き換えの後に実行される（画像の埋め込みなど出力時の処理用）。
 */
export const createRenderer = (extraPlugins: PluggableList = []): Renderer => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirectives)
    // 脚注の id はサニタイズで接頭辞が付くため、ここでは付けない
    .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
    .use(rehypeRaw)
    // ユーザー入力由来の HTML はここで GitHub 準拠のスキーマ（div の class のみ追加許可）でサニタイズする。
    // 以降のプラグインはツール自身が生成する信頼済みの出力のみを追加する
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeMermaid)
    .use(rehypeKatex)
    .use(rehypeSlug)
    .use(rehypeShiki, {
      themes: { light: 'github-light', dark: 'github-dark' },
      lazy: true,
      fallbackLanguage: 'text',
    })
    .use(rehypeLinks)
    .use(extraPlugins)
    .use(rehypeCollectMeta)
    .use(rehypeStringify)
    .freeze();

  return async (source, { filePath, linkMode }) => {
    const file = new VFile({ value: source, path: filePath, data: { mdlive: { linkMode } } });
    const result = await processor.process(file).catch((cause: unknown) => {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`failed to render ${filePath}: ${reason}`, { cause });
    });
    const meta = result.data.mdliveMeta;
    if (meta === undefined) throw new Error(`failed to render ${filePath}: metadata was not collected`);
    return {
      ...meta,
      html: String(result),
      warnings: result.messages.map((message) => message.reason),
      images: result.data.mdliveImages ?? [],
    };
  };
};
