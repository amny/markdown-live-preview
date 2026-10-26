import { describeError, type Logger } from '../log.js';

export type ShutdownOptions = {
  readonly close: () => Promise<void>;
  readonly log: Logger;
  /** 終了処理が終わらないときに強制終了する */
  readonly exit: (code: number) => void;
  readonly timeoutMs?: number;
};

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * シグナル受信時の終了処理を作る。
 * 1 回目は監視・SSE・サーバを閉じて自然に終了させ、2 回目または時間切れで強制終了する。
 */
export const createShutdownHandler = (options: ShutdownOptions): ((signal: string) => void) => {
  let closing = false;

  return (signal) => {
    if (closing) {
      options.log.warn(`received ${signal} again, exiting immediately`);
      options.exit(1);
      return;
    }
    closing = true;
    options.log.info(`received ${signal}, shutting down...`);

    const timer = setTimeout(() => {
      options.log.error('shutdown timed out, exiting forcibly');
      options.exit(1);
    }, options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
    // 終了処理が早く終われば、このタイマーでプロセスを引き留めない
    timer.unref();

    options.close().then(
      () => clearTimeout(timer),
      (error: unknown) => {
        clearTimeout(timer);
        options.log.error(`failed to shut down cleanly: ${describeError(error)}`);
        options.exit(1);
      },
    );
  };
};
