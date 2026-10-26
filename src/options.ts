import path from 'node:path';

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export type ServeOptions = {
  readonly root: string;
  readonly port: number;
  readonly host: string;
  readonly open: boolean;
  readonly out?: string;
  readonly css?: string;
};

export type BuildOptions = {
  readonly root: string;
  readonly out: string;
  readonly strict: boolean;
  readonly css?: string;
};

export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = '127.0.0.1';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const parsePort = (value: unknown): Result<number> => {
  if (value === undefined) return ok(DEFAULT_PORT);
  const text = String(value);
  const port = Number(text);
  return /^\d+$/.test(text) && port >= 1 && port <= 65535
    ? ok(port)
    : fail(`invalid --port "${text}": expected an integer between 1 and 65535`);
};

const optionalString = (raw: Readonly<Record<string, unknown>>, key: string): Result<string | undefined> => {
  const value = raw[key];
  if (value === undefined) return ok(undefined);
  return typeof value === 'string' && value.length > 0
    ? ok(value)
    : fail(`invalid --${key}: expected a non-empty string`);
};

const resolveFrom = (cwd: string, target: string | undefined): string | undefined =>
  target === undefined ? undefined : path.resolve(cwd, target);

export const parseServeOptions = (dir: string | undefined, raw: unknown, cwd: string): Result<ServeOptions> => {
  if (!isRecord(raw)) return fail('invalid serve options: expected an object');

  const port = parsePort(raw['port']);
  if (!port.ok) return port;
  const host = optionalString(raw, 'host');
  if (!host.ok) return host;
  const out = optionalString(raw, 'out');
  if (!out.ok) return out;
  const css = optionalString(raw, 'css');
  if (!css.ok) return css;

  const outPath = resolveFrom(cwd, out.value);
  const cssPath = resolveFrom(cwd, css.value);
  return ok({
    root: path.resolve(cwd, dir ?? '.'),
    port: port.value,
    host: host.value ?? DEFAULT_HOST,
    open: raw['open'] !== false,
    ...(outPath === undefined ? {} : { out: outPath }),
    ...(cssPath === undefined ? {} : { css: cssPath }),
  });
};

export const parseBuildOptions = (dir: string | undefined, raw: unknown, cwd: string): Result<BuildOptions> => {
  if (!isRecord(raw)) return fail('invalid build options: expected an object');

  const out = optionalString(raw, 'out');
  if (!out.ok) return out;
  if (out.value === undefined) return fail('missing required option --out <dir>');
  const css = optionalString(raw, 'css');
  if (!css.ok) return css;

  const cssPath = resolveFrom(cwd, css.value);
  return ok({
    root: path.resolve(cwd, dir ?? '.'),
    out: path.resolve(cwd, out.value),
    strict: raw['strict'] === true,
    ...(cssPath === undefined ? {} : { css: cssPath }),
  });
};
