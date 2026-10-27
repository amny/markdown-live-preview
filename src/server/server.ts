import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { FragmentResponse } from '../events.js';
import { CLIENT_ASSET, GITHUB_CSS_ASSETS, KATEX_CSS_ASSET, MERMAID_ASSET, type AssetSource } from '../assets/source.js';
import { isInside, isMarkdownPath, resolveInside } from '../fs/paths.js';
import { scanMarkdownFiles } from '../fs/scan.js';
import { describeError, type Logger } from '../log.js';
import { renderIndexBody } from '../render/index-page.js';
import { renderServePage, SERVE_PATHS, type PageBody, type Theme } from '../render/page.js';
import type { Renderer } from '../render/pipeline.js';
import type { ReloadHub } from './reload-hub.js';

export type ServerContext = {
  readonly root: string;
  /** バインドアドレス。Host ヘッダの検証に使う */
  readonly host: string;
  readonly customCss?: string;
  readonly theme: Theme;
  /** デフォルトスタイル（GitHub スタイルとレイアウト）を使うか */
  readonly defaultCss: boolean;
  /** 同梱アセット（GitHub スタイル・KaTeX・Mermaid・ブラウザ側スクリプト）の読み込み口 */
  readonly assets: AssetSource;
  /** ファイル一覧から除外するディレクトリ（出力先など） */
  readonly excludeDirs: readonly string[];
  readonly render: Renderer;
  readonly hub: ReloadHub;
  readonly log: Logger;
};

export type RunningServer = {
  readonly url: string;
  readonly port: number;
  readonly close: () => Promise<void>;
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
};

export const contentTypeFor = (filePath: string): string =>
  CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1']);
const WILDCARD_HOSTS: ReadonlySet<string> = new Set(['0.0.0.0', '::']);

export const hostnameOf = (hostHeader: string): string => {
  const ipv6 = /^\[([^\]]+)\](?::\d+)?$/.exec(hostHeader);
  return (ipv6?.[1] ?? hostHeader.replace(/:\d+$/, '')).toLowerCase();
};

/**
 * DNS リバインディングで外部サイトからローカルのファイルを読まれないよう、
 * Host ヘッダがループバックかバインドアドレスであることを確認する。
 */
export const isAllowedHost = (hostHeader: string | undefined, bindHost: string): boolean => {
  if (WILDCARD_HOSTS.has(bindHost)) return true;
  if (hostHeader === undefined) return false;
  const hostname = hostnameOf(hostHeader);
  return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname === bindHost.toLowerCase();
};

export const formatUrl = (host: string, port: number): string => {
  const hostname = WILDCARD_HOSTS.has(host) ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  return `http://${hostname}:${port}/`;
};

type Reply =
  | { readonly kind: 'body'; readonly status: number; readonly contentType: string; readonly body: string }
  | { readonly kind: 'file'; readonly filePath: string; readonly contentType: string }
  | { readonly kind: 'asset'; readonly name: string; readonly contentType: string }
  | { readonly kind: 'events' };

const textReply = (status: number, body: string): Reply => ({
  kind: 'body',
  status,
  contentType: 'text/plain; charset=utf-8',
  body,
});
const htmlReply = (status: number, body: string): Reply => ({
  kind: 'body',
  status,
  contentType: 'text/html; charset=utf-8',
  body,
});
const jsonReply = (status: number, value: FragmentResponse): Reply => ({
  kind: 'body',
  status,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify(value),
});
const fileReply = (filePath: string): Reply => ({ kind: 'file', filePath, contentType: contentTypeFor(filePath) });
const assetReply = (name: string): Reply => ({ kind: 'asset', name, contentType: contentTypeFor(name) });

const NOT_FOUND = textReply(404, 'Not Found');

/**
 * リクエストパス（ルートからの相対パス）をルート配下の実在するファイルに解決する。
 * シンボリックリンクでルート外を指すもの、ドットで始まるパス要素を含むものは扱わない。
 */
const resolveRequestFile = async (root: string, relative: string): Promise<string | undefined> => {
  if (relative.split('/').some((segment) => segment.startsWith('.'))) return undefined;
  const resolved = resolveInside(root, relative);
  if (resolved === undefined) return undefined;
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(resolved).catch(() => undefined)]);
  if (realTarget === undefined || !isInside(realRoot, realTarget)) return undefined;
  const info = await stat(realTarget);
  return info.isFile() ? resolved : undefined;
};

