import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isInside, toHtmlPath } from '../fs/paths.js';
import { scanMarkdownFiles } from '../fs/scan.js';
import { describeError, type Logger } from '../log.js';
import type { BuildOptions } from '../options.js';
import { DEFAULT_FRONT_MATTER, type FrontMatterMode } from '../render/front-matter.js';
import { renderIndexBody } from '../render/index-page.js';
import { renderExportPage, type ExportAssets } from '../render/page.js';
import { createRenderer, type Renderer } from '../render/pipeline.js';
import { exportAssetOptions, loadExportAssets } from './assets.js';
import { rehypeInlineImages } from './inline.js';
import { outputPathFor, pageSizeWarning, writeHtmlFile } from './writer.js';

/** Markdown ファイル → 埋め込みのため参照しているローカル画像 */
export type ImageReferences = ReadonlyMap<string, readonly string[]>;

export type BuildReport = {
  readonly written: readonly string[];
  readonly images: ImageReferences;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
};

const INDEX_FILE = 'index.html';

/** 出力先が root と同じ、または root を含む場合はエラーメッセージを返す */
export const validateOutDir = (root: string, outDir: string): string | undefined =>
  isInside(outDir, root) ? `output directory must not be the root directory or its parent: ${outDir}` : undefined;

/** 同じ出力パスになる Markdown ファイル（a.md と a.markdown など）を検出する */
export const findOutputConflicts = (files: readonly string[]): readonly string[] => {
  const byOutput = Map.groupBy(files, (file) => toHtmlPath(file).toLowerCase());
  return [...byOutput.values()]
    .filter((group) => group.length > 1)
    .map((group) => `multiple files map to the same output ${toHtmlPath(group[0] ?? '')}: ${group.join(', ')}`);
};

export type ExportedFile = {
  readonly html: string;
  readonly warnings: readonly string[];
  readonly images: readonly string[];
};

/** Markdown を変換し、出力 HTML の本文と警告、参照した画像を返す */
export const exportMarkdownFile = async (
  render: Renderer,
  root: string,
  filePath: string,
  assets: ExportAssets,
): Promise<ExportedFile> => {
  const absolute = path.join(root, ...filePath.split('/'));
  const source = await readFile(absolute, 'utf8').catch((cause: unknown) => {
    throw new Error(`failed to read ${absolute}`, { cause });
  });
  const result = await render(source, { filePath, linkMode: 'export' });
  const html = renderExportPage(result, assets);
  const sizeWarning = pageSizeWarning(html);
  return {
    html,
    warnings: sizeWarning === undefined ? result.warnings : [...result.warnings, sizeWarning],
    images: result.images,
  };
};

export const createExportRenderer = (root: string, frontMatter: FrontMatterMode = DEFAULT_FRONT_MATTER): Renderer =>
  createRenderer([[rehypeInlineImages, { root }]], { frontMatter });

/** 1 ファイルを変換して出力先に書き出し、警告と参照した画像を返す */
export const exportFileToOutput = async (
  render: Renderer,
  root: string,
  outDir: string,
  filePath: string,
  assets: ExportAssets,
): Promise<Omit<ExportedFile, 'html'>> => {
  const { html, warnings, images } = await exportMarkdownFile(render, root, filePath, assets);
  await writeHtmlFile(outputPathFor(outDir, filePath), html);
  return { warnings, images };
};

/**
 * ファイル一覧の index.html を書き出す。
 * ルートに index.md 等があればそれが index.html になるため、一覧は書き出さず false を返す。
 */
export const writeIndexPage = async (
  root: string,
  outDir: string,
  files: readonly string[],
  assets: ExportAssets,
): Promise<boolean> => {
  if (files.some((file) => toHtmlPath(file).toLowerCase() === INDEX_FILE)) return false;
  const indexBody = renderIndexBody(path.basename(root), files, 'export');
  await writeHtmlFile(path.join(outDir, INDEX_FILE), renderExportPage(indexBody, assets));
  return true;
};

type FileOutcome =
  | {
      readonly kind: 'written';
      readonly filePath: string;
      readonly warnings: readonly string[];
      readonly images: readonly string[];
    }
  | { readonly kind: 'failed'; readonly filePath: string; readonly error: string };

export const buildSite = async (options: BuildOptions, log: Logger): Promise<BuildReport> => {
  const outDirError = validateOutDir(options.root, options.out);
  if (outDirError !== undefined) throw new Error(outDirError);

  const files = await scanMarkdownFiles(options.root, { excludeDirs: [options.out] });
  const conflicts = findOutputConflicts(files);
  if (conflicts.length > 0) throw new Error(conflicts.join('\n'));

  const assets = await loadExportAssets(exportAssetOptions(options));
  const render = createExportRenderer(options.root, options.frontMatter);

  // Shiki の言語読み込みなどを共有するため、1 ファイルずつ順に処理する
  const outcomes: FileOutcome[] = [];
  for (const filePath of files) {
    try {
      const { warnings, images } = await exportFileToOutput(render, options.root, options.out, filePath, assets);
      warnings.forEach((warning) => log.warn(`${filePath}: ${warning}`));
      outcomes.push({ kind: 'written', filePath, warnings, images });
    } catch (error) {
      const message = `${filePath}: ${describeError(error)}`;
      log.error(message);
      outcomes.push({ kind: 'failed', filePath, error: message });
    }
  }

  if (!(await writeIndexPage(options.root, options.out, files, assets))) {
    log.info(`skipped generating the file list because ${INDEX_FILE} is produced from Markdown`);
  }

  const written = outcomes.flatMap((outcome) => (outcome.kind === 'written' ? [outcome.filePath] : []));
  return {
    written,
    images: new Map(
      outcomes.flatMap((outcome) => (outcome.kind === 'written' ? [[outcome.filePath, outcome.images] as const] : [])),
    ),
    warnings: outcomes.flatMap((outcome) =>
      outcome.kind === 'written' ? outcome.warnings.map((warning) => `${outcome.filePath}: ${warning}`) : [],
    ),
    errors: outcomes.flatMap((outcome) => (outcome.kind === 'failed' ? [outcome.error] : [])),
  };
};
