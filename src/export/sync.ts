import { scanMarkdownFiles } from '../fs/scan.js';
import { describeError, type Logger } from '../log.js';
import type { FileChange } from '../watch/watcher.js';
import type { FrontMatterMode } from '../render/front-matter.js';
import type { Theme } from '../render/page.js';
import { loadExportAssets } from './assets.js';
import { buildSite, createExportRenderer, exportFileToOutput, writeIndexPage, type ImageReferences } from './build.js';
import { outputPathFor, removeHtmlFile } from './writer.js';

export type OutputSyncOptions = {
  readonly root: string;
  readonly out: string;
  readonly css?: string;
  readonly theme: Theme;
  readonly frontMatter: FrontMatterMode;
};

export type OutputSync = {
  /** 全ファイルを書き出し直す（起動時・カスタム CSS 変更時） */
  readonly rebuildAll: () => void;
  /** 変更された Markdown ファイルだけを書き出し、または削除する */
  readonly apply: (changes: readonly FileChange[]) => void;
  /** 変更された画像を埋め込んでいるページを書き出し直す */
  readonly applyImages: (changes: readonly FileChange[]) => void;
  /** 実行中・待機中の書き出しがすべて終わるまで待つ */
  readonly idle: () => Promise<void>;
};

/** 指定した画像のいずれかを参照している Markdown ファイルをパス順に返す */
export const dependentsOf = (references: ImageReferences, images: readonly string[]): readonly string[] => {
  const targets = new Set(images);
  return [...references]
    .filter(([, referenced]) => referenced.some((image) => targets.has(image)))
    .map(([filePath]) => filePath)
    .sort();
};

/** 1 ファイル分の参照を差し替えた新しい対応表を返す。images が undefined なら削除する */
export const withReferences = (
  references: ImageReferences,
  filePath: string,
  images: readonly string[] | undefined,
): ImageReferences => {
  const next = new Map(references);
  if (images === undefined) next.delete(filePath);
  else next.set(filePath, images);
  return next;
};

/**
 * serve --out 用に、変更を出力 HTML へ反映する。
 * 書き出しの競合を避けるため、処理はキューで 1 つずつ実行する。
 */
export const createOutputSync = (
  options: OutputSyncOptions,
  log: Logger,
  onFileError: (filePath: string, message: string) => void,
): OutputSync => {
  const render = createExportRenderer(options.root, options.frontMatter);
  let queue: Promise<void> = Promise.resolve();
  let references: ImageReferences = new Map();

  const enqueue = (label: string, task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error: unknown) => {
      log.error(`${label}: ${describeError(error)}`);
    });
  };

  const syncFile = async (change: FileChange, assets: Awaited<ReturnType<typeof loadExportAssets>>): Promise<void> => {
    try {
      if (change.kind === 'unlink') {
        references = withReferences(references, change.path, undefined);
        await removeHtmlFile(outputPathFor(options.out, change.path));
        return;
      }
      const { warnings, images } = await exportFileToOutput(
        render,
        options.root,
        options.out,
        change.path,
        assets,
      );
      references = withReferences(references, change.path, images);
      warnings.forEach((warning) => log.warn(`${change.path}: ${warning}`));
    } catch (error) {
      const message = `failed to write HTML output for ${change.path}: ${describeError(error)}`;
      log.error(message);
      onFileError(change.path, message);
    }
  };

  return {
    rebuildAll: () =>
      enqueue('failed to write HTML output', async () => {
        const report = await buildSite({ ...options, strict: false }, log);
        references = report.images;
        log.info(
          `wrote ${report.written.length} file(s) to ${options.out}` +
            ` (${report.warnings.length} warning(s), ${report.errors.length} error(s))`,
        );
      }),
    apply: (changes) =>
      enqueue('failed to update HTML output', async () => {
        const assets = await loadExportAssets(options.theme, options.css);
        for (const change of changes) await syncFile(change, assets);
        // ファイルの追加・削除があった場合は一覧も書き直す
        if (changes.some((change) => change.kind !== 'change')) {
          const files = await scanMarkdownFiles(options.root, { excludeDirs: [options.out] });
          await writeIndexPage(options.root, options.out, files, assets);
        }
      }),
    applyImages: (changes) =>
      enqueue('failed to update HTML output', async () => {
        // 参照先の判定はキュー内で行い、先行する書き出しで更新された対応表を使う
        const dependents = dependentsOf(
          references,
          changes.map((change) => change.path),
        );
        if (dependents.length === 0) return;
        const assets = await loadExportAssets(options.theme, options.css);
        for (const filePath of dependents) await syncFile({ kind: 'change', path: filePath }, assets);
        log.info(`re-exported ${dependents.length} file(s) that embed changed images`);
      }),
    idle: () => queue,
  };
};
