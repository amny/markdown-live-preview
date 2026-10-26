import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveInside, toHtmlPath } from '../fs/paths.js';

/** 1 ページがこれを超えたら警告する */
export const MAX_PAGE_BYTES = 10 * 1024 * 1024;

export const pageSizeWarning = (html: string): string | undefined => {
  const bytes = Buffer.byteLength(html, 'utf8');
  return bytes > MAX_PAGE_BYTES
    ? `output is ${(bytes / 1024 / 1024).toFixed(1)}MB, larger than ${MAX_PAGE_BYTES / 1024 / 1024}MB`
    : undefined;
};

/** Markdown ファイル（root からの相対パス）に対応する出力 HTML の絶対パス */
export const outputPathFor = (outDir: string, filePath: string): string => {
  const resolved = resolveInside(outDir, toHtmlPath(filePath));
  if (resolved === undefined) throw new Error(`output path escapes the output directory: ${filePath}`);
  return resolved;
};

export const writeHtmlFile = async (outputPath: string, html: string): Promise<void> => {
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, 'utf8');
  } catch (cause) {
    throw new Error(`failed to write ${outputPath}`, { cause });
  }
};

export const removeHtmlFile = async (outputPath: string): Promise<void> => {
  await rm(outputPath, { force: true }).catch((cause: unknown) => {
    throw new Error(`failed to remove ${outputPath}`, { cause });
  });
};
