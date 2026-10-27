import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEvent, createReloadHub, type ReloadHub } from '../../src/server/reload-hub.js';
import {
  contentTypeFor,
  formatUrl,
  hostnameOf,
  isAllowedHost,
  startServer,
  type RunningServer,
} from '../../src/server/server.js';
import { parseFragmentResponse, parseReloadEvent, rootRelativePathOf } from '../../src/events.js';
import { createRenderer, type Renderer } from '../../src/render/pipeline.js';
import type { Logger } from '../../src/log.js';
import { createPackageAssetSource } from '../../src/assets/source.js';

const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

type RawResponse = { readonly status: number; readonly headers: http.IncomingHttpHeaders; readonly body: string };

/** fetch はパスを正規化してしまうため、生のパスやヘッダを送れる http.request を使う */
const request = (
  port: number,
  requestPath: string,
  options: { readonly method?: string; readonly host?: string } = {},
): Promise<RawResponse> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method: options.method ?? 'GET',
        headers: { host: options.host ?? `127.0.0.1:${port}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });

describe('helpers', () => {
  it('parses Host headers', () => {
    expect(hostnameOf('localhost:3000')).toBe('localhost');
    expect(hostnameOf('[::1]:3000')).toBe('::1');
    expect(hostnameOf('Example.COM')).toBe('example.com');
  });

  it.each([
    ['localhost:3000', '127.0.0.1', true],
    ['127.0.0.1:3000', '127.0.0.1', true],
    ['[::1]:3000', '127.0.0.1', true],
    ['docs.localhost:3000', '127.0.0.1', true],
    ['evil.example.com', '127.0.0.1', false],
    ['192.168.0.10:3000', '192.168.0.10', true],
    ['anything', '0.0.0.0', true],
  ])('Host %s with bind %s is allowed: %s', (hostHeader, bindHost, expected) => {
    expect(isAllowedHost(hostHeader, bindHost)).toBe(expected);
  });

  it('rejects missing Host headers', () => {
    expect(isAllowedHost(undefined, '127.0.0.1')).toBe(false);
  });

  it('formats URLs', () => {
    expect(formatUrl('127.0.0.1', 3000)).toBe('http://127.0.0.1:3000/');
    expect(formatUrl('0.0.0.0', 3000)).toBe('http://localhost:3000/');
    expect(formatUrl('::1', 3000)).toBe('http://[::1]:3000/');
  });

  it('maps content types', () => {
    expect(contentTypeFor('a.PNG')).toBe('image/png');
    expect(contentTypeFor('a.unknown')).toBe('application/octet-stream');
  });
});

describe('events', () => {
  it('formats SSE messages', () => {
    expect(formatEvent({ type: 'update', path: 'a.md' })).toBe('data: {"type":"update","path":"a.md"}\n\n');
  });

  it('parses only well-formed events', () => {
    expect(parseReloadEvent({ type: 'update', path: 'a.md' })).toEqual({ type: 'update', path: 'a.md' });
    expect(parseReloadEvent({ type: 'error', path: 'a.md', message: 'x' })).toEqual({
      type: 'error',
      path: 'a.md',
      message: 'x',
    });
    expect(parseReloadEvent({ type: 'update' })).toBeUndefined();
    expect(parseReloadEvent({ type: 'unknown' })).toBeUndefined();
    expect(parseReloadEvent('tree')).toBeUndefined();
  });

  it('parses asset events', () => {
    expect(parseReloadEvent({ type: 'asset', path: 'img/a.png' })).toEqual({ type: 'asset', path: 'img/a.png' });
    expect(parseReloadEvent({ type: 'asset' })).toBeUndefined();
  });

  it.each([
    ['img/a.png', 'http://localhost:3000/docs/guide.md', 'docs/img/a.png'],
    ['../img/a%20b.png?t=1', 'http://localhost:3000/docs/guide.md', 'img/a b.png'],
    ['/img/a.png', 'http://localhost:3000/docs/guide.md', 'img/a.png'],
    ['http://localhost:3000/img/a.png', 'http://localhost:3000/', 'img/a.png'],
    ['https://example.com/img/a.png', 'http://localhost:3000/', undefined],
    ['/%E0%A4%A.png', 'http://localhost:3000/', undefined],
  ])('maps %s on %s to the root-relative path %s', (href, base, expected) => {
    expect(rootRelativePathOf(href, base)).toBe(expected);
  });

  it('parses fragment responses', () => {
    expect(parseFragmentResponse({ ok: true, title: 't', html: 'h' })).toEqual({ ok: true, title: 't', html: 'h' });
    expect(parseFragmentResponse({ ok: false, error: 'e' })).toEqual({ ok: false, error: 'e' });
    expect(parseFragmentResponse({ ok: true, title: 't' })).toBeUndefined();
  });
});

describe('server', () => {
  let work: string;
  let root: string;
  let hub: ReloadHub;
  let server: RunningServer;
  let port: number;

  beforeAll(async () => {
    work = await mkdtemp(path.join(os.tmpdir(), 'mdlive-server-'));
    root = path.join(work, 'root');
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, 'README.md'), '# Top\n\n[guide](docs/guide.md)');
    await writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n\n$x$');
    await writeFile(path.join(root, 'broken.md'), '# Broken');
    await writeFile(path.join(root, 'image.png'), 'png');
    await writeFile(path.join(root, '.env'), 'SECRET=1');
    await writeFile(path.join(work, 'secret.md'), '# Secret');
    await symlink(path.join(work, 'secret.md'), path.join(root, 'linked.md'));
    await writeFile(path.join(work, 'client.js'), 'console.log("client")');
    await writeFile(path.join(work, 'custom.css'), 'body { color: red; }');

    const realRender = createRenderer();
    const render: Renderer = (source, options) =>
      options.filePath === 'broken.md' ? Promise.reject(new Error('boom')) : realRender(source, options);

    hub = createReloadHub();
    server = await startServer(
      {
        root,
        host: '127.0.0.1',
        customCss: path.join(work, 'custom.css'),
        theme: 'auto',
        defaultCss: true,
        assets: createPackageAssetSource(path.join(work, 'client.js')),
        excludeDirs: [],
        render,
        hub,
        log: silentLogger,
      },
      0,
    );
    port = server.port;
  });

  afterAll(async () => {
    await server.close();
    await rm(work, { recursive: true, force: true });
  });

  it('serves the file list at /', async () => {
    const res = await request(port, '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('href="/docs/guide.md"');
    expect(res.body).toContain('data-mdlive-path=""');
  });

  it('renders Markdown pages', async () => {
    const res = await request(port, '/docs/guide.md');
    expect(res.status).toBe(200);
    expect(res.body).toContain('<title>Guide</title>');
    expect(res.body).toContain('data-mdlive-path="docs/guide.md"');
    expect(res.body).toContain('class="katex"');
    expect(res.body).toContain('href="/__mdlive/assets/custom.css"');
    expect(res.body).toMatch(/<pre id="mdlive-error" role="alert" hidden><\/pre>/);
  });

  it('shows render errors in the page', async () => {
    const res = await request(port, '/broken.md');
    expect(res.status).toBe(500);
    expect(res.body).toContain('<pre id="mdlive-error" role="alert">broken.md: boom</pre>');
  });

  it('serves static files with their content type', async () => {
    const res = await request(port, '/image.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body).toBe('png');
  });

  it.each(['/%2e%2e/secret.md', '/docs/%2e%2e/%2e%2e/secret.md', '/linked.md', '/.env', '/missing.md', '/docs'])(
    'does not serve %s',
    async (requestPath) => {
      expect((await request(port, requestPath)).status).toBe(404);
    },
  );

  it('rejects malformed URLs, other methods and unexpected hosts', async () => {
    expect((await request(port, '/%E0%A4%A')).status).toBe(400);
    expect((await request(port, '/', { method: 'POST' })).status).toBe(405);
    expect((await request(port, '/', { host: 'evil.example.com' })).status).toBe(403);
  });

  it('answers HEAD requests without a body', async () => {
    const res = await request(port, '/image.png', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('3');
    expect(res.body).toBe('');
  });

  describe('internal routes', () => {
    it('serves fragments as JSON', async () => {
      const ok = await request(port, '/__mdlive/fragment?path=docs%2Fguide.md');
      expect(ok.status).toBe(200);
      expect(JSON.parse(ok.body)).toMatchObject({ ok: true, title: 'Guide' });

      const index = await request(port, '/__mdlive/fragment?path=');
      expect(JSON.parse(index.body)).toMatchObject({ ok: true, title: 'root' });

      const broken = await request(port, '/__mdlive/fragment?path=broken.md');
      expect(broken.status).toBe(500);
      expect(JSON.parse(broken.body)).toEqual({ ok: false, error: 'broken.md: boom' });

      for (const filePath of ['missing.md', '../secret.md', 'image.png']) {
        const missing = await request(port, `/__mdlive/fragment?path=${encodeURIComponent(filePath)}`);
        expect(missing.status).toBe(404);
      }
    });

    it('serves bundled assets, KaTeX fonts, custom CSS and the client script', async () => {
      const github = await request(port, '/__mdlive/assets/github-markdown.css');
      expect(github.headers['content-type']).toBe('text/css; charset=utf-8');
      expect(github.body).toContain('.markdown-body');

      expect((await request(port, '/__mdlive/assets/katex.css')).body).toContain('url(fonts/');
      const font = await request(port, '/__mdlive/assets/fonts/KaTeX_Main-Regular.woff2');
      expect(font.status).toBe(200);
      expect(font.headers['content-type']).toBe('font/woff2');
      expect((await request(port, '/__mdlive/assets/fonts/..%2F..%2Fpackage.json')).status).toBe(404);

      expect((await request(port, '/__mdlive/assets/mermaid.min.js')).status).toBe(200);
      expect((await request(port, '/__mdlive/assets/custom.css')).body).toBe('body { color: red; }');
      expect((await request(port, '/__mdlive/client.js')).body).toBe('console.log("client")');
      expect((await request(port, '/__mdlive/unknown')).status).toBe(404);
    });

    it('streams broadcast events to connected clients', async () => {
      const received = await new Promise<string>((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/__mdlive/events' }, (res) => {
          expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString('utf8');
            if (data.startsWith('retry:') && !data.includes('data:')) {
              hub.broadcast({ type: 'update', path: 'docs/guide.md' });
            }
            if (data.includes('data:')) {
              req.destroy();
              resolve(data);
            }
          });
        });
        req.on('error', reject);
      });
      expect(received).toBe('retry: 1000\n\ndata: {"type":"update","path":"docs/guide.md"}\n\n');
    });
  });
});
