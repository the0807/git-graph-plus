// Issue #80: a high-contrast light theme puts both `vscode-light` and
// `vscode-high-contrast` on <body>. The high-contrast `.ref-badge` rule comes
// last, so it wins the text color while the light rules above supply the pale
// fills — a hardcoded white made tags/branches/stashes unreadable. The rule
// must use a theme color that is white in HC dark and dark in HC light.
//
// happy-dom does not apply component <style> blocks, so these assertions read
// the component source: they pin the exact declarations that caused the bug.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPONENTS: Array<{ name: string; file: string }> = [
  { name: 'CommitGraph', file: '../components/graph/CommitGraph.svelte' },
  { name: 'CommitDetails', file: '../components/commit/CommitDetails.svelte' },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ruleBody(source: string, selector: string): string {
  const pattern = new RegExp(`${escapeRegExp(selector).replace(/ /g, '\\s+')}\\s*\\{([^}]*)\\}`);
  const match = source.match(pattern);
  if (!match) throw new Error(`CSS rule not found: ${selector}`);
  return match[1];
}

describe.each(COMPONENTS)('$name high-contrast ref badges (#80)', ({ file }) => {
  const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
  const body = ruleBody(source, ':global(body.vscode-high-contrast) .ref-badge');

  it('does not hardcode a white text color', () => {
    expect(body).not.toMatch(/color:\s*(#fff\b|#ffffff\b|white\b)/i);
  });

  it('uses an adaptive theme foreground (white in HC dark, black in HC light)', () => {
    expect(body).toMatch(/color:\s*var\(--vscode-strongForeground/);
    expect(body).toContain('var(--vscode-foreground, #fff)');
  });
});
