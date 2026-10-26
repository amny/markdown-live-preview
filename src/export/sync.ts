import { scanMarkdownFiles } from '../fs/scan.js';
import { describeError, type Logger } from '../log.js';
import type { FileChange } from '../watch/watcher.js';
import { loadExportAssets } from './assets.js';
import { buildSite, createExportRenderer, exportFileToOutput, writeIndexPage } from './build.js';
import { outputPathFor, removeHtmlFile } from './writer.js';

export type OutputSyncOptions = {
  readonly root: string;
  readonly out: string;
  readonly css?: string;
};

export type OutputSync = {
  /** 全ファイルを書き出し直す（起動時・カスタム CSS 変更時） */
  readonly rebuildAll: () => void;
  /** 変更されたファイルだけを書き出し、または削除する */
  readonly apply: (changes: readonly FileChange[]) => void;
  /** 実行中・待機中の書き出しがすべて終わるまで待つ */
  readonly idle: () => Promise<void>;
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
  const render = createExportRenderer(options.root);
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (label: string, task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error: unknown) => {
      log.error(`${label}: ${describeError(error)}`);
    });
  };

  const syncFile = async (change: FileChange, assets: Awaited<ReturnType<typeof loadExportAssets>>): Promise<void> => {
    try {
      if (change.kind === 'unlink') {
        await removeHtmlFile(outputPathFor(options.out, change.path));
        return;
      }
      const warnings = await exportFileToOutput(render, options.root, options.out, change.path, assets);
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
        log.info(
          `wrote ${report.written.length} file(s) to ${options.out}` +
            ` (${report.warnings.length} warning(s), ${report.errors.length} error(s))`,
        );
      }),
    apply: (changes) =>
      enqueue('failed to update HTML output', async () => {
        const assets = await loadExportAssets(options.css);
        for (const change of changes) await syncFile(change, assets);
        // ファイルの追加・削除があった場合は一覧も書き直す
        if (changes.some((change) => change.kind !== 'change')) {
          const files = await scanMarkdownFiles(options.root, { excludeDirs: [options.out] });
          await writeIndexPage(options.root, options.out, files, assets);
        }
      }),
    idle: () => queue,
  };
};
