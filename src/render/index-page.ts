import type { LinkMode } from './links.js';
import { escapeHtml, type PageBody } from './page.js';

type TreeNode = {
  readonly name: string;
  /** ファイルの場合のみルートからの相対パス */
  readonly filePath?: string;
  readonly children: readonly TreeNode[];
};

const compareNodes = (a: TreeNode, b: TreeNode): number => {
  const aIsDir = a.filePath === undefined;
  const bIsDir = b.filePath === undefined;
  if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
  return a.name.localeCompare(b.name);
};

const buildTree = (files: readonly string[], prefix = ''): readonly TreeNode[] => {
  const groups = new Map<string, string[]>();
  const leaves: TreeNode[] = [];

  for (const file of files) {
    const separator = file.indexOf('/');
    if (separator === -1) {
      leaves.push({ name: file, filePath: prefix + file, children: [] });
    } else {
      const dir = file.slice(0, separator);
      groups.set(dir, [...(groups.get(dir) ?? []), file.slice(separator + 1)]);
    }
  }

  const dirs = [...groups].map(([name, rest]): TreeNode => ({
    name,
    children: buildTree(rest, `${prefix}${name}/`),
  }));
  return [...dirs, ...leaves].sort(compareNodes);
};

const hrefFor = (filePath: string, mode: LinkMode): string =>
  mode === 'serve' ? `/${encodeURI(filePath)}` : encodeURI(filePath.replace(/\.(md|markdown)$/i, '.html'));

const renderTree = (nodes: readonly TreeNode[], mode: LinkMode): string =>
  `<ul>${nodes
    .map((node) =>
      node.filePath === undefined
        ? `<li>${escapeHtml(node.name)}/${renderTree(node.children, mode)}</li>`
        : `<li><a href="${escapeHtml(hrefFor(node.filePath, mode))}">${escapeHtml(node.name)}</a></li>`,
    )
    .join('')}</ul>`;

/**
 * ファイル一覧ページの本文を作る。
 * @param files ルートからの相対パス（区切りは `/`）
 */
export const renderIndexBody = (rootName: string, files: readonly string[], mode: LinkMode): PageBody => ({
  title: rootName,
  hasMath: false,
  hasMermaid: false,
  hasImage: false,
  html: [
    `<h1>${escapeHtml(rootName)}</h1>`,
    files.length === 0 ? '<p>No Markdown files found.</p>' : renderTree(buildTree(files), mode),
  ].join('\n'),
});
