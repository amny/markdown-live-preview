export type Logger = {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
};

/** エラーを、原因（cause）のメッセージも含めた 1 行の文字列にする */
export const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
};

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(`warning: ${message}`),
  error: (message) => console.error(`error: ${message}`),
};
