import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isInside, isMarkdownPath, toRelativePosix } from './paths.js';

/** 名前だけで常に除外するディレクトリ */
export const IGNORED_DIR_NAMES: ReadonlySet<string> = new Set(['node_modules', '.git']);

export type ScanOptions = {
  /** 除外するディレクトリの絶対パス（出力先など） */
  readonly excludeDirs?: readonly string[];
};

export const isExcludedDir = (dir: string, excludeDirs: readonly string[]): boolean =>
  IGNORED_DIR_NAMES.has(path.basename(dir)) || excludeDirs.some((excluded) => isInside(excluded, dir));

/**
 * root 配下の Markdown ファイルを列挙し、root からの相対パス（区切りは `/`）を昇順で返す。
 * シンボリックリンクは循環を避けるため辿らない。
 */
export const scanMarkdownFiles = async (root: string, options: ScanOptions = {}): Promise<readonly string[]> => {
  const excludeDirs = options.excludeDirs ?? [];

  const walk = async (dir: string): Promise<readonly string[]> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch((cause: unknown) => {
      throw new Error(`failed to read directory ${dir}`, { cause });
    });
    const nested = await Promise.all(
      entries.map(async (entry): Promise<readonly string[]> => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return isExcludedDir(fullPath, excludeDirs) ? [] : walk(fullPath);
        return entry.isFile() && isMarkdownPath(entry.name) ? [toRelativePosix(root, fullPath)] : [];
      }),
    );
    return nested.flat();
  };

  return [...(await walk(root))].sort();
};
