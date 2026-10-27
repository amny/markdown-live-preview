import type { AssetSource } from '../assets/source.js';
import { validateOutDir } from '../export/build.js';
import { createOutputSync } from '../export/sync.js';
import type { Logger } from '../log.js';
import type { ServeOptions } from '../options.js';
import { createRenderer, type Renderer } from '../render/pipeline.js';
import { isImagePath, isMarkdownPath } from '../fs/paths.js';
import { watchFiles, watchSingleFile, type FileChange, type Watcher } from '../watch/watcher.js';
import { createReloadHub, type ReloadHub } from './reload-hub.js';
import { startServerWithFallback, type RunningServer } from './server.js';

export type ServeHandle = RunningServer;

export type ServeTuning = {
  /** テスト用にイベントのまとめ時間を短くする */
  readonly debounceMs?: number;
};

/** Shiki の初期化には時間がかかるため、起動直後にバックグラウンドで済ませておく */
const warmUp = (render: Renderer, log: Logger): void => {
  render('```ts\nconst a = 1;\n```', { filePath: 'warm-up.md', linkMode: 'serve' }).catch((error: unknown) => {
    log.warn(`failed to warm up the renderer: ${error instanceof Error ? error.message : String(error)}`);
  });
};

/** 変更をブラウザへ通知する。追加・削除があればファイル一覧も更新させる */
export const notifyChanges = (hub: ReloadHub, changes: readonly FileChange[]): void => {
  if (changes.some((change) => change.kind !== 'change')) hub.broadcast({ type: 'tree' });
  changes.forEach((change) => hub.broadcast({ type: 'update', path: change.path }));
};

/** 監視で得た変更を Markdown と画像に振り分ける */
export const splitChanges = (
  changes: readonly FileChange[],
): { readonly markdown: readonly FileChange[]; readonly images: readonly FileChange[] } => ({
  markdown: changes.filter((change) => isMarkdownPath(change.path)),
  images: changes.filter((change) => isImagePath(change.path)),
});

const reportWatchError =(log: Logger) => (error: Error) => log.error(`file watcher: ${error.message}`);

export const startServe = async (
  options: ServeOptions,
  assets: AssetSource,
  log: Logger,
  tuning: ServeTuning = {},
): Promise<ServeHandle> => {
  if (options.out !== undefined) {
    const outDirError = validateOutDir(options.root, options.out);
    if (outDirError !== undefined) throw new Error(outDirError);
  }
  const excludeDirs = options.out === undefined ? [] : [options.out];
  const watchOptions = tuning.debounceMs === undefined ? {} : { debounceMs: tuning.debounceMs };

  const render = createRenderer([], { frontMatter: options.frontMatter });
  warmUp(render, log);
  const hub = createReloadHub();

  const server = await startServerWithFallback(
    {
      root: options.root,
      host: options.host,
      ...(options.css === undefined ? {} : { customCss: options.css }),
      theme: options.theme,
      defaultCss: options.defaultCss,
      assets,
      excludeDirs,
      render,
      hub,
      log,
    },
    options.port,
  );

  const output =
    options.out === undefined
      ? undefined
      : createOutputSync(
          {
            root: options.root,
            out: options.out,
            theme: options.theme,
            defaultCss: options.defaultCss,
            frontMatter: options.frontMatter,
            ...(options.css === undefined ? {} : { css: options.css }),
          },
          log,
          (path, message) => hub.broadcast({ type: 'error', path, message }),
        );
  output?.rebuildAll();

  const watchers: readonly Watcher[] = [
    watchFiles(
      options.root,
      { isTarget: (target) => isMarkdownPath(target) || isImagePath(target), excludeDirs, ...watchOptions },
      (changes) => {
        changes.forEach((change) => log.info(`${change.kind}: ${change.path}`));
        const { markdown, images } = splitChanges(changes);
        if (markdown.length > 0) {
          notifyChanges(hub, markdown);
          output?.apply(markdown);
        }
        if (images.length > 0) {
          images.forEach((change) => hub.broadcast({ type: 'asset', path: change.path }));
          output?.applyImages(images);
        }
      },
      reportWatchError(log),
    ),
    ...(options.css === undefined
      ? []
      : [
          watchSingleFile(
            options.css,
            watchOptions,
            () => {
              log.info('custom CSS changed');
              hub.broadcast({ type: 'css' });
              output?.rebuildAll();
            },
            reportWatchError(log),
          ),
        ]),
  ];

  return {
    url: server.url,
    port: server.port,
    close: async () => {
      await Promise.all(watchers.map((watcher) => watcher.close()));
      await output?.idle();
      await server.close();
    },
  };
};
