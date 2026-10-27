import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseReloadEvent, type ReloadEvent } from '../../src/events.js';
import type { Logger } from '../../src/log.js';
import { startServe, type ServeHandle } from '../../src/server/serve.js';

const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const exists = (target: string): Promise<boolean> =>
  stat(target).then(
    () => true,
    () => false,
  );

/** SSE に接続し、受け取ったイベントを配列に溜める */
const subscribe = (port: number): Promise<{ readonly events: ReloadEvent[]; readonly close: () => void }> =>
  new Promise((resolve, reject) => {
    const events: ReloadEvent[] = [];
    const req = http.get({ host: '127.0.0.1', port, path: '/__mdlive/events' }, (res) => {
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        blocks
          .filter((block) => block.startsWith('data: '))
          .forEach((block) => {
            const event = parseReloadEvent(JSON.parse(block.slice('data: '.length)));
            if (event !== undefined) events.push(event);
          });
      });
      resolve({ events, close: () => req.destroy() });
    });
    req.on('error', reject);
  });

describe('startServe', { timeout: 30_000 }, () => {
  let work: string;
  let root: string;
  let out: string;
  let css: string;
  let serve: ServeHandle | undefined;

  beforeEach(async () => {
    work = await mkdtemp(path.join(os.tmpdir(), 'mdlive-serve-'));
    root = path.join(work, 'root');
    out = path.join(root, 'dist');
    css = path.join(work, 'custom.css');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(root));
    await writeFile(path.join(root, 'README.md'), '# Top');
    await writeFile(path.join(work, 'client.js'), '');
    await writeFile(css, '.v1 {}');
  });

  afterEach(async () => {
    await serve?.close();
    serve = undefined;
    await rm(work, { recursive: true, force: true });
  });

  const start = async (withOut: boolean): Promise<ServeHandle> => {
    const handle = await startServe(
      { root, port: 0, host: '127.0.0.1', open: false, theme: 'auto', defaultCss: true, frontMatter: 'table', css, ...(withOut ? { out } : {}) },
      path.join(work, 'client.js'),
      silentLogger,
      { debounceMs: 20 },
    );
    // 監視の準備が整うまで待つ（macOS の fs.watch は開始直後の変更を取りこぼすことがある）
    await new Promise((resolve) => setTimeout(resolve, 500));
    return handle;
  };

  it('notifies browsers about added, changed and removed files', async () => {
    serve = await start(false);
    const sse = await subscribe(serve.port);

    // macOS では追加・保存の直後に change が遅れて届き、update が重複することがあるため包含で確認する
    await writeFile(path.join(root, 'new.md'), '# New');
    await vi.waitFor(
      () => expect(sse.events).toEqual(expect.arrayContaining([{ type: 'tree' }, { type: 'update', path: 'new.md' }])),
      { timeout: 5000 },
    );

    sse.events.length = 0;
    await writeFile(path.join(root, 'README.md'), '# Changed');
    await vi.waitFor(() => expect(sse.events).toContainEqual({ type: 'update', path: 'README.md' }), { timeout: 5000 });

    sse.events.length = 0;
    await unlink(path.join(root, 'new.md'));
    await vi.waitFor(
      () => expect(sse.events).toEqual(expect.arrayContaining([{ type: 'tree' }, { type: 'update', path: 'new.md' }])),
      { timeout: 5000 },
    );

    sse.events.length = 0;
    sse.events.length = 0;
    await writeFile(path.join(root, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await vi.waitFor(() => expect(sse.events).toContainEqual({ type: 'asset', path: 'logo.svg' }), { timeout: 5000 });
    expect(sse.events.filter((event) => event.type === 'update' || event.type === 'tree')).toEqual([]);

    sse.events.length = 0;
    await writeFile(css, '.v2 {}');
    await vi.waitFor(() => expect(sse.events).toContainEqual({ type: 'css' }), { timeout: 5000 });
    sse.close();
  });

  it('keeps the HTML output in sync with --out', async () => {
    serve = await start(true);
    const readmeHtml = path.join(out, 'README.html');
    await vi.waitFor(async () => expect(await exists(readmeHtml)).toBe(true), { timeout: 5000 });
    expect(await readFile(path.join(out, 'index.html'), 'utf8')).toContain('README.html');

    await writeFile(path.join(root, 'new.md'), '# New');
    await vi.waitFor(async () => expect(await exists(path.join(out, 'new.html'))).toBe(true), { timeout: 5000 });
    await vi.waitFor(
      async () => expect(await readFile(path.join(out, 'index.html'), 'utf8')).toContain('new.html'),
      { timeout: 5000 },
    );

    await writeFile(path.join(root, 'README.md'), '# Changed');
    await vi.waitFor(async () => expect(await readFile(readmeHtml, 'utf8')).toContain('Changed'), { timeout: 5000 });

    await unlink(path.join(root, 'new.md'));
    await vi.waitFor(async () => expect(await exists(path.join(out, 'new.html'))).toBe(false), { timeout: 5000 });

    // 参照先の画像が後から置かれた場合も、差し替えられた場合も、そのページを書き出し直す
    await writeFile(path.join(root, 'pic.md'), '![logo](logo.svg)');
    await vi.waitFor(async () => expect(await exists(path.join(out, 'pic.html'))).toBe(true), { timeout: 5000 });
    expect(await readFile(path.join(out, 'pic.html'), 'utf8')).toContain('src="logo.svg"');

    const svg = (color: string): string => `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="${color}"/></svg>`;
    const dataUri = (color: string): string => `data:image/svg+xml;base64,${Buffer.from(svg(color)).toString('base64')}`;
    await writeFile(path.join(root, 'logo.svg'), svg('red'));
    await vi.waitFor(
      async () => expect(await readFile(path.join(out, 'pic.html'), 'utf8')).toContain(dataUri('red')),
      { timeout: 5000 },
    );
    await writeFile(path.join(root, 'logo.svg'), svg('blue'));
    await vi.waitFor(
      async () => expect(await readFile(path.join(out, 'pic.html'), 'utf8')).toContain(dataUri('blue')),
      { timeout: 5000 },
    );

    await writeFile(css, '.v2 {}');
    await vi.waitFor(async () => expect(await readFile(readmeHtml, 'utf8')).toContain('.v2 {}'), { timeout: 5000 });
  });

  it('rejects an output directory that contains the root', async () => {
    await expect(
      startServe({ root, port: 0, host: '127.0.0.1', open: false, theme: 'auto', defaultCss: true, frontMatter: 'table', out: root }, path.join(work, 'client.js'), silentLogger),
    ).rejects.toThrow(/must not be the root/);
  });
});
