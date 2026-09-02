<script lang="ts">
  import type { Token, Tokens } from 'marked';
  import LinkifiedText from './LinkifiedText.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';
  import Self from './MarkdownNode.svelte';

  const { tokens }: { tokens: Token[] } = $props();
  const vscode = getVsCodeApi();

  function open(e: MouseEvent, url: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!/^https?:\/\//i.test(url)) return;
    vscode.postMessage({ type: 'openExternalUrl', payload: { url } });
  }

  // marked hands us whatever href the commit message contained, including
  // `javascript:` and other non-http(s) schemes. open() blocks left-clicks,
  // but the raw href still sat on the DOM where a middle-click / keyboard
  // "open in new tab" could reach it. Blank those out so only http(s) links
  // ever carry a real href.
  function safeHref(href: string): string | undefined {
    return /^https?:\/\//i.test(href) ? href : undefined;
  }

  function decodeMarkedText(text: string): string {
    // Marked escapes display text for insertion into an HTML string. This
    // renderer uses Svelte text nodes instead, so reverse exactly that one
    // escaping pass; Svelte still keeps the resulting text inert in the DOM.
    return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => {
      switch (entity) {
        case '&amp;': return '&';
        case '&lt;': return '<';
        case '&gt;': return '>';
        case '&quot;': return '"';
        case '&#39;': return "'";
        default: return entity;
      }
    });
  }
</script>

{#each tokens as tok}
  {#if tok.type === 'space'}
    <!-- nothing -->
  {:else if tok.type === 'heading'}
    {@const h = tok as Tokens.Heading}
    <svelte:element this={`h${h.depth}`} class="md-heading"><Self tokens={h.tokens} /></svelte:element>
  {:else if tok.type === 'paragraph'}
    {@const p = tok as Tokens.Paragraph}
    <p class="md-p"><Self tokens={p.tokens} /></p>
  {:else if tok.type === 'blockquote'}
    {@const b = tok as Tokens.Blockquote}
    <blockquote class="md-quote"><Self tokens={b.tokens} /></blockquote>
  {:else if tok.type === 'list'}
    {@const list = tok as Tokens.List}
    {#if list.ordered}
      <ol class="md-list" start={typeof list.start === 'number' ? list.start : 1}>
        {#each list.items as item}
          <li class="md-li" class:md-task={item.task}>
            {#if item.task}<input type="checkbox" checked={item.checked} disabled />{/if}
            <Self tokens={item.tokens} />
          </li>
        {/each}
      </ol>
    {:else}
      <ul class="md-list">
        {#each list.items as item}
          <li class="md-li" class:md-task={item.task}>
            {#if item.task}<input type="checkbox" checked={item.checked} disabled />{/if}
            <Self tokens={item.tokens} />
          </li>
        {/each}
      </ul>
    {/if}
  {:else if tok.type === 'code'}
    {@const c = tok as Tokens.Code}
    <pre class="md-code"><code>{c.text}</code></pre>
  {:else if tok.type === 'hr'}
    <hr class="md-hr" />
  {:else if tok.type === 'table'}
    {@const table = tok as Tokens.Table}
    <table class="md-table">
      <thead>
        <tr>
          {#each table.header as cell}<th><Self tokens={cell.tokens} /></th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each table.rows as row}
          <tr>{#each row as cell}<td><Self tokens={cell.tokens} /></td>{/each}</tr>
        {/each}
      </tbody>
    </table>
  {:else if tok.type === 'strong'}
    {@const s = tok as Tokens.Strong}
    <strong><Self tokens={s.tokens} /></strong>
  {:else if tok.type === 'em'}
    {@const e = tok as Tokens.Em}
    <em><Self tokens={e.tokens} /></em>
  {:else if tok.type === 'del'}
    {@const d = tok as Tokens.Del}
    <del><Self tokens={d.tokens} /></del>
  {:else if tok.type === 'codespan'}
    {@const cs = tok as Tokens.Codespan}
    <code class="md-codespan">{decodeMarkedText(cs.text)}</code>
  {:else if tok.type === 'br'}
    <br />
  {:else if tok.type === 'link'}
    {@const l = tok as Tokens.Link}
    <a class="commit-link" href={safeHref(l.href)} use:tooltip={t('graph.openLink')} onclick={(e) => open(e, l.href)}><Self tokens={l.tokens} /></a>
  {:else if tok.type === 'image'}
    {@const img = tok as Tokens.Image}
    <a class="commit-link" href={safeHref(img.href)} use:tooltip={t('graph.openLink')} onclick={(e) => open(e, img.href)}>{img.text ? decodeMarkedText(img.text) : img.href}</a>
  {:else if tok.type === 'text'}
    {@const txt = tok as Tokens.Text}
    {#if txt.tokens && txt.tokens.length > 0}
      <Self tokens={txt.tokens} />
    {:else}
      <LinkifiedText text={decodeMarkedText(txt.text)} />
    {/if}
  {:else if tok.type === 'escape'}
    {decodeMarkedText((tok as Tokens.Escape).text)}
  {:else}
    <LinkifiedText text={(tok as { raw: string }).raw} />
  {/if}
{/each}

<style>
  .md-heading { margin: 0.4em 0 0.2em; font-weight: 600; line-height: 1.3; }
  .md-p { margin: 0.3em 0; }
  .md-quote {
    margin: 0.3em 0;
    padding-left: 0.8em;
    border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-panel-border));
    color: var(--vscode-descriptionForeground);
  }
  .md-list { margin: 0.3em 0; padding-left: 1.4em; }
  .md-li { margin: 0.1em 0; }
  .md-task { list-style: none; margin-left: -1em; }
  .md-task input { margin-right: 0.4em; vertical-align: middle; }
  .md-code {
    margin: 0.3em 0;
    padding: 0.5em 0.7em;
    overflow-x: auto;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
    border-radius: 4px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em;
  }
  .md-codespan {
    padding: 0.1em 0.3em;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em;
  }
  .md-hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 0.6em 0; }
  .md-table { border-collapse: collapse; margin: 0.3em 0; }
  .md-table th, .md-table td {
    border: 1px solid var(--vscode-panel-border);
    padding: 0.2em 0.5em;
    text-align: left;
  }
  /* same as LinkifiedText.svelte — Svelte scoped CSS prevents sharing */
  .commit-link { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
  .commit-link:hover { text-decoration: underline; color: var(--vscode-textLink-activeForeground); }
  .commit-link:focus { outline: none; }
  .commit-link:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; border-radius: 2px; }
</style>
