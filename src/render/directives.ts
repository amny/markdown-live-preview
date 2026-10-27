import type { Root, Text } from 'mdast';
import remarkDirective from 'remark-directive';
import { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import type { Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';
import type { VFile } from 'vfile';

/** ディレクティブ名として許可するクラス名（サニタイズでも同じ形式に限って残す） */
export const DIRECTIVE_CLASS_PATTERN = /^[A-Za-z][\w-]*$/;

/** GitHub 準拠のスキーマに、div の `class`（ディレクティブ名の形式のみ）を加えたもの */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.['div'] ?? []), ['className', DIRECTIVE_CLASS_PATTERN]],
  },
};

const sourceOf = (file: VFile, node: { readonly position?: Root['position'] }): string | undefined => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : String(file.value).slice(start, end);
};

/**
 * `:::name` のコンテナディレクティブを `<div class="name">` に変換する。
 * 行内の `:name` と行単位の `::name` は対象外のため、元の文字列に戻す。
 */
const remarkContainerDirectives = () => (tree: Root, file: VFile): void => {
  visit(tree, (node, index, parent) => {
    if (node.type === 'containerDirective') {
      const className = DIRECTIVE_CLASS_PATTERN.test(node.name) ? [node.name] : [];
      node.data = { ...node.data, hName: 'div', hProperties: className.length > 0 ? { className } : {} };
      return undefined;
    }
    if ((node.type !== 'textDirective' && node.type !== 'leafDirective') || parent === undefined || index === undefined) {
      return undefined;
    }
    const value = sourceOf(file, node);
    if (value === undefined) {
      file.message(`directive without source position is left as is: ${node.name}`);
      return undefined;
    }
    const text: Text = { type: 'text', value };
    parent.children[index] = node.type === 'textDirective' ? text : { type: 'paragraph', children: [text] };
    return [SKIP, index + 1];
  });
};

/** ディレクティブ構文の解析と変換をまとめたプリセット */
export const remarkDirectives: Plugin<[], Root> = function () {
  remarkDirective.call(this);
  return remarkContainerDirectives();
};
