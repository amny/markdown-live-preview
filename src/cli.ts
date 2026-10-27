import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import open from 'open';
import pkg from '../package.json' with { type: 'json' };
import { buildSite } from './export/build.js';
import { consoleLogger, describeError } from './log.js';
import { DEFAULT_FRONT_MATTER } from './render/front-matter.js';
import { startServe } from './server/serve.js';
import { createShutdownHandler } from './server/shutdown.js';
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_THEME,
  parseBuildOptions,
  parseServeOptions,
  type BuildOptions,
  type Result,
  type ServeOptions,
} from './options.js';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const assertDirectory = async (target: string, label: string): Promise<void> => {
  const info = await stat(target).catch((cause: unknown) => {
    throw new Error(`${label} not found: ${target}`, { cause });
  });
  if (!info.isDirectory()) throw new Error(`${label} is not a directory: ${target}`);
};

const assertFile = async (target: string, label: string): Promise<void> => {
  const info = await stat(target).catch((cause: unknown) => {
    throw new Error(`${label} not found: ${target}`, { cause });
  });
  if (!info.isFile()) throw new Error(`${label} is not a file: ${target}`);
};

const runServe = async (options: ServeOptions): Promise<void> => {
  await assertDirectory(options.root, 'root directory');
  if (options.css !== undefined) await assertFile(options.css, 'custom CSS');

  // tsup が cli.js と同じディレクトリに出力するブラウザ側スクリプト
  const clientScriptPath = fileURLToPath(new URL('./client.js', import.meta.url));
  await assertFile(clientScriptPath, 'client script (run `pnpm build` first)');

  const server = await startServe(options, clientScriptPath, consoleLogger);
  consoleLogger.info(`mdlive is serving ${options.root} at ${server.url} (press Ctrl+C to stop)`);

  const shutdown = createShutdownHandler({ close: server.close, log: consoleLogger, exit: (code) => process.exit(code) });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (options.open) await openBrowser(server.url);
};

/** ブラウザを開く。失敗してもサーバは動かし続け、URL を案内する */
const openBrowser = async (url: string): Promise<void> => {
  const reportFailure = (error: unknown): void =>
    consoleLogger.warn(`failed to open the browser (${describeError(error)}); open ${url} manually`);
  try {
    const child = await open(url);
    child.once('error', reportFailure);
  } catch (error) {
    reportFailure(error);
  }
};

const runBuild = async (options: BuildOptions): Promise<void> => {
  await assertDirectory(options.root, 'root directory');
  if (options.css !== undefined) await assertFile(options.css, 'custom CSS');

  const report = await buildSite(options, consoleLogger);
  consoleLogger.info(
    `wrote ${report.written.length} file(s) to ${options.out}` +
      ` (${report.warnings.length} warning(s), ${report.errors.length} error(s))`,
  );
  if (report.errors.length > 0) throw new Error('build failed');
  if (options.strict && report.warnings.length > 0) throw new Error('build failed: warnings are treated as errors (--strict)');
};

const createProgram = (cwd: string): Command => {
  const program = new Command()
    .name('mdlive')
    .description(pkg.description)
    .version(pkg.version);

  program
    .command('serve [dir]', { isDefault: true })
    .description('start a live preview server for Markdown files in <dir>')
    .option('--port <n>', 'port to listen on', String(DEFAULT_PORT))
    .option('--host <addr>', 'address to bind', DEFAULT_HOST)
    .option('--no-open', 'do not open the browser automatically')
    .option('--out <dir>', 'also write self-contained HTML files on every change')
    .option('--css <path>', 'custom CSS applied after the GitHub style')
    .option('--theme <mode>', 'color theme: auto (follow the OS setting), light or dark', DEFAULT_THEME)
    .option('--no-default-css', 'do not load the default GitHub style and layout')
    .option('--front-matter <mode>', 'front matter display: table or hide', DEFAULT_FRONT_MATTER)
    .action((dir: string | undefined, raw: unknown) => runServe(unwrap(parseServeOptions(dir, raw, cwd))));

  program
    .command('build [dir]')
    .description('export Markdown files in <dir> as self-contained HTML files')
    .requiredOption('--out <dir>', 'output directory')
    .option('--css <path>', 'custom CSS applied after the GitHub style')
    .option('--theme <mode>', 'color theme: auto (follow the OS setting), light or dark', DEFAULT_THEME)
    .option('--no-default-css', 'do not load the default GitHub style and layout')
    .option('--front-matter <mode>', 'front matter display: table or hide', DEFAULT_FRONT_MATTER)
    .option('--strict', 'treat warnings such as missing images as errors')
    .action((dir: string | undefined, raw: unknown) => runBuild(unwrap(parseBuildOptions(dir, raw, cwd))));

  return program;
};

createProgram(process.cwd())
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    consoleLogger.error(message);
    process.exitCode = 1;
  });
