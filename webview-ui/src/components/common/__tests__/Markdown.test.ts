import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import Markdown from '../Markdown.svelte';
import { commitLinkRulesStore } from '../../../lib/stores/commit-link-rules.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';

beforeEach(() => {
  i18n.setLocale('en');
  commitLinkRulesStore.set([]);
  globalThis.__postedMessages = [];
});

describe('Markdown', () => {
  it('renders a heading', () => {
    const { container } = render(Markdown, { props: { text: '# Title' } });
    const h1 = container.querySelector('h1');
    expect(h1?.textContent).toBe('Title');
  });

  it('renders bold, italic and strikethrough', () => {
    const { container } = render(Markdown, { props: { text: '**b** *i* ~~s~~' } });
    expect(container.querySelector('strong')?.textContent).toBe('b');
    expect(container.querySelector('em')?.textContent).toBe('i');
    expect(container.querySelector('del')?.textContent).toBe('s');
  });

  it('renders inline and fenced code', () => {
    const { container } = render(Markdown, { props: { text: 'use `x`\n\n```\ncode\n```' } });
    expect(container.querySelector('code')?.textContent).toBe('x');
    expect(container.querySelector('pre code')?.textContent).toContain('code');
  });

  it('renders markup characters in inline code instead of visible HTML entities', () => {
    const snippet = '<if test="onlyHasVideo==true">';
    const { container } = render(Markdown, { props: { text: `- \`${snippet}\`` } });

    expect(container.querySelector('.md-codespan')?.textContent).toBe(snippet);
    expect(container.querySelector('if')).toBeNull();
  });

  it('decodes marked inline-code entities exactly once', () => {
    const { container } = render(Markdown, {
      props: { text: '`&lt;script&gt;alert(1)&lt;/script&gt;`' },
    });

    expect(container.querySelector('.md-codespan')?.textContent)
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders quotes in Markdown text instead of visible HTML entities', () => {
    const { container } = render(Markdown, {
      props: { text: '- getEnumByCode("250")' },
    });

    expect(container.querySelector('.md-li')?.textContent?.trim()).toBe('getEnumByCode("250")');
  });

  it('decodes marked text entities exactly once', () => {
    const { container } = render(Markdown, {
      props: { text: '- &amp;lt;script&amp;gt;' },
    });

    expect(container.querySelector('.md-li')?.textContent?.trim()).toBe('&lt;script&gt;');
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders escaped markup characters as inert text', () => {
    const { container } = render(Markdown, { props: { text: '- \\<tag\\>' } });

    expect(container.querySelector('.md-li')?.textContent?.trim()).toBe('<tag>');
    expect(container.querySelector('tag')).toBeNull();
  });

  it('renders nested unordered lists', () => {
    const { container } = render(Markdown, { props: { text: '- a\n  - b' } });
    const outer = container.querySelector('ul');
    expect(outer?.querySelector('ul')).not.toBeNull();
    expect(container.textContent).toContain('a');
    expect(container.textContent).toContain('b');
  });

  it('renders a blockquote', () => {
    const { container } = render(Markdown, { props: { text: '> quoted' } });
    expect(container.querySelector('blockquote')?.textContent).toContain('quoted');
  });

  it('preserves single line breaks (breaks: true)', () => {
    const { container } = render(Markdown, { props: { text: 'line1\nline2' } });
    expect(container.querySelector('br')).not.toBeNull();
  });

  it('routes markdown link clicks through openExternalUrl', () => {
    const { container } = render(Markdown, { props: { text: '[gh](https://example.com)' } });
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link.textContent).toBe('gh');
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(globalThis.__postedMessages).toContainEqual({
      data: { type: 'openExternalUrl', payload: { url: 'https://example.com' } },
    });
  });

  it('renders quotes in markdown link labels without changing the href', () => {
    const { container } = render(Markdown, {
      props: { text: '[getEnumByCode("250")](https://example.com)' },
    });
    const link = container.querySelector('a') as HTMLAnchorElement;

    expect(link.textContent).toBe('getEnumByCode("250")');
    expect(link.getAttribute('href')).toBe('https://example.com');
  });

  it('renders an image as a link (CSP blocks external images)', () => {
    const { container } = render(Markdown, { props: { text: '![alt "x"](https://example.com/x.png)' } });
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com/x.png');
    expect(link.textContent).toBe('alt "x"');
    expect(container.querySelector('img')).toBeNull();
  });

  it('escapes raw HTML instead of executing it', () => {
    const { container } = render(Markdown, { props: { text: '<img src=x onerror=alert(1)>' } });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img');
  });

  it('does not forward non-http(s) link schemes to openExternalUrl', () => {
    const { container } = render(Markdown, { props: { text: '[x](javascript:alert(1))' } });
    const link = container.querySelector('a') as HTMLAnchorElement;
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(globalThis.__postedMessages).toEqual([]);
  });

  it('autolinks issue references via linkify in plain text', () => {
    commitLinkRulesStore.set([{ pattern: '#(\\d+)', url: 'https://gh/issues/$1' }]);
    const { container } = render(Markdown, { props: { text: 'fix #12' } });
    const link = container.querySelector('a.commit-link') as HTMLAnchorElement;
    expect(link?.getAttribute('href')).toBe('https://gh/issues/12');
  });
});
