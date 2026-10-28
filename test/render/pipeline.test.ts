import { describe, expect, it } from 'vitest';
import { createRenderer, type RenderOptions } from '../../src/render/pipeline.js';

const render = createRenderer();
const serve: RenderOptions = { filePath: 'docs/a.md', linkMode: 'serve' };
const exported: RenderOptions = { filePath: 'docs/a.md', linkMode: 'export' };

describe('createRenderer', () => {
  describe('GitHub Flavored Markdown', () => {
    it('renders tables, task lists, strikethrough and autolinks', async () => {
      const { html } = await render(
        '| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~ https://example.com',
        serve,
      );
      expect(html).toContain('<table>');
      expect(html).toContain('<td>1</td>');
      expect(html).toContain('<input type="checkbox" checked disabled>');
      expect(html).toContain('<del>old</del>');
      expect(html).toContain('<a href="https://example.com">https://example.com</a>');
    });

    it('links footnote references to prefixed footnote ids', async () => {
      const { html } = await render('Note[^1]\n\n[^1]: footnote', serve);
      expect(html).toContain('href="#user-content-fn-1"');
      expect(html).toContain('id="user-content-fn-1"');
      expect(html).toContain('href="#user-content-fnref-1"');
      expect(html).toContain('id="user-content-fnref-1"');
    });

    it('links footnotes with non-ASCII labels', async () => {
      const { html } = await render('本文[^注1]\n\n[^注1]: 脚注', serve);
      expect(html).toContain('href="#user-content-fn-%E6%B3%A81"');
      expect(html).toContain('id="user-content-fn-%E6%B3%A81"');
      expect(html).toContain('href="#user-content-fnref-%E6%B3%A81"');
      expect(html).toContain('id="user-content-fnref-%E6%B3%A81"');
    });
  });

  describe('alerts', () => {
    it.each([
      ['NOTE', 'note', 'Note', 'octicon-info'],
      ['TIP', 'tip', 'Tip', 'octicon-light-bulb'],
      ['IMPORTANT', 'important', 'Important', 'octicon-report'],
      ['WARNING', 'warning', 'Warning', 'octicon-alert'],
      ['caution', 'caution', 'Caution', 'octicon-stop'],
    ])('renders [!%s] as a GitHub alert', async (marker, type, title, icon) => {
      const { html } = await render(`> [!${marker}]\n> Body **text**.`, serve);
      expect(html).toContain(`<div class="markdown-alert markdown-alert-${type}">`);
      expect(html).toContain(`<p class="markdown-alert-title"><svg class="octicon ${icon} mr-2" viewBox="0 0 16 16"`);
      expect(html).toContain(`</svg>${title}</p>`);
      expect(html).toContain('<p>Body <strong>text</strong>.</p>');
      expect(html).not.toContain('<blockquote>');
      expect(html).not.toContain('[!');
    });

    it('keeps paragraphs that follow the marker line', async () => {
      const { html } = await render('> [!TIP]\n>\n> First.\n>\n> - item', serve);
      expect(html).toContain('<div class="markdown-alert markdown-alert-tip">');
      expect(html).toContain('<p>First.</p>');
      expect(html).toContain('<li>item</li>');
    });

    it.each([
      ['an unknown type', '> [!OTHER]\n> Body'],
      ['text after the marker', '> [!NOTE] Body'],
      ['inline content after the marker', '> [!NOTE] **Body**'],
      ['no body', '> [!NOTE]'],
      ['a nested blockquote', '> > [!NOTE]\n> > Body'],
      ['a blockquote in a list', '- > [!NOTE]\n  > Body'],
    ])('keeps a plain blockquote for %s', async (_label, source) => {
      const { html } = await render(source, serve);
      expect(html).toContain('<blockquote>');
      expect(html).not.toContain('markdown-alert');
    });

    it('does not let raw HTML inject alert icons', async () => {
      const { html } = await render('<p class="markdown-alert-title"><svg><path d="M0"/></svg></p>', serve);
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('markdown-alert-title');
    });
  });

  it('adds GitHub-compatible heading ids', async () => {
    const { html } = await render('# Hello World\n\n## Hello World\n\n## 日本語 見出し', serve);
    expect(html).toContain('<h1 id="hello-world">');
    expect(html).toContain('<h2 id="hello-world-1">');
    expect(html).toContain('<h2 id="日本語-見出し">');
  });

  describe('raw HTML', () => {
    it('keeps safe elements and removes scripts, event handlers and javascript: URLs', async () => {
      const { html } = await render(
        '<details><summary>s</summary>\n\n<script>alert(1)</script><a href="javascript:alert(1)" onclick="x()">bad</a><img src=x onerror="y()">\n\n</details>',
        serve,
      );
      expect(html).toContain('<details>');
      expect(html).toContain('<summary>s</summary>');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('javascript:');
      expect(html).not.toContain('onclick');
      expect(html).not.toContain('onerror');
    });

    it('prefixes user-supplied ids to prevent DOM clobbering and resolves links to them', async () => {
      const { html } = await render('<a name="anchor"></a>\n\n[to anchor](#anchor)', serve);
      expect(html).toContain('name="user-content-anchor"');
      expect(html).toContain('href="#user-content-anchor"');
    });
  });

  it('highlights code blocks with dual GitHub themes', async () => {
    const { html } = await render('```ts\nconst a = 1;\n```', serve);
    expect(html).toContain('class="shiki shiki-themes github-light github-dark"');
    expect(html).toContain('--shiki-dark:');
  });

  it('falls back to plain text for unknown languages', async () => {
    const { html } = await render('```no-such-language\nplain\n```', serve);
    expect(html).toContain('class="shiki');
    expect(html).toContain('plain');
  });

  it('renders inline and display math with KaTeX', async () => {
    const result = await render('Inline $E=mc^2$\n\n$$\n\\int_0^1 x\\,dx\n$$', serve);
    expect(result.hasMath).toBe(true);
    expect(result.html).toContain('<span class="katex">');
    expect(result.html).toContain('<span class="katex-display">');
  });

  it('reports whether the page has images', async () => {
    expect((await render('![a](a.png)', serve)).hasImage).toBe(true);
    expect((await render('<img src="a.png" alt="">', serve)).hasImage).toBe(true);
    expect((await render('no image', serve)).hasImage).toBe(false);
  });

  it('turns mermaid code blocks into mermaid containers without highlighting', async () => {
    const result = await render('```mermaid\ngraph TD; A-->B\n```', serve);
    expect(result.hasMermaid).toBe(true);
    expect(result.html).toContain('<pre class="mermaid">graph TD; A-->B\n</pre>');
  });

  it('escapes HTML inside mermaid sources', async () => {
    const { html } = await render('```mermaid\ngraph TD; A["<img src=x onerror=alert(1)>"]\n```', serve);
    expect(html).not.toContain('<img');
  });

  describe('front matter', () => {
    const source = '---\ntitle: Hello <b>\ntags: [a, b]\nmeta:\n  draft: true\n  rank: null\n---\n\n# Body';

    it('renders front matter as a table with nested tables by default', async () => {
      const result = await render(source, serve);
      expect(result.title).toBe('Body');
      expect(result.warnings).toEqual([]);
      expect(result.html).toBe(
        '<table><thead><tr><th>title</th><th>tags</th><th>meta</th></tr></thead>' +
          '<tbody><tr><td>Hello &#x3C;b></td>' +
          '<td><table><tbody><tr><td>a</td><td>b</td></tr></tbody></table></td>' +
          '<td><table><thead><tr><th>draft</th><th>rank</th></tr></thead><tbody><tr><td>true</td><td></td></tr></tbody></table></td>' +
          '</tr></tbody></table>\n<h1 id="body">Body</h1>',
      );
    });

    it('hides front matter in hide mode', async () => {
      const { html } = await createRenderer([], { frontMatter: 'hide' })(source, serve);
      expect(html).toBe('<h1 id="body">Body</h1>');
    });

    it('renders nothing for empty front matter and wraps scalar documents', async () => {
      expect((await render('---\n---\n\ntext', serve)).html).toBe('<p>text</p>');
      expect((await render('---\njust text\n---', serve)).html).toBe(
        '<table><tbody><tr><td>just text</td></tr></tbody></table>',
      );
    });

    it('warns about invalid YAML and shows the source', async () => {
      const broken = '---\ntitle: [unclosed\n---\n\nbody';
      const table = await render(broken, serve);
      expect(table.warnings).toHaveLength(1);
      expect(table.warnings[0]).toMatch(/^invalid front matter YAML: /);
      expect(table.html).toContain('<pre class="shiki');
      expect(table.html).toContain('unclosed');

      const hidden = await createRenderer([], { frontMatter: 'hide' })(broken, serve);
      expect(hidden.warnings).toHaveLength(1);
      expect(hidden.html).toBe('<p>body</p>');
    });

    it('only treats front matter at the start of the file', async () => {
      const { html } = await render('text\n\n---\na: 1\n---', serve);
      expect(html).not.toContain('<table>');
    });
  });

  describe('container directives', () => {
    it('turns :::name into a div with the name as its class', async () => {
      const { html } = await render(':::test\nbody **bold**\n:::', serve);
      expect(html).toBe('<div class="test"><p>body <strong>bold</strong></p></div>');
    });

    it('nests directives when the outer fence has more colons', async () => {
      const { html } = await render('::::outer\na\n:::inner\nb\n:::\nc\n::::', serve);
      expect(html).toBe('<div class="outer"><p>a</p><div class="inner"><p>b</p></div><p>c</p></div>');
    });

    it('renders the label as the first paragraph and ignores attributes', async () => {
      const { html } = await render(':::note[Title]{.extra #id}\nbody\n:::', serve);
      expect(html).toBe('<div class="note"><p>Title</p><p>body</p></div>');
    });

    it('renders Markdown, math and mermaid inside directives', async () => {
      const result = await render(':::box\n$x$\n\n```mermaid\ngraph TD; A-->B\n```\n:::', serve);
      expect(result.hasMath).toBe(true);
      expect(result.hasMermaid).toBe(true);
      expect(result.html).toMatch(/^<div class="box">.*<pre class="mermaid">/s);
    });

    it('keeps text and leaf directive syntax as the original text', async () => {
      const { html } = await render('key:value and :smile: :abbr[x]{a=1}\n\n::leaf{a=1}\n\n:::\nanon\n:::', serve);
      expect(html).toBe('<p>key:value and :smile: :abbr[x]{a=1}</p>\n<p>::leaf{a=1}</p>\n<p>:::\nanon\n:::</p>');
    });

    it('allows only directive-like class names on raw HTML divs', async () => {
      const { html } = await render('<div class="ok bad!x">raw</div>\n\n<span class="no">s</span>', serve);
      expect(html).toContain('<div class="ok">raw</div>');
      expect(html).toContain('<span>s</span>');
    });
  });

  describe('links', () => {
    const source ='[b](b.md#x) [ext](https://example.com/c.md) ![i](/img/a.png)';

    it('keeps relative links as is in serve mode', async () => {
      const { html } = await render(source, serve);
      expect(html).toContain('href="b.md#x"');
      expect(html).toContain('src="/img/a.png"');
    });

    it('rewrites Markdown links and root-relative paths in export mode', async () => {
      const { html } = await render(source, exported);
      expect(html).toContain('href="b.html#x"');
      expect(html).toContain('href="https://example.com/c.md"');
      expect(html).toContain('src="../img/a.png"');
    });
  });

  describe('metadata', () => {
    it('uses the first h1 as the title', async () => {
      const result = await render('## Sub\n\n# First *Title*\n\n# Second', serve);
      expect(result.title).toBe('First Title');
      expect(result.hasMath).toBe(false);
      expect(result.hasMermaid).toBe(false);
    });

    it('falls back to the file name without extension', async () => {
      const result = await render('no heading', { filePath: 'docs/guide.markdown', linkMode: 'serve' });
      expect(result.title).toBe('guide');
    });
  });

  it('runs extra plugins with the file path', async () => {
    const seen: string[] = [];
    const withPlugin = createRenderer([() => (_tree: unknown, file: { path: string }) => void seen.push(file.path)]);
    await withPlugin('text', exported);
    expect(seen).toEqual(['docs/a.md']);
  });
});
