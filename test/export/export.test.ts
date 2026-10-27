import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inlineKatexFonts, katexFontNames, loadExportAssets } from '../../src/export/assets.js';
import { buildSite, createExportRenderer, findOutputConflicts, validateOutDir } from '../../src/export/build.js';
import { imageSourceToRelative } from '../../src/export/inline.js';
import { dependentsOf, withReferences } from '../../src/export/sync.js';
import { MAX_PAGE_BYTES, pageSizeWarning } from '../../src/export/writer.js';
import type { Logger } from '../../src/log.js';

// 1x1 の透明 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('KaTeX font inlining', () => {
  const css =
    '@font-face{font-family:A;src:url(fonts/KaTeX_A.woff2) format("woff2"),url(fonts/KaTeX_A.woff) format("woff"),url(fonts/KaTeX_A.ttf) format("truetype")}' +
    '@font-face{font-family:B;src:url(fonts/KaTeX_B-Bold.woff2) format("woff2")}';

  it('finds woff2 font names', () => {
    expect(katexFontNames(css)).toEqual(['KaTeX_A', 'KaTeX_B-Bold']);
  });

  it('replaces font sources with woff2 data URIs', () => {
    const fonts = new Map([
      ['KaTeX_A', 'AAAA'],
      ['KaTeX_B-Bold', 'BBBB'],
    ]);
    expect(inlineKatexFonts(css, fonts)).toBe(
      '@font-face{font-family:A;src:url(data:font/woff2;base64,AAAA) format("woff2")}' +
        '@font-face{font-family:B;src:url(data:font/woff2;base64,BBBB) format("woff2")}',
    );
  });

  it('fails when a font is missing', () => {
    expect(() => inlineKatexFonts(css, new Map())).toThrow('missing KaTeX font: KaTeX_A.woff2');
  });

  it('loads the real assets without external font references', async () => {
    const assets = await loadExportAssets();
    expect(assets.githubCss).toContain('.markdown-body');
    expect(assets.katexCss).toContain('data:font/woff2;base64,');
    expect(assets.katexCss).not.toMatch(/url\(fonts\//);
    expect(assets.mermaidJs.length).toBeGreaterThan(1000);
  });
});

describe('imageSourceToRelative', () => {
  it.each([
    ['img/a.png', 'docs/a.md', 'docs/img/a.png'],
    ['../img/a.png', 'docs/a.md', 'img/a.png'],
    ['/img/a%20b.png?v=1#x', 'docs/a.md', 'img/a b.png'],
    ['../../outside.png', 'docs/a.md', '../outside.png'],
  ])('resolves %s from %s', (src, filePath, expected) => {
    expect(imageSourceToRelative(src, filePath)).toBe(expected);
  });

  it.each(['https://example.com/a.png', 'data:image/png;base64,AA', '', '#x', '?v=1'])('ignores %s', (src) => {
    expect(imageSourceToRelative(src, 'a.md')).toBeUndefined();
  });
});

describe('validation helpers', () => {
  it('rejects output directories that contain the root', () => {
    expect(validateOutDir('/work/root', '/work/root')).toBeDefined();
    expect(validateOutDir('/work/root', '/work')).toBeDefined();
    expect(validateOutDir('/work/root', '/work/root/dist')).toBeUndefined();
    expect(validateOutDir('/work/root', '/work/dist')).toBeUndefined();
  });

  it('detects files that map to the same output', () => {
    expect(findOutputConflicts(['a.md', 'A.markdown', 'b.md'])).toEqual([
      'multiple files map to the same output a.html: a.md, A.markdown',
    ]);
    expect(findOutputConflicts(['a.md', 'docs/a.md'])).toEqual([]);
  });

  it('warns about oversized pages', () => {
    expect(pageSizeWarning('a')).toBeUndefined();
    expect(pageSizeWarning('a'.repeat(MAX_PAGE_BYTES + 1))).toMatch(/larger than 10MB/);
  });
});

