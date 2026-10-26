import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import { resolveInside, toPosix } from '../fs/paths.js';
import { isExternalUrl } from '../render/links.js';

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

export type InlineImagesOptions = {
  /** ルートディレクトリの絶対パス */
  readonly root: string;
};

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** img の src を、ルートからの相対パス（区切りは `/`）に変換する。対象外なら undefined */
export const imageSourceToRelative = (src: string, filePath: string): string | undefined => {
  if (src === '' || src.startsWith('#') || isExternalUrl(src)) return undefined;
  const pathname = safeDecode(src.split(/[?#]/, 1)[0] ?? '');
  if (pathname === '') return undefined;
  return pathname.startsWith('/')
    ? path.posix.normalize(pathname.slice(1))
    : path.posix.join(path.posix.dirname(toPosix(filePath)), pathname);
};

export const mimeTypeFor = (filePath: string): string | undefined =>
  IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()];

/**
 * ローカル画像を data URI として埋め込む rehype プラグイン。
 * 埋め込めない画像は元の src を残し、VFile の警告として報告する。
 */
export const rehypeInlineImages = (options: InlineImagesOptions) => async (tree: Root, file: VFile): Promise<void> => {
  const images: Element[] = [];
  visit(tree, 'element', (node: Element) => {
    if (node.tagName === 'img' && typeof node.properties['src'] === 'string') images.push(node);
  });

  await Promise.all(
    images.map(async (node) => {
      const src = String(node.properties['src']);
      const relative = imageSourceToRelative(src, file.path);
      if (relative === undefined) return;

      const absolute = resolveInside(options.root, relative);
      if (absolute === undefined) {
        file.message(`image outside the root directory is not embedded: ${src}`);
        return;
      }
      const mimeType = mimeTypeFor(absolute);
      if (mimeType === undefined) {
        file.message(`unsupported image type is not embedded: ${src}`);
        return;
      }
      const data = await readFile(absolute).catch((cause: unknown) => {
        const code = cause instanceof Error && 'code' in cause ? String(cause.code) : 'unknown error';
        file.message(`image could not be read (${code}): ${src}`);
        return undefined;
      });
      if (data !== undefined) node.properties['src'] = `data:${mimeType};base64,${data.toString('base64')}`;
    }),
  );
};
