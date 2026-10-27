/**
 * 単一実行ファイル（Node.js SEA）を作る。`pnpm build:sea` から、dist/client.js と dist-sea/mdlive.cjs を
 * ビルドした後に実行する。実行ファイルは、このスクリプトを実行している Node.js 本体を元に作るため、
 * 対象 OS 上で実行すること（Windows 版は Windows 上で実行する）。
 */
import { execFile } from 'node:child_process';
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { inject } from 'postject';
import { bundledAssetFiles } from '../src/assets/source.js';
import { describeError } from '../src/log.js';

const run = promisify(execFile);

const OUT_DIR = path.resolve('dist-sea');
const MAIN = path.join(OUT_DIR, 'mdlive.cjs');
const BLOB = path.join(OUT_DIR, 'sea-prep.blob');
const CONFIG = path.join(OUT_DIR, 'sea-config.json');
const CLIENT_SCRIPT = path.resolve('dist', 'client.js');
const EXECUTABLE = path.join(OUT_DIR, process.platform === 'win32' ? 'mdlive.exe' : 'mdlive');
// Node.js が SEA の埋め込みを検出するための目印（Node.js のドキュメントに記載の固定値）
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const step = async <T>(label: string, task: () => Promise<T>): Promise<T> => {
  console.log(`build-sea: ${label}`);
  return task().catch((cause: unknown) => {
    throw new Error(`build-sea: failed to ${label}`, { cause });
  });
};

const writeSeaConfig = async (): Promise<void> => {
  const assets = await bundledAssetFiles(CLIENT_SCRIPT);
  const config = {
    main: MAIN,
    output: BLOB,
    disableExperimentalSEAWarning: true,
    // コードキャッシュとスナップショットは生成した環境に依存するため使わない
    useCodeCache: false,
    useSnapshot: false,
    assets: Object.fromEntries(assets),
  };
  await writeFile(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
};

const main = async (): Promise<void> => {
  await step('write the SEA configuration', writeSeaConfig);
  await step('generate the SEA blob', () => run(process.execPath, ['--experimental-sea-config', CONFIG]));
  await step('copy the Node.js executable', async () => {
    await rm(EXECUTABLE, { force: true });
    await copyFile(process.execPath, EXECUTABLE);
  });
  // macOS は署名を外してから埋め込み、ad-hoc 署名し直す（署名が壊れた実行ファイルは起動できない）
  if (process.platform === 'darwin') {
    await step('remove the code signature', () => run('codesign', ['--remove-signature', EXECUTABLE]));
  }
  await step('inject the SEA blob', async () =>
    inject(EXECUTABLE, 'NODE_SEA_BLOB', await readFile(BLOB), {
      sentinelFuse: SENTINEL_FUSE,
      ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
    }),
  );
  if (process.platform === 'darwin') {
    await step('sign the executable', () => run('codesign', ['--sign', '-', EXECUTABLE]));
  }
  console.log(`build-sea: wrote ${EXECUTABLE}`);
};

main().catch((error: unknown) => {
  console.error(describeError(error));
  process.exitCode = 1;
});
