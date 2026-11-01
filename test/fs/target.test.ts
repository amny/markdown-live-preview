import { describe, expect, it } from 'vitest';
import { createTargetMatcher, validateIncludePattern } from '../../src/fs/target.js';

describe('createTargetMatcher', () => {
  it('treats every file as a target without patterns', () => {
    expect(createTargetMatcher([])('any/where.md')).toBe(true);
  });

  it.each([
    ['docs', 'docs/a.md', true],
    ['docs', 'docs/sub/deep/a.md', true],
    ['docs', 'other/docs/a.md', false],
    ['docs', 'docs.md', false],
    ['docs', 'documents/a.md', false],
    ['packages/*/docs', 'packages/core/docs/a/b.md', true],
    ['packages/*/docs', 'packages/core/src/a.md', false],
    ['packages/*/docs', 'packages/core/nested/docs/a.md', false],
    ['**/manual', 'manual/a.md', true],
    ['**/manual', 'x/y/manual/z/a.md', true],
    ['**/manual', 'x/manuals/a.md', false],
    ['docs/*', 'docs/a.md', true],
    ['docs/*', 'docs/sub/a.md', true],
    ['docs/**/*.md', 'docs/sub/a.md', true],
    ['docs/**/*.md', 'docs/sub/a.markdown', false],
    ['*.md', 'a.md', true],
    ['*.md', 'docs/a.md', false],
    ['.github', '.github/a.md', true],
    ['*', '.github/a.md', true],
    ['{docs,guides}', 'guides/a.md', true],
    ['日本語/*', '日本語/メモ.md', true],
    ['./docs/', 'docs/a.md', true],
    ['.', 'docs/a.md', true],
  ])('with %s, %s is %s', (pattern, file, expected) => {
    expect(createTargetMatcher([pattern])(file)).toBe(expected);
  });

  it('matches when any pattern matches', () => {
    const isTarget = createTargetMatcher(['docs', 'guides/*']);
    expect(isTarget('docs/a.md')).toBe(true);
    expect(isTarget('guides/b.md')).toBe(true);
    expect(isTarget('src/c.md')).toBe(false);
  });
});

describe('validateIncludePattern', () => {
  it.each(['docs', 'packages/*/docs', '**/manual', './docs/', '.', '.github', 'a..b'])('accepts %s', (pattern) => {
    expect(validateIncludePattern(pattern)).toBeUndefined();
  });

  it.each([
    ['', 'empty'],
    ['/docs', 'relative'],
    ['C:/docs', 'relative'],
    ['../docs', '..'],
    ['docs/../other', '..'],
    ['docs\\sub', 'separator'],
    ['!docs', 'negated'],
  ])('rejects "%s"', (pattern, reason) => {
    expect(validateIncludePattern(pattern)).toContain(reason);
  });
});
