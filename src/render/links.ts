import path from 'node:path';
import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import { toPosix } from '../fs/paths.js';

export type LinkMode = 'serve' | 'export';

// rehype-sanitize が id / name に付ける接頭辞（GitHub と同じ）
const CLOBBER_PREFIX = 'user-content-';
const MARKDOWN_EXT = /\.(md|markdown)$/i;

export const isExternalUrl = (url: string): boolean =>
  /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//');

const splitSuffix = (url: string): { readonly pathname: string; readonly suffix: string } => {
  const index = url.search(/[?#]/);
  return index === -1
    ? { pathname: url, suffix: '' }
    : { pathname: url.slice(0, index), suffix: url.slice(index) };
};

/**
 * 出力 HTML 用に URL を書き換える。
 * - `.md` / `.markdown` へのリンクは `.html` に置き換える
 * - ルート相対パス（`/foo`）は出力ファイルからの相対パスに変換する
 */
export const toExportUrl = (url: string, filePath: string): string => {
  if (url === '' || url.startsWith('#') || isExternalUrl(url)) return url;
  const { pathname, suffix } = splitSuffix(url);
  if (pathname === '') return url;

  const relative = pathname.startsWith('/')
    ? path.posix.relative(path.posix.dirname(filePath), pathname.slice(1)) || path.posix.basename(pathname)
    : pathname;
  return relative.replace(MARKDOWN_EXT, '.html') + suffix;
};

const collectIds = (tree: Root): ReadonlySet<string> => {
  const ids = new Set<string>();
  visit(tree, 'element', (node: Element) => {
    const id = node.properties['id'];
    if (typeof id === 'string') ids.add(id);
    // `<a name="...">` もページ内リンクの移動先になる
    const name = node.properties['name'];
    if (node.tagName === 'a' && typeof name === 'string') ids.add(name);
  });
  return ids;
};

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    // 不正なパーセントエンコーディングはそのまま比較する
    return value;
  }
};

/**
 * サニタイズで接頭辞が付いた id に合わせて、ページ内リンク（`#foo`）を書き換える。
 * GitHub はクライアント側の JS で解決しているが、出力 HTML 単体でも動くよう静的に解決する。
 */
export const resolveFragment = (href: string, ids: ReadonlySet<string>): string => {
  if (!href.startsWith('#') || href.length === 1) return href;
  const id = safeDecode(href.slice(1));
  return !ids.has(id) && ids.has(CLOBBER_PREFIX + id) ? `#${CLOBBER_PREFIX}${href.slice(1)}` : href;
};

const rewriteAttribute = (node: Element, name: 'href' | 'src', rewrite: (url: string) => string): void => {
  const value = node.properties[name];
  if (typeof value === 'string') node.properties[name] = rewrite(value);
};

export const rehypeLinks = () => (tree: Root, file: VFile): void => {
  const mode = file.data.mdlive?.linkMode ?? 'serve';
  const filePath = toPosix(file.path);
  const ids = collectIds(tree);

  visit(tree, 'element', (node: Element) => {
    if (node.tagName === 'a') {
      rewriteAttribute(node, 'href', (href) => {
        const resolved = resolveFragment(href, ids);
        return mode === 'export' ? toExportUrl(resolved, filePath) : resolved;
      });
    }
    if (node.tagName === 'img' && mode === 'export') {
      rewriteAttribute(node, 'src', (src) => toExportUrl(src, filePath));
    }
  });
};
