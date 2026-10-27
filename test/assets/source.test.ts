import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bundledAssetFiles,
  CLIENT_ASSET,
  createPackageAssetSource,
  createSeaAssetSource,
  GITHUB_CSS_ASSETS,
  KATEX_CSS_ASSET,
  MERMAID_ASSET,
  packageAssetPath,
} from '../../src/assets/source.js';

describe('package asset source', () => {
  let work: string;
  let clientScriptPath: string;

  beforeAll(async () => {
    work = await mkdtemp(path.join(os.tmpdir(), 'mdlive-assets-'));
    clientScriptPath = path.join(work, 'client.js');
    await writeFile(clientScriptPath, 'console.log("client")');
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it('reads bundled assets from the installed packages', async () => {
    const source = createPackageAssetSource(clientScriptPath);
    expect((await source.read(GITHUB_CSS_ASSETS.dark))?.toString('utf8')).toContain('color-scheme: dark');
    expect((await source.read(KATEX_CSS_ASSET))?.toString('utf8')).toContain('url(fonts/');
    expect((await source.read(MERMAID_ASSET))?.length).toBeGreaterThan(1000);
    expect((await source.read('fonts/KaTeX_Main-Regular.woff2'))?.length).toBeGreaterThan(0);
    expect((await source.read(CLIENT_ASSET))?.toString('utf8')).toBe('console.log("client")');
  });

  it('returns undefined for unknown names, missing files and paths outside the font directory', async () => {
    const source = createPackageAssetSource(path.join(work, 'missing.js'));
    expect(await source.read(CLIENT_ASSET)).toBeUndefined();
    expect(await source.read('fonts/KaTeX_None.woff2')).toBeUndefined();
    expect(await source.read('unknown.css')).toBeUndefined();
    expect(packageAssetPath('fonts/../../package.json', clientScriptPath)).toBeUndefined();
    expect(packageAssetPath('fonts/a/b.woff2', clientScriptPath)).toBeUndefined();
  });

  it('lists the files to embed in a single executable', async () => {
    const files = await bundledAssetFiles(clientScriptPath);
    const names = [...files.keys()];
    expect(names).toEqual(expect.arrayContaining([...Object.values(GITHUB_CSS_ASSETS), KATEX_CSS_ASSET, MERMAID_ASSET]));
    expect(files.get(CLIENT_ASSET)).toBe(clientScriptPath);
    const fonts = names.filter((name) => name.startsWith('fonts/'));
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((name) => name.endsWith('.woff2'))).toBe(true);
  });
});

describe('SEA asset source', () => {
  const notFound = (): never => {
    throw Object.assign(new Error('not found'), { code: 'ERR_SINGLE_EXECUTABLE_APPLICATION_ASSET_NOT_FOUND' });
  };

  it('reads embedded assets', async () => {
    const source = createSeaAssetSource((key) => (key === 'a.css' ? new TextEncoder().encode('body{}').buffer : notFound()));
    expect((await source.read('a.css'))?.toString('utf8')).toBe('body{}');
    expect(await source.read('b.css')).toBeUndefined();
  });

  it('reports other failures with the asset name', async () => {
    const source = createSeaAssetSource(() => {
      throw new Error('broken');
    });
    await expect(source.read('a.css')).rejects.toThrow('failed to read embedded asset a.css');
  });
});
