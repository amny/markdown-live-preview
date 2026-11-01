import picomatch from 'picomatch';

/** ルートからの相対パス（区切りは `/`）の Markdown ファイルが対象かを判定する */
export type TargetMatcher = (relativePath: string) => boolean;

/** パターンが不正な場合は理由を返す */
export const validateIncludePattern = (pattern: string): string | undefined => {
  if (pattern === '') return 'pattern must not be empty';
  if (pattern.includes('\\')) return 'use "/" as the path separator';
  if (pattern.startsWith('/') || /^[A-Za-z]:/.test(pattern)) return 'pattern must be relative to the root directory';
  if (pattern.split('/').includes('..')) return 'pattern must not contain ".."';
  if (pattern.startsWith('!')) return 'negated patterns are not supported';
  return undefined;
};

/** `./docs/` のような書き方を `docs` にそろえる。ルート自身を指すものは全体に一致させる */
const normalizePattern = (pattern: string): string => {
  const normalized = pattern.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  return normalized === '' || normalized === '.' ? '**' : normalized;
};

/** パスとその親ディレクトリを、浅い順に列挙する（`a/b.md` → `a`, `a/b.md`） */
const pathAndAncestors = (relativePath: string): readonly string[] => {
  const segments = relativePath.split('/');
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
};

/**
 * ファイル自身または親ディレクトリのいずれかがパターンに一致すれば対象とする。
 * パターンが空のときはすべて対象とする
 */
export const createTargetMatcher = (patterns: readonly string[]): TargetMatcher => {
  if (patterns.length === 0) return () => true;
  const matches = picomatch(patterns.map(normalizePattern), { dot: true });
  return (relativePath) => pathAndAncestors(relativePath).some((candidate) => matches(candidate));
};
