import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDebouncer,
  mergeChange,
  watchMarkdown,
  watchSingleFile,
  type ChangeKind,
  type FileChange,
  type Watcher,
} from '../../src/watch/watcher.js';

describe('mergeChange', () => {
  it.each<[ChangeKind | undefined, ChangeKind, ChangeKind | undefined]>([
    [undefined, 'add', 'add'],
    [undefined, 'change', 'change'],
    [undefined, 'unlink', 'unlink'],
    ['add', 'change', 'add'],
    ['add', 'unlink', undefined],
    ['change', 'change', 'change'],
    ['change', 'unlink', 'unlink'],
    ['unlink', 'add', 'change'],
    ['change', 'add', 'change'],
  ])('%s then %s is %s', (previous, next, expected) => {
    expect(mergeChange(previous, next)).toBe(expected);
  });
});

describe('createDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes merged changes once events stop', () => {
    const flushed: (readonly FileChange[])[] = [];
    const debouncer = createDebouncer(50, (changes) => flushed.push(changes));

    debouncer.push('b.md', 'unlink');
    debouncer.push('b.md', 'add');
    vi.advanceTimersByTime(40);
    debouncer.push('a.md', 'add');
    debouncer.push('a.md', 'change');
    debouncer.push('tmp.md', 'add');
    debouncer.push('tmp.md', 'unlink');
    vi.advanceTimersByTime(40);
    expect(flushed).toEqual([]);

    vi.advanceTimersByTime(10);
    expect(flushed).toEqual([
      [
        { kind: 'add', path: 'a.md' },
        { kind: 'change', path: 'b.md' },
      ],
    ]);
  });

  it('does not flush when every change cancels out or after cancel', () => {
    const flush = vi.fn();
    const debouncer = createDebouncer(50, flush);
    debouncer.push('a.md', 'add');
    debouncer.push('a.md', 'unlink');
    vi.advanceTimersByTime(100);
    debouncer.push('b.md', 'change');
    debouncer.cancel();
    vi.advanceTimersByTime(100);
    expect(flush).not.toHaveBeenCalled();
  });
});

// macOS の fs.watch は開始直後の変更を取りこぼすことがあるため、準備完了後に少し待つ
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 250));

describe('watchMarkdown', { timeout: 15_000 }, () => {
  let root: string;
  let watcher: Watcher | undefined;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'mdlive-watch-'));
    await mkdir(path.join(root, 'docs'));
    await mkdir(path.join(root, 'dist'));
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'existing.md'), '# existing');
  });

  afterEach(async () => {
    await watcher?.close();
    watcher = undefined;
    await rm(root, { recursive: true, force: true });
  });

  it('reports Markdown changes relative to the root and ignores other files', async () => {
    const received: FileChange[] = [];
    watcher = watchMarkdown(
      root,
      { excludeDirs: [path.join(root, 'dist')], debounceMs: 20 },
      (changes) => received.push(...changes),
      (error) => {
        throw error;
      },
    );
    await watcher.ready;
    await settle();

    await writeFile(path.join(root, 'docs', 'new.md'), '# new');
    await writeFile(path.join(root, 'notes.txt'), 'ignored');
    await writeFile(path.join(root, 'dist', 'out.md'), 'ignored');
    await writeFile(path.join(root, 'node_modules', 'pkg.md'), 'ignored');
    await vi.waitFor(() => expect(received).toContainEqual({ kind: 'add', path: 'docs/new.md' }), { timeout: 5000 });

    // macOS では追加直後に change が遅れて届くことがあるため、包含で確認する
    await writeFile(path.join(root, 'existing.md'), '# changed');
    await vi.waitFor(() => expect(received).toContainEqual({ kind: 'change', path: 'existing.md' }), {
      timeout: 5000,
    });

    await unlink(path.join(root, 'docs', 'new.md'));
    await vi.waitFor(() => expect(received).toContainEqual({ kind: 'unlink', path: 'docs/new.md' }), {
      timeout: 5000,
    });

    const paths = new Set(received.map((change) => change.path));
    expect([...paths].sort()).toEqual(['docs/new.md', 'existing.md']);
  });

  it('watches a single file', async () => {
    const css = path.join(root, 'custom.css');
    await writeFile(css, 'a {}');
    const onChange = vi.fn();
    watcher = watchSingleFile(css, { debounceMs: 20 }, onChange, (error) => {
      throw error;
    });
    await watcher.ready;
    await settle();

    await writeFile(css, 'b {}');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 5000 });
  });
});
