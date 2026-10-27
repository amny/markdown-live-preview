import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isImagePath, isInside, isMarkdownPath, resolveInside, toHtmlPath } from '../../src/fs/paths.js';
import { scanMarkdownFiles } from '../../src/fs/scan.js';

describe('paths', () => {
  const root = path.resolve('/work/root');

  it('detects image paths', () => {
    expect(['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.avif', 'a.svg'].every(isImagePath)).toBe(true);
    expect(isImagePath('a.md')).toBe(false);
    expect(isImagePath('a.png.txt')).toBe(false);
  });

  it('detects Markdown paths and maps them to HTML', () => {
    expect(isMarkdownPath('a.md')).toBe(true);
    expect(isMarkdownPath('a.MARKDOWN')).toBe(true);
    expect(isMarkdownPath('a.mdx')).toBe(false);
    expect(toHtmlPath('docs/a.markdown')).toBe('docs/a.html');
  });

  it('checks containment', () => {
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, path.join(root, 'a/b'))).toBe(true);
    expect(isInside(root, path.resolve(root, '..'))).toBe(false);
    expect(isInside(root, `${root}-sibling`)).toBe(false);
  });

  it('resolves only paths inside the root', () => {
    expect(resolveInside(root, 'docs/a.md')).toBe(path.join(root, 'docs', 'a.md'));
    expect(resolveInside(root, '../secret.md')).toBeUndefined();
    expect(resolveInside(root, 'docs/../../secret.md')).toBeUndefined();
  });
});

describe('scanMarkdownFiles', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'mdlive-scan-'));
    const files = ['b.md', 'a.markdown', 'notes.txt', 'docs/c.md', 'node_modules/x/readme.md', '.git/d.md', 'dist/e.md'];
    await Promise.all(
      files.map(async (file) => {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), '# x');
      }),
    );
    await symlink(path.join(root, 'docs'), path.join(root, 'linked'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists Markdown files, skipping ignored and excluded directories and symlinks', async () => {
    expect(await scanMarkdownFiles(root, { excludeDirs: [path.join(root, 'dist')] })).toEqual([
      'a.markdown',
      'b.md',
      'docs/c.md',
    ]);
  });

  it('reports the directory that could not be read', async () => {
    await expect(scanMarkdownFiles(path.join(root, 'missing'))).rejects.toThrow(/failed to read directory .*missing/);
  });
});
