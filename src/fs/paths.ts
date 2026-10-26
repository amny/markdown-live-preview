import path from 'node:path';

const MARKDOWN_EXT = /\.(md|markdown)$/i;

export const isMarkdownPath = (filePath: string): boolean => MARKDOWN_EXT.test(filePath);

/** `.md` / `.markdown` を `.html` に置き換える */
export const toHtmlPath = (filePath: string): string => filePath.replace(MARKDOWN_EXT, '.html');

export const toPosix = (filePath: string): string => filePath.split(path.sep).join('/');

/** target が root 自身またはその配下にあるか（どちらも絶対パス） */
export const isInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/** root からの相対パス（区切りは `/`）を返す */
export const toRelativePosix = (root: string, target: string): string => toPosix(path.relative(root, target));

/**
 * root からの相対パス（区切りは `/`）を絶対パスに解決する。
 * root の外を指す場合は undefined を返す。
 */
export const resolveInside = (root: string, relativePosix: string): string | undefined => {
  const resolved = path.resolve(root, ...relativePosix.split('/'));
  return isInside(root, resolved) ? resolved : undefined;
};
