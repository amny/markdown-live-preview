import { describe, expect, it } from 'vitest';
import { isExternalUrl, resolveFragment, toExportUrl } from '../../src/render/links.js';

describe('isExternalUrl', () => {
  it.each(['https://example.com', 'mailto:a@example.com', 'data:image/png;base64,AA', '//cdn.example.com/x'])(
    'treats %s as external',
    (url) => expect(isExternalUrl(url)).toBe(true),
  );

  it.each(['a.md', './a.md', '../a.md', '/a.md', '#top'])('treats %s as local', (url) => {
    expect(isExternalUrl(url)).toBe(false);
  });
});

describe('toExportUrl', () => {
  it.each([
    ['b.md', 'b.html'],
    ['sub/B.MARKDOWN', 'sub/B.html'],
    ['b.md#section', 'b.html#section'],
    ['b.md?x=1#y', 'b.html?x=1#y'],
    ['img/a.png', 'img/a.png'],
    ['#section', '#section'],
    ['https://example.com/a.md', 'https://example.com/a.md'],
    ['', ''],
  ])('rewrites %s to %s', (url, expected) => {
    expect(toExportUrl(url, 'a.md')).toBe(expected);
  });

  it('converts root-relative paths to paths relative to the file', () => {
    expect(toExportUrl('/img/a.png', 'docs/guide/a.md')).toBe('../../img/a.png');
    expect(toExportUrl('/docs/b.md#x', 'docs/a.md')).toBe('b.html#x');
  });
});

describe('resolveFragment', () => {
  const ids = new Set(['heading', 'user-content-fn-1', 'user-content-both', 'both']);

  it('adds the clobber prefix when only the prefixed id exists', () => {
    expect(resolveFragment('#fn-1', ids)).toBe('#user-content-fn-1');
  });

  it('matches percent-encoded ids such as non-ASCII footnote labels', () => {
    const encoded = new Set(['user-content-fn-%E6%B3%A81', 'user-content-%E8%A6%8B']);
    expect(resolveFragment('#fn-%E6%B3%A81', encoded)).toBe('#user-content-fn-%E6%B3%A81');
    // id がデコード済みでもエンコード済みでも同じ結果になる
    expect(resolveFragment('#fn-%E6%B3%A81', new Set(['user-content-fn-注1']))).toBe('#user-content-fn-%E6%B3%A81');
    expect(resolveFragment('#%E8%A6%8B', encoded)).toBe('#user-content-%E8%A6%8B');
    expect(resolveFragment('#fn-%E6%B3%A81', new Set(['fn-%E6%B3%A81']))).toBe('#fn-%E6%B3%A81');
  });

  it('keeps fragments that already match an id', () => {
    expect(resolveFragment('#heading', ids)).toBe('#heading');
    expect(resolveFragment('#both', ids)).toBe('#both');
  });

  it('keeps unknown, empty and malformed fragments', () => {
    expect(resolveFragment('#missing', ids)).toBe('#missing');
    expect(resolveFragment('#', ids)).toBe('#');
    expect(resolveFragment('#%E0%A4%A', ids)).toBe('#%E0%A4%A');
    expect(resolveFragment('a.md', ids)).toBe('a.md');
  });
});