const renderMarkdownBody = async (ctx: ServerContext, filePath: string, absolute: string): Promise<PageBody> => {
  const source = await readFile(absolute, 'utf8').catch((cause: unknown) => {
    throw new Error(`failed to read ${absolute}`, { cause });
  });
  return ctx.render(source, { filePath, linkMode: 'serve' });
};

const renderIndex = async (ctx: ServerContext): Promise<PageBody> => {
  const files = await scanMarkdownFiles(ctx.root, { excludeDirs: ctx.excludeDirs });
  return renderIndexBody(path.basename(ctx.root), files, 'serve');
};

const servePage = (ctx: ServerContext, filePath: string, body: PageBody): Reply =>
  htmlReply(200, renderServePage({ ...body, filePath, hasCustomCss: ctx.customCss !== undefined, theme: ctx.theme, defaultCss: ctx.defaultCss }));

const routeMarkdownPage = async (ctx: ServerContext, filePath: string, absolute: string): Promise<Reply> => {
  try {
    return servePage(ctx, filePath, await renderMarkdownBody(ctx, filePath, absolute));
  } catch (error) {
    const message = `${filePath}: ${describeError(error)}`;
    ctx.log.error(message);
    // エラー表示のページを返し、修正後のライブ更新で復帰できるようにする
    const body = { title: path.posix.basename(filePath), html: '', hasMath: false, hasMermaid: false };
    return htmlReply(500, renderServePage({ ...body, filePath, hasCustomCss: ctx.customCss !== undefined, theme: ctx.theme, defaultCss: ctx.defaultCss, error: message }));
  }
};

const routeFragment = async (ctx: ServerContext, filePath: string): Promise<Reply> => {
  if (filePath === '') {
    const body = await renderIndex(ctx);
    return jsonReply(200, { ok: true, title: body.title, html: body.html });
  }
  const absolute = isMarkdownPath(filePath) ? await resolveRequestFile(ctx.root, filePath) : undefined;
  if (absolute === undefined) return jsonReply(404, { ok: false, error: `${filePath}: file not found` });
  try {
    const body = await renderMarkdownBody(ctx, filePath, absolute);
    return jsonReply(200, { ok: true, title: body.title, html: body.html });
  } catch (error) {
    const message = `${filePath}: ${describeError(error)}`;
    ctx.log.error(message);
    return jsonReply(500, { ok: false, error: message });
  }
};

const KATEX_FONT_NAME = /^fonts\/[\w-]+\.(woff2|woff|ttf)$/;

const routeAsset = (ctx: ServerContext, name: string): Reply => {
  switch (name) {
    case 'github-markdown.css':
      return ctx.defaultCss ? assetReply(GITHUB_CSS_ASSETS[ctx.theme]) : NOT_FOUND;
    case 'katex.css':
      return assetReply(KATEX_CSS_ASSET);
    case 'mermaid.min.js':
      return assetReply(MERMAID_ASSET);
    case 'custom.css':
      return ctx.customCss === undefined ? NOT_FOUND : fileReply(ctx.customCss);
    default:
      // katex.css 内の相対参照 fonts/*.woff2 を解決する
      return KATEX_FONT_NAME.test(name) ? assetReply(name) : NOT_FOUND;
  }
};

const INTERNAL_PREFIX = '/__mdlive/';
const ASSET_PREFIX = '/__mdlive/assets/';

const route = async (ctx: ServerContext, url: URL): Promise<Reply> => {
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith(INTERNAL_PREFIX)) {
    if (pathname === '/__mdlive/events') return { kind: 'events' };
    if (pathname === SERVE_PATHS.client) return assetReply(CLIENT_ASSET);
    if (pathname === '/__mdlive/fragment') return routeFragment(ctx, url.searchParams.get('path') ?? '');
    if (pathname.startsWith(ASSET_PREFIX)) return routeAsset(ctx, pathname.slice(ASSET_PREFIX.length));
    return NOT_FOUND;
  }

  if (pathname === '/') return servePage(ctx, '', await renderIndex(ctx));

  const filePath = pathname.slice(1);
  const absolute = await resolveRequestFile(ctx.root, filePath);
  if (absolute === undefined) return NOT_FOUND;
  return isMarkdownPath(filePath) ? routeMarkdownPage(ctx, filePath, absolute) : fileReply(absolute);
};

