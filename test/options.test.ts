import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_THEME, parseBuildOptions, parseServeOptions } from '../src/options.js';
import { DEFAULT_FRONT_MATTER } from '../src/render/front-matter.js';

const cwd = path.resolve('/work');

describe('parseServeOptions', () => {
  it('applies defaults', () => {
    expect(parseServeOptions(undefined, {}, cwd)).toEqual({
      ok: true,
      value: { root: cwd, port: DEFAULT_PORT, host: DEFAULT_HOST, open: true, theme: DEFAULT_THEME, frontMatter: DEFAULT_FRONT_MATTER },
    });
  });

  it('resolves paths relative to cwd', () => {
    const result = parseServeOptions('docs', { port: '8080', open: false, out: 'dist', css: 'a.css', theme: 'dark', frontMatter: 'hide' }, cwd);
    expect(result).toEqual({
      ok: true,
      value: {
        root: path.join(cwd, 'docs'),
        port: 8080,
        host: DEFAULT_HOST,
        open: false,
        out: path.join(cwd, 'dist'),
        css: path.join(cwd, 'a.css'),
        theme: 'dark',
        frontMatter: 'hide',
      },
    });
  });

  it.each(['0', '65536', 'abc', '3000.5', '-1'])('rejects invalid port %s', (port) => {
    const result = parseServeOptions(undefined, { port }, cwd);
    expect(result.ok).toBe(false);
  });

  it.each(['system', '', 'DARK'])('rejects invalid theme %s', (theme) => {
    expect(parseServeOptions(undefined, { theme }, cwd)).toEqual({
      ok: false,
      error: `invalid --theme "${theme}": expected one of auto, light, dark`,
    });
  });

  it('rejects an invalid front matter mode', () => {
    expect(parseServeOptions(undefined, { frontMatter: 'show' }, cwd)).toEqual({
      ok: false,
      error: 'invalid --front-matter "show": expected one of table, hide',
    });
  });

  it('rejects non-object input', () => {
    expect(parseServeOptions(undefined, null, cwd).ok).toBe(false);
  });
});

describe('parseBuildOptions', () => {
  it('requires --out', () => {
    expect(parseBuildOptions(undefined, {}, cwd)).toEqual({
      ok: false,
      error: 'missing required option --out <dir>',
    });
  });

  it('parses options', () => {
    expect(parseBuildOptions('docs', { out: 'dist', strict: true, theme: 'light', frontMatter: 'hide' }, cwd)).toEqual({
      ok: true,
      value: { root: path.join(cwd, 'docs'), out: path.join(cwd, 'dist'), strict: true, theme: 'light', frontMatter: 'hide' },
    });
    expect(parseBuildOptions(undefined, { out: 'dist', theme: 'x' }, cwd).ok).toBe(false);
  });
});
