import path from 'node:path';
import { watch } from 'chokidar';
import { toRelativePosix } from '../fs/paths.js';
import { isExcludedDir } from '../fs/scan.js';

export type ChangeKind = 'add' | 'change' | 'unlink';

export type FileChange = {
  readonly kind: ChangeKind;
  /** ルートからの相対パス（区切りは `/`） */
  readonly path: string;
};

export type Watcher = {
  /** 初回走査が終わり、変更を検知できる状態になったら解決する */
  readonly ready: Promise<void>;
  readonly close: () => Promise<void>;
};

export const DEFAULT_DEBOUNCE_MS = 75;

/**
 * 同じファイルに連続したイベントを 1 つにまとめる。undefined は「何も起きなかった」ことを表す。
 * エディタのアトミック保存（unlink → add）は change として扱う。
 */
export const mergeChange = (previous: ChangeKind | undefined, next: ChangeKind): ChangeKind | undefined => {
  switch (next) {
    case 'unlink':
      return previous === 'add' ? undefined : 'unlink';
    case 'add':
      return previous === 'unlink' || previous === 'change' ? 'change' : 'add';
    case 'change':
      return previous === 'add' ? 'add' : 'change';
  }
};

export type Debouncer = {
  readonly push: (filePath: string, kind: ChangeKind) => void;
  readonly cancel: () => void;
};

/** 最後のイベントから delayMs 経過したら、まとめたイベントをパス順に渡す */
export const createDebouncer = (delayMs: number, flush: (changes: readonly FileChange[]) => void): Debouncer => {
  let pending = new Map<string, ChangeKind | undefined>();
  let timer: NodeJS.Timeout | undefined;

  const emit = (): void => {
    const changes = [...pending]
      .flatMap(([filePath, kind]) => (kind === undefined ? [] : [{ kind, path: filePath }]))
      .sort((a, b) => a.path.localeCompare(b.path));
    pending = new Map();
    timer = undefined;
    if (changes.length > 0) flush(changes);
  };

  return {
    push: (filePath, kind) => {
      pending.set(filePath, mergeChange(pending.get(filePath), kind));
      clearTimeout(timer);
      timer = setTimeout(emit, delayMs);
    },
    cancel: () => {
      clearTimeout(timer);
      pending = new Map();
    },
  };
};

export type WatchFilesOptions = {
  /** 監視対象のファイルか（拡張子などで判定する） */
  readonly isTarget: (filePath: string) => boolean;
  readonly excludeDirs?: readonly string[];
  readonly debounceMs?: number;
};

/** root 配下の対象ファイルの追加・変更・削除を監視する */
export const watchFiles = (
  root: string,
  options: WatchFilesOptions,
  onChanges: (changes: readonly FileChange[]) => void,
  onError: (error: Error) => void,
): Watcher => {
  const excludeDirs = options.excludeDirs ?? [];
  const debouncer = createDebouncer(options.debounceMs ?? DEFAULT_DEBOUNCE_MS, onChanges);

  const watcher = watch(root, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (target, stats) =>
      target !== root && (isExcludedDir(target, excludeDirs) || (stats?.isFile() === true && !options.isTarget(target))),
  });

  const push = (kind: ChangeKind) => (target: string) => {
    // ignored の判定時に stats が無い場合もあるため、ここでも拡張子を確認する
    if (options.isTarget(target)) debouncer.push(toRelativePosix(root, target), kind);
  };

  watcher
    .on('add', push('add'))
    .on('change', push('change'))
    .on('unlink', push('unlink'))
    .on('error', (error) => {
      onError(error instanceof Error ? error : new Error(`file watcher error: ${String(error)}`));
    });

  const ready = new Promise<void>((resolve) => watcher.once('ready', () => resolve()));

  return {
    ready,
    close: async () => {
      debouncer.cancel();
      await watcher.close();
    },
  };
};

/** 単一ファイル（カスタム CSS など）の変更を監視する */
export const watchSingleFile = (
  filePath: string,
  options: { readonly debounceMs?: number },
  onChange: () => void,
  onError: (error: Error) => void,
): Watcher => {
  const debouncer = createDebouncer(options.debounceMs ?? DEFAULT_DEBOUNCE_MS, onChange);
  const watcher = watch(filePath, { ignoreInitial: true });
  const push = (kind: ChangeKind) => () => debouncer.push(path.basename(filePath), kind);

  watcher
    .on('add', push('add'))
    .on('change', push('change'))
    .on('unlink', push('unlink'))
    .on('error', (error) => {
      onError(error instanceof Error ? error : new Error(`file watcher error: ${String(error)}`));
    });

  const ready = new Promise<void>((resolve) => watcher.once('ready', () => resolve()));

  return {
    ready,
    close: async () => {
      debouncer.cancel();
      await watcher.close();
    },
  };
};
