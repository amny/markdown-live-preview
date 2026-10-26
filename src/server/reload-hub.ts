import type { ServerResponse } from 'node:http';
import type { ReloadEvent } from '../events.js';

export type ReloadHub = {
  readonly connect: (response: ServerResponse) => void;
  readonly broadcast: (event: ReloadEvent) => void;
  readonly size: () => number;
  readonly close: () => void;
};

const HEARTBEAT_MS = 30_000;
const RETRY_MS = 1_000;

export const formatEvent = (event: ReloadEvent): string => `data: ${JSON.stringify(event)}\n\n`;

/** SSE 接続を管理し、全ブラウザへイベントを配信する */
export const createReloadHub = (): ReloadHub => {
  const clients = new Set<ServerResponse>();

  // 中継プロキシ等に接続を切られないよう、定期的にコメント行を送る
  const heartbeat = setInterval(() => {
    clients.forEach((client) => client.write(': ping\n\n'));
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    connect: (response) => {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.write(`retry: ${RETRY_MS}\n\n`);
      clients.add(response);
      response.on('close', () => clients.delete(response));
    },
    broadcast: (event) => {
      const message = formatEvent(event);
      clients.forEach((client) => client.write(message));
    },
    size: () => clients.size,
    close: () => {
      clearInterval(heartbeat);
      clients.forEach((client) => client.end());
      clients.clear();
    },
  };
};
