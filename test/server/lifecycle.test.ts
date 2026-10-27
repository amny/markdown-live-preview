import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/log.js';
import { createRenderer } from '../../src/render/pipeline.js';
import { createReloadHub } from '../../src/server/reload-hub.js';
import { startServerWithFallback, type RunningServer, type ServerContext } from '../../src/server/server.js';
import { createShutdownHandler } from '../../src/server/shutdown.js';

const createLogger = (): Logger & { readonly messages: string[] } => {
  const messages: string[] = [];
  return {
    messages,
    info: (message) => messages.push(`info: ${message}`),
    warn: (message) => messages.push(`warn: ${message}`),
    error: (message) => messages.push(`error: ${message}`),
  };
};

/** 空いているポートを OS に選ばせ、そのまま占有する */
const occupyPort = (): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const portOf = (server: http.Server): number => {
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('server is not listening');
  return address.port;
};

describe('startServerWithFallback', () => {
  const blockers: http.Server[] = [];
  let running: RunningServer | undefined;

  const context = (log: Logger): ServerContext => ({
    root: process.cwd(),
    host: '127.0.0.1',
    theme: 'auto',
    clientScriptPath: 'client.js',
    excludeDirs: [],
    render: createRenderer(),
    hub: createReloadHub(),
    log,
  });

  afterEach(async () => {
    await running?.close();
    running = undefined;
    await Promise.all(blockers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it('moves to the next port when the requested one is in use', async () => {
    const blocker = await occupyPort();
    blockers.push(blocker);
    const port = portOf(blocker);
    const log = createLogger();

    // 隣のポートがたまたま使用中の場合もあるため、選ばれたポートが要求より大きいことを確認する
    running = await startServerWithFallback(context(log), port);
    expect(running.port).toBeGreaterThan(port);
    expect(running.url).toBe(`http://127.0.0.1:${running.port}/`);
    expect(log.messages[0]).toBe(`warn: port ${port} is in use, trying ${port + 1}`);
  });

  it('gives up after the given number of attempts', async () => {
    const blocker = await occupyPort();
    blockers.push(blocker);
    const port = portOf(blocker);

    await expect(startServerWithFallback(context(createLogger()), port, 1)).rejects.toThrow(
      `failed to listen on http://127.0.0.1:${port}/`,
    );
  });

  it('does not retry on other errors', async () => {
    const log = createLogger();
    await expect(
      startServerWithFallback({ ...context(log), host: '203.0.113.1' }, 0),
    ).rejects.toThrow(/failed to listen/);
    expect(log.messages).toEqual([]);
  });
});

describe('createShutdownHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes once and lets the process exit naturally', async () => {
    const close = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    const log = createLogger();
    const shutdown = createShutdownHandler({ close, log, exit, timeoutMs: 1000 });

    shutdown('SIGINT');
    await vi.advanceTimersByTimeAsync(2000);

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    expect(log.messages).toEqual(['info: received SIGINT, shutting down...']);
  });

  it('exits immediately on a second signal', () => {
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      close: () => new Promise(() => undefined),
      log: createLogger(),
      exit,
    });

    shutdown('SIGINT');
    shutdown('SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits forcibly when closing takes too long', async () => {
    const exit = vi.fn();
    const log = createLogger();
    const shutdown = createShutdownHandler({ close: () => new Promise(() => undefined), log, exit, timeoutMs: 1000 });

    shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.messages).toContain('error: shutdown timed out, exiting forcibly');
  });

  it('reports close failures and exits with an error', async () => {
    const exit = vi.fn();
    const log = createLogger();
    const shutdown = createShutdownHandler({
      close: () => Promise.reject(new Error('boom')),
      log,
      exit,
    });

    shutdown('SIGINT');
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.messages).toContain('error: failed to shut down cleanly: boom');
  });
});