const BASE_HEADERS = { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } as const;

const send = async (ctx: ServerContext, reply: Reply, request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const isHead = request.method === 'HEAD';
  switch (reply.kind) {
    case 'events':
      ctx.hub.connect(response);
      return;
    case 'body':
      response.writeHead(reply.status, {
        ...BASE_HEADERS,
        'Content-Type': reply.contentType,
        'Content-Length': Buffer.byteLength(reply.body),
      });
      response.end(isHead ? undefined : reply.body);
      return;
    case 'asset': {
      const data = await ctx.assets.read(reply.name);
      if (data === undefined) {
        await send(ctx, NOT_FOUND, request, response);
        return;
      }
      response.writeHead(200, { ...BASE_HEADERS, 'Content-Type': reply.contentType, 'Content-Length': data.length });
      response.end(isHead ? undefined : data);
      return;
    }
    case 'file': {
      const info = await stat(reply.filePath).catch(() => undefined);
      if (info === undefined || !info.isFile()) {
        await send(ctx, NOT_FOUND, request, response);
        return;
      }
      response.writeHead(200, { ...BASE_HEADERS, 'Content-Type': reply.contentType, 'Content-Length': info.size });
      if (isHead) {
        response.end();
        return;
      }
      createReadStream(reply.filePath)
        .on('error', (error) => {
          ctx.log.error(`failed to send ${reply.filePath}: ${error.message}`);
          response.destroy(error);
        })
        .pipe(response);
      return;
    }
  }
};

export const handleRequest = async (
  ctx: ServerContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  try {
    if (!isAllowedHost(request.headers.host, ctx.host)) {
      await send(ctx, textReply(403, 'Forbidden: unexpected Host header'), request, response);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      await send(ctx, textReply(405, 'Method Not Allowed'), request, response);
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const reply = await route(ctx, url).catch((error: unknown) => {
      if (error instanceof URIError) return textReply(400, 'Bad Request: malformed URL');
      throw error;
    });
    await send(ctx, reply, request, response);
  } catch (error) {
    ctx.log.error(`failed to handle ${request.method ?? '?'} ${request.url ?? '?'}: ${describeError(error)}`);
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Internal Server Error');
  }
};

const closeServer = (server: Server, hub: ReloadHub): Promise<void> =>
  new Promise((resolve, reject) => {
    hub.close();
    server.close((error) => (error === undefined ? resolve() : reject(new Error('failed to close server', { cause: error }))));
    server.closeAllConnections();
  });

export const startServer = (ctx: ServerContext, port: number): Promise<RunningServer> =>
  new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      void handleRequest(ctx, request, response);
    });
    server.once('error', (error) => {
      reject(new Error(`failed to listen on ${formatUrl(ctx.host, port)}: ${error.message}`, { cause: error }));
    });
    server.listen(port, ctx.host, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({ url: formatUrl(ctx.host, actualPort), port: actualPort, close: () => closeServer(server, ctx.hub) });
    });
  });

/** ポートが使用中のとき、次の番号を試す回数の上限 */
export const MAX_PORT_ATTEMPTS = 20;

const isAddressInUse = (error: unknown): boolean =>
  error instanceof Error &&
  error.cause instanceof Error &&
  'code' in error.cause &&
  error.cause.code === 'EADDRINUSE';

/** 指定ポートが使用中なら、空いているポートが見つかるまで番号を 1 つずつ増やして試す */
export const startServerWithFallback = async (
  ctx: ServerContext,
  port: number,
  attempts: number = MAX_PORT_ATTEMPTS,
): Promise<RunningServer> => {
  try {
    return await startServer(ctx, port);
  } catch (error) {
    // port 0 は OS が空きポートを選ぶため、使用中にはならない
    if (!isAddressInUse(error) || port === 0 || attempts <= 1 || port >= 65535) throw error;
    ctx.log.warn(`port ${port} is in use, trying ${port + 1}`);
    return startServerWithFallback(ctx, port + 1, attempts - 1);
  }
};
