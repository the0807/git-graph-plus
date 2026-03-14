import type { HighlighterCore, ThemedToken } from 'shiki';

let highlighter: HighlighterCore | null = null;
let loadingPromise: Promise<HighlighterCore> | null = null;

const LANG_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  json: 'json', html: 'html', css: 'css', scss: 'scss',
  py: 'python', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
  yaml: 'yaml', yml: 'yaml', md: 'markdown', mdx: 'mdx',
  sql: 'sql', xml: 'xml', svg: 'xml',
  toml: 'toml', ini: 'ini', dockerfile: 'dockerfile',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
  cs: 'csharp', fs: 'fsharp',
  graphql: 'graphql', gql: 'graphql',
  txt: '', '': '',
};

export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const base = filename.split('/').pop()?.toLowerCase() ?? '';

  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'make';

  return LANG_MAP[ext] ?? '';
}

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { createHighlighterCore } = await import('shiki');
    const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript');

    const engine = createJavaScriptRegexEngine();

    const h = await createHighlighterCore({
      themes: [
        import('shiki/themes/dark-plus.mjs'),
      ],
      langs: [
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/html.mjs'),
        import('shiki/langs/css.mjs'),
        import('shiki/langs/python.mjs'),
        import('shiki/langs/go.mjs'),
        import('shiki/langs/rust.mjs'),
        import('shiki/langs/java.mjs'),
        import('shiki/langs/c.mjs'),
        import('shiki/langs/cpp.mjs'),
        import('shiki/langs/shellscript.mjs'),
        import('shiki/langs/yaml.mjs'),
        import('shiki/langs/markdown.mjs'),
        import('shiki/langs/sql.mjs'),
        import('shiki/langs/jsx.mjs'),
        import('shiki/langs/tsx.mjs'),
      ],
      engine,
    });

    highlighter = h;
    return h;
  })();

  return loadingPromise;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function highlightLine(content: string, lang: string): Promise<string> {
  if (!lang) {
    return escapeHtml(content);
  }

  try {
    const h = await getHighlighter();
    const loadedLangs = h.getLoadedLanguages();

    if (!loadedLangs.includes(lang as any)) {
      return escapeHtml(content);
    }

    const tokens = h.codeToTokens(content, {
      lang: lang as any,
      theme: 'dark-plus',
    });

    if (!tokens.tokens[0]) {
      return escapeHtml(content);
    }

    return tokens.tokens[0]
      .map((token: ThemedToken) => {
        const color = token.color;
        const escaped = escapeHtml(token.content);
        return color ? `<span style="color:${color}">${escaped}</span>` : escaped;
      })
      .join('');
  } catch {
    return escapeHtml(content);
  }
}

export { escapeHtml };
