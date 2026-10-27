import type { Element, ElementContent } from 'hast';
import type { Root, Yaml } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import type { Options as RemarkRehypeOptions } from 'remark-rehype';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import { parseDocument } from 'yaml';

/** フロントマターの表示方法 */
export const FRONT_MATTER_MODES = ['table', 'hide'] as const;
export type FrontMatterMode = (typeof FRONT_MATTER_MODES)[number];
export const DEFAULT_FRONT_MATTER: FrontMatterMode = 'table';

export const isFrontMatterMode = (value: unknown): value is FrontMatterMode =>
  FRONT_MATTER_MODES.some((mode) => mode === value);

declare module 'mdast' {
  interface YamlData {
    /** 表示用に変換済みの HTML。未設定なら出力しない */
    mdliveFrontMatter?: Element;
  }
}

export type ParsedFrontMatter = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

export const parseFrontMatter = (source: string): ParsedFrontMatter => {
  const document = parseDocument(source);
  const [error] = document.errors;
  if (error !== undefined) return { ok: false, error: error.message.split('\n')[0] ?? error.message };
  return { ok: true, value: document.toJS({ maxAliasCount: 100 }) };
};

const element = (tagName: string, children: readonly ElementContent[]): Element => ({
  type: 'element',
  tagName,
  properties: {},
  children: [...children],
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const scalarText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

/** 値をセルの中身にする。配列・オブジェクトは表を入れ子にする */
const cellContent = (value: unknown): readonly ElementContent[] =>
  Array.isArray(value) || isRecord(value) ? [valueTable(value)] : [{ type: 'text', value: scalarText(value) }];

/** GitHub と同様、オブジェクトは 1 行目にキー・2 行目に値、配列は 1 行に要素を並べた表にする */
export const valueTable = (value: readonly unknown[] | Readonly<Record<string, unknown>>): Element => {
  if (Array.isArray(value)) {
    return element('table', [element('tbody', [element('tr', value.map((item) => element('td', cellContent(item))))])]);
  }
  const entries = Object.entries(value);
  return element('table', [
    element('thead', [element('tr', entries.map(([key]) => element('th', [{ type: 'text', value: key }])))]),
    element('tbody', [element('tr', entries.map(([, item]) => element('td', cellContent(item))))]),
  ]);
};

const sourceBlock = (source: string): Element => ({
  type: 'element',
  tagName: 'pre',
  properties: {},
  children: [{ type: 'element', tagName: 'code', properties: { className: ['language-yaml'] }, children: [{ type: 'text', value: source }] }],
});

/** フロントマターの表示内容。空のフロントマターは何も表示しない */
export const frontMatterElement = (source: string, parsed: ParsedFrontMatter): Element | undefined => {
  if (!parsed.ok) return sourceBlock(source);
  const { value } = parsed;
  if (value === null || value === undefined) return undefined;
  return Array.isArray(value) || isRecord(value) ? valueTable(value) : valueTable([value]);
};

const remarkFrontMatterDisplay = (mode: FrontMatterMode) => (tree: Root, file: VFile): void => {
  visit(tree, 'yaml', (node: Yaml) => {
    const parsed = parseFrontMatter(node.value);
    if (!parsed.ok) file.message(`invalid front matter YAML: ${parsed.error}`);
    const display = mode === 'table' ? frontMatterElement(node.value, parsed) : undefined;
    if (display !== undefined) node.data = { ...node.data, mdliveFrontMatter: display };
  });
};

/** フロントマターの解析と表示内容の準備をまとめたプリセット */
export const remarkFrontMatter: Plugin<[FrontMatterMode], Root> = function (mode) {
  remarkFrontmatter.call(this, 'yaml');
  return remarkFrontMatterDisplay(mode);
};

/** remark-rehype 用。準備済みの表示内容を出力する（既定ではフロントマターは出力されない） */
type Handlers = NonNullable<RemarkRehypeOptions['handlers']>;

export const frontMatterHandlers: Handlers = {
  yaml: (_state, node: Yaml) => node.data?.mdliveFrontMatter,
};
