import type { HighlighterCore, ThemedToken, LanguageRegistration } from 'shiki';

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

// One dynamic import per Shiki grammar. Languages are pulled in on demand the
// first time a diff needs them (see ensureLanguage) instead of being bundled
// into the highlighter at init — keeps first-open light while still covering
// every language LANG_MAP can resolve to. Every value here must have a matching
// LANG_MAP entry, otherwise the grammar can never be requested.
const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  mdx: () => import('shiki/langs/mdx.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  astro: () => import('shiki/langs/astro.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  fsharp: () => import('shiki/langs/fsharp.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  make: () => import('shiki/langs/make.mjs'),
};

// Single-file component grammars delegate parts of the document to embedded
// languages. Load those eagerly with the container grammar so `<script lang="ts">`
// and `<style lang="scss">` blocks don't depend on a previous standalone TS/CSS
// diff having warmed the Shiki language cache.
const EMBEDDED_LANGS: Record<string, string[]> = {
  vue: ['html', 'css', 'scss', 'javascript', 'typescript', 'json'],
  svelte: ['html', 'css', 'scss', 'javascript', 'typescript'],
  astro: ['html', 'css', 'scss', 'javascript', 'typescript'],
};

export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const base = filename.split('/').pop()?.toLowerCase() ?? '';

  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'make';

  return LANG_MAP[ext] ?? '';
}

export async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { createHighlighterCore } = await import('shiki');
    const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript');

    const engine = createJavaScriptRegexEngine();

    // Both VS Code themes are loaded so we can match the editor's light/dark
    // appearance (see activeShikiTheme). Grammars start empty and load lazily.
    const h = await createHighlighterCore({
      themes: [
        import('shiki/themes/dark-plus.mjs'),
        import('shiki/themes/light-plus.mjs'),
      ],
      langs: [],
      engine,
    });

    highlighter = h;
    return h;
  })();

  return loadingPromise;
}

// Dedupe concurrent loads of the same grammar so a multi-file diff session
// imports each language at most once.
const langLoadPromises = new Map<string, Promise<void>>();

/**
 * Ensure the grammar for `lang` is loaded into the highlighter. Returns true
 * once the language is available, false if it has no loader or the import
 * failed. Safe to call repeatedly — already-loaded languages resolve instantly.
 */
export async function ensureLanguage(h: HighlighterCore, lang: string): Promise<boolean> {
  if (!lang) return false;
  if (h.getLoadedLanguages().includes(lang as never)) return true;
  const loader = LANG_LOADERS[lang];
  if (!loader) return false;

  let p = langLoadPromises.get(lang);
  if (!p) {
    p = Promise.all((EMBEDDED_LANGS[lang] ?? []).map(dep => ensureLanguage(h, dep)))
      .then(() => loader())
      .then(mod => {
        const grammar = (mod as { default: LanguageRegistration[] }).default;
        return h.loadLanguage(grammar);
      })
      .then(() => {});
    langLoadPromises.set(lang, p);
  }
  try {
    await p;
    return h.getLoadedLanguages().includes(lang as never);
  } catch {
    // Let a later call retry rather than caching the failure forever.
    langLoadPromises.delete(lang);
    return false;
  }
}

export function warmHighlighterLanguages(langs: string[] = ['vue', 'svelte', 'astro']): void {
  void getHighlighter()
    .then(h => Promise.all(langs.map(lang => ensureLanguage(h, lang))))
    .catch(() => {});
}

/** Theme that matches the current VS Code color theme, so highlighted tokens
 *  sit correctly on the diff background (dark-plus on dark, light-plus on light). */
export function activeShikiTheme(): 'dark-plus' | 'light-plus' {
  return typeof document !== 'undefined' && document.body.classList.contains('vscode-light')
    ? 'light-plus'
    : 'dark-plus';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tokensToHtml(tokens: ThemedToken[] | undefined, fallback: string): string {
  if (!tokens) return escapeHtml(fallback);
  return tokens
    .map((token: ThemedToken) => {
      const color = token.color;
      const escaped = escapeHtml(token.content);
      return color ? `<span style="color:${color}">${escaped}</span>` : escaped;
    })
    .join('');
}

function sourceLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r\n|\r|\n/);
  return /(?:\r\n|\r|\n)$/.test(text) ? lines.slice(0, -1) : lines;
}

export function highlightLineSync(
  h: HighlighterCore,
  content: string,
  lang: string,
  theme: 'dark-plus' | 'light-plus' = activeShikiTheme(),
): string {
  if (!lang) return escapeHtml(content);
  try {
    const loadedLangs = h.getLoadedLanguages();
    if (!loadedLangs.includes(lang as never)) return escapeHtml(content);

    const tokens = h.codeToTokens(content, { lang: lang as never, theme });
    if (!tokens.tokens[0]) return escapeHtml(content);

    return tokensToHtml(tokens.tokens[0], content);
  } catch {
    return escapeHtml(content);
  }
}

export function highlightCodeLinesSync(
  h: HighlighterCore,
  content: string,
  lang: string,
  theme: 'dark-plus' | 'light-plus' = activeShikiTheme(),
): string[] {
  const lines = sourceLines(content);
  if (!lang || lines.length === 0) return lines.map(escapeHtml);
  try {
    const loadedLangs = h.getLoadedLanguages();
    if (!loadedLangs.includes(lang as never)) return lines.map(escapeHtml);

    const tokens = h.codeToTokens(content, { lang: lang as never, theme }).tokens;
    return lines.map((line, index) => tokensToHtml(tokens[index], line));
  } catch {
    return lines.map(escapeHtml);
  }
}

export async function highlightLine(content: string, lang: string): Promise<string> {
  if (!lang) return escapeHtml(content);
  try {
    const h = await getHighlighter();
    await ensureLanguage(h, lang);
    return highlightLineSync(h, content, lang);
  } catch {
    return escapeHtml(content);
  }
}

export { escapeHtml };
