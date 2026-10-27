import { describe, expect, it } from 'vitest';
import { renderIndexBody } from '../../src/render/index-page.js';
import {
  baseCss,
  escapeRawText,
  renderExportPage,
  renderServePage,
  SERVE_PATHS,
  type ExportAssets,
  type PageBody,
} from '../../src/render/page.js';

const body: PageBody = { title: 'A <b> & "c"', html: '<p>hi</p>', hasMath: false, hasMermaid: false };
const assets: ExportAssets = {
  theme: 'auto',
  githubCss: '.github{}',
  katexCss: '.katex{}',
  mermaidJs: 'window.mermaid={}',
};

describe('escapeRawText', () => {
  it('neutralizes closing tags case-insensitively', () => {
    expect(escapeRawText('a</script>b</SCRIPT>', 'script')).toBe('a<\\/script>b<\\/SCRIPT>');
    expect(escapeRawText('a</style>', 'style')).toBe('a<\\/style>');
  });
});

describe('renderServePage', () => {
  it('links serve assets and escapes the title and path', () => {
    const html = renderServePage({ ...body, filePath: 'docs/"x".md', hasCustomCss: false, theme: 'auto', defaultCss: true });
    expect(html).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>');
    expect(html).toContain('data-mdlive-path="docs/&quot;x&quot;.md"');
    expect(html).toContain(`href="${SERVE_PATHS.githubCss}"`);
    expect(html).toContain(`href="${SERVE_PATHS.katexCss}"`);
    expect(html).toContain(`src="${SERVE_PATHS.mermaidJs}"`);
    expect(html).toContain(`src="${SERVE_PATHS.client}"`);
    expect(html).not.toContain(SERVE_PATHS.customCss);
    expect(html).toContain('<article class="markdown-body"><p>hi</p></article>');
  });

  it('links custom CSS after the default styles', () => {
    const html = renderServePage({ ...body, filePath: 'a.md', hasCustomCss: true, theme: 'auto', defaultCss: true });
    expect(html.indexOf(SERVE_PATHS.customCss)).toBeGreaterThan(html.indexOf(SERVE_PATHS.githubCss));
  });
});

describe('renderExportPage', () => {
  it('inlines only the assets the page needs and references nothing external', () => {
    const html = renderExportPage(body, assets);
    expect(html).toContain('<style>.github{}</style>');
    expect(html).not.toContain('.katex{}');
    expect(html).not.toContain('window.mermaid');
    expect(html).not.toMatch(/<(link|script)[^>]+(href|src)=/);
  });

  it('inlines KaTeX CSS and Mermaid when used', () => {
    const html = renderExportPage({ ...body, hasMath: true, hasMermaid: true }, assets);
    expect(html).toContain('<style>.katex{}</style>');
    expect(html).toContain('<script>window.mermaid={}</script>');
    expect(html).toContain('__mdliveRenderMermaid');
  });

  it('places custom CSS last and escapes closing tags', () => {
    const html = renderExportPage(body, { ...assets, customCss: 'body{}</style><script>x</script>' });
    expect(html).toContain('<style>body{}<\\/style><script>x</script></style>');
    expect(html.indexOf('body{}')).toBeGreaterThan(html.indexOf('.github{}'));
  });
});

describe('themes', () => {
  it('follows the OS setting only in auto mode', () => {
    expect(baseCss('auto', true)).toContain('color-scheme: light dark');
    expect(baseCss('auto', true)).toContain('@media (prefers-color-scheme: dark)');
    expect(baseCss('light', true)).toContain('color-scheme: light;');
    expect(baseCss('dark', true)).toContain('color-scheme: dark;');
    for (const theme of ['light', 'dark'] as const) expect(baseCss(theme, true)).not.toContain('prefers-color-scheme');
  });

  it('applies dark backgrounds and Shiki dark colors only for dark themes', () => {
    expect(baseCss('light', true)).not.toContain('--shiki-dark');
    expect(baseCss('dark', true)).toMatch(/^html \{ color-scheme: dark; \}\s*body \{ margin: 0; background-color: #0d1117; \}/);
    expect(baseCss('dark', true)).toContain('.shiki span { color: var(--shiki-dark) !important; }');
  });

  it('keeps only the essential rules without the default style', () => {
    const css = baseCss('auto', false);
    expect(css).toContain('color-scheme: light dark');
    expect(css).toContain('.shiki span { color: var(--shiki-dark) !important; }');
    expect(css).toContain('.sr-only');
    expect(css).not.toContain('background-color');
    expect(css).not.toContain('max-width');
    expect(baseCss('dark', false)).toBe(
      'html { color-scheme: dark; }\n.shiki span { color: var(--shiki-dark) !important; }\n' + css.split('\n').at(-1),
    );
  });

  it('omits the GitHub style when the default style is disabled', () => {
    const serve = renderServePage({ ...body, filePath: 'a.md', hasCustomCss: true, theme: 'auto', defaultCss: false });
    expect(serve).not.toContain(SERVE_PATHS.githubCss);
    expect(serve).toContain(SERVE_PATHS.katexCss);
    expect(serve).toContain(SERVE_PATHS.customCss);
    expect(serve).toContain('<article class="markdown-body">');

    const { githubCss: _github, ...withoutGithub } = assets;
    const exported = renderExportPage(body, withoutGithub);
    expect(exported).not.toContain('.github{}');
    expect(exported).not.toContain('max-width');
  });

  it('fixes the mermaid theme when the page theme is fixed', () => {
    const mermaid = { ...body, hasMermaid: true };
    expect(renderExportPage(mermaid, { ...assets, theme: 'dark' })).toContain('const theme = "dark";');
    expect(renderServePage({ ...body, filePath: 'a.md', hasCustomCss: false, theme: 'light', defaultCss: true })).toContain(
      'const theme = "light";',
    );
  });
});

describe('renderIndexBody', () => {
  const files = ['z.md', 'docs/b.md', 'docs/a b.md', 'docs/deep/c.markdown', 'a.md'];

  it('lists directories first, then files, sorted by name', () => {
    const { html } = renderIndexBody('root', files, 'serve');
    expect(html).toBe(
      '<h1>root</h1>\n<ul>' +
        '<li>docs/<ul>' +
        '<li>deep/<ul><li><a href="/docs/deep/c.markdown">c.markdown</a></li></ul></li>' +
        '<li><a href="/docs/a%20b.md">a b.md</a></li>' +
        '<li><a href="/docs/b.md">b.md</a></li>' +
        '</ul></li>' +
        '<li><a href="/a.md">a.md</a></li>' +
        '<li><a href="/z.md">z.md</a></li>' +
        '</ul>',
    );
  });

  it('links to .html files in export mode', () => {
    const { html } = renderIndexBody('root', ['docs/deep/c.markdown'], 'export');
    expect(html).toContain('href="docs/deep/c.html"');
  });

  it('escapes names and shows a message for empty directories', () => {
    expect(renderIndexBody('<root>', [], 'serve')).toEqual({
      title: '<root>',
      hasMath: false,
      hasMermaid: false,
      html: '<h1>&lt;root&gt;</h1>\n<p>No Markdown files found.</p>',
    });
  });
});