describe('buildSite', () => {
  let work: string;
  let root: string;
  let out: string;

  const write = async (file: string, content: string | Buffer): Promise<void> => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  };

  beforeEach(async () => {
    work = await mkdtemp(path.join(os.tmpdir(), 'mdlive-build-'));
    root = path.join(work, 'root');
    out = path.join(root, 'dist');
    await write('img/dot.png', PNG);
    await write('README.md', '# Top\n\n[guide](docs/guide.md)\n\n![dot](img/dot.png)\n\n![missing](img/none.png)');
    await write('docs/guide.md', '# Guide\n\n$x^2$\n\n```mermaid\ngraph TD; A-->B\n```\n\n![dot](/img/dot.png)');
    await writeFile(path.join(work, 'outside.png'), PNG);
    await write('docs/escape.md', '![outside](../../outside.png)');
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it('writes self-contained HTML files and a file list', async () => {
    const report = await buildSite({ root, out, strict: false }, silentLogger);

    expect(report.written).toEqual(['README.md', 'docs/escape.md', 'docs/guide.md']);
    expect(report.errors).toEqual([]);
    expect(report.images).toEqual(
      new Map([
        ['README.md', ['img/dot.png', 'img/none.png']],
        ['docs/escape.md', []],
        ['docs/guide.md', ['img/dot.png']],
      ]),
    );
    expect(report.warnings).toEqual([
      'README.md: image could not be read (ENOENT): img/none.png',
      'docs/escape.md: image outside the root directory is not embedded: ../../outside.png',
    ]);

    const readme = await readFile(path.join(out, 'README.html'), 'utf8');
    expect(readme).toContain('href="docs/guide.html"');
    expect(readme).toContain('src="data:image/png;base64,');
    expect(readme).toContain('src="img/none.png"');
    expect(readme).not.toContain('katex');
    expect(readme).not.toMatch(/<(link|script)[^>]+(href|src)=/);

    const guide = await readFile(path.join(out, 'docs', 'guide.html'), 'utf8');
    expect(guide).toContain('data:font/woff2;base64,');
    expect(guide).toContain('<pre class="mermaid">');
    expect(guide).toContain('src="data:image/png;base64,');
    expect(guide).not.toMatch(/<(link|script)[^>]+(href|src)=/);

    const index = await readFile(path.join(out, 'index.html'), 'utf8');
    expect(index).toContain('href="docs/guide.html"');
  });

  it('does not scan its own output directory on rebuild', async () => {
    await buildSite({ root, out, strict: false }, silentLogger);
    await write('dist/stale.md', '# stale');
    const report = await buildSite({ root, out, strict: false }, silentLogger);
    expect(report.written).not.toContain('dist/stale.md');
  });

  it('uses index.md as index.html instead of generating a file list', async () => {
    await write('index.md', '# Home');
    await buildSite({ root, out, strict: false }, silentLogger);
    expect(await readFile(path.join(out, 'index.html'), 'utf8')).toContain('<title>Home</title>');
  });

  it('continues after a file fails and reports the error', async () => {
    await mkdir(path.join(out, 'README.html'), { recursive: true });
    const report = await buildSite({ root, out, strict: false }, silentLogger);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/^README\.md: failed to write /);
    expect((await stat(path.join(out, 'docs', 'guide.html'))).isFile()).toBe(true);
  });

  it('inlines custom CSS after the GitHub style', async () => {
    const css = path.join(work, 'custom.css');
    await writeFile(css, '.markdown-body { color: rebeccapurple; }');
    await buildSite({ root, out, strict: false, css }, silentLogger);
    const readme = await readFile(path.join(out, 'README.html'), 'utf8');
    expect(readme).toContain('rebeccapurple');
  });

  it('rejects output directories containing the root', async () => {
    await expect(buildSite({ root, out: root, strict: false }, silentLogger)).rejects.toThrow(/must not be the root/);
  });

  it('can be reused through createExportRenderer', async () => {
    const render = createExportRenderer(root);
    const result = await render('![dot](img/dot.png)', { filePath: 'a.md', linkMode: 'export' });
    expect(result.html).toContain('data:image/png;base64,');
    expect(result.warnings).toEqual([]);
  });

  it('converts container directives in exported pages', async () => {
    const render = createExportRenderer(root);
    const result = await render('::::outer\n:::inner\n![dot](img/dot.png)\n:::\n::::', { filePath: 'a.md', linkMode: 'export' });
    expect(result.html).toMatch(/^<div class="outer"><div class="inner"><p><img src="data:image\/png;base64,/);
  });

  it('records referenced images inside the root, including missing ones', async () => {
    const render = createExportRenderer(root);
    const result = await render(
      '![a](img/dot.png) ![b](/img/dot.png) ![c](img/none.png) ![d](../outside.png) ![e](https://example.com/x.png)',
      { filePath: 'a.md', linkMode: 'export' },
    );
    expect(result.images).toEqual(['img/dot.png', 'img/none.png']);
  });
});

describe('image references', () => {
  const references = new Map([
    ['a.md', ['img/1.png', 'img/2.png']],
    ['b.md', ['img/2.png']],
    ['c.md', []],
  ]);

  it('finds pages that embed changed images', () => {
    expect(dependentsOf(references, ['img/2.png'])).toEqual(['a.md', 'b.md']);
    expect(dependentsOf(references, ['img/1.png', 'img/3.png'])).toEqual(['a.md']);
    expect(dependentsOf(references, ['img/3.png'])).toEqual([]);
  });

  it('replaces and removes entries without mutating the original', () => {
    const replaced = withReferences(references, 'b.md', ['img/3.png']);
    expect(dependentsOf(replaced, ['img/3.png'])).toEqual(['b.md']);
    expect(dependentsOf(references, ['img/3.png'])).toEqual([]);
    expect(withReferences(references, 'a.md', undefined).has('a.md')).toBe(false);
    expect(references.has('a.md')).toBe(true);
  });
});
