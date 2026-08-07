import { createHash } from 'crypto';

const BACKGROUNDS = ['#5b8def', '#9b72cf', '#45a675', '#d17b49', '#d05f7a', '#4f9da6'];
const SKIN_TONES = ['#f6d0a9', '#e8b482', '#c9855b', '#9b5d3f', '#70422f'];
const HAIR_COLORS = ['#2d211b', '#51352a', '#7a4d2a', '#c28a45', '#25282f'];
const SHIRT_COLORS = ['#f05d5e', '#4f86f7', '#43aa8b', '#f6bd60', '#8e6ccf'];

function pick<T>(values: readonly T[], byte: number): T {
  return values[byte % values.length];
}

/** Generates a deterministic pixel-art face without embedding the source email. */
export function generateRetroAvatar(normalizedEmail: string, size: number): string {
  const bytes = createHash('sha256').update(normalizedEmail).digest();
  const background = pick(BACKGROUNDS, bytes[0]);
  const skin = pick(SKIN_TONES, bytes[1]);
  const hair = pick(HAIR_COLORS, bytes[2]);
  const shirt = pick(SHIRT_COLORS, bytes[3]);
  const hairStyle = bytes[4] % 4;
  const eyeStyle = bytes[5] % 3;
  const mouthStyle = bytes[6] % 3;

  const hairPixels = [
    '<path d="M2 1h4v1H2zM1 2h1v2H1zM6 2h1v2H6z"/>',
    '<path d="M1 1h5v1h1v2H6V3H5V2H4v1H2v1H1z"/>',
    '<path d="M2 1h4v1h1v1H5V2H4v1H2v1H1V2h1z"/>',
    '<path d="M1 1h6v2H6V2H5v1H3V2H2v2H1z"/>',
  ][hairStyle];
  const eyes = [
    '<path d="M2 4h1v1H2zM5 4h1v1H5z"/>',
    '<path d="M2 4h2v1H2zM5 4h1v1H5z"/>',
    '<path d="M2 4h1v1H2zM4 4h2v1H4z"/>',
  ][eyeStyle];
  const mouth = [
    '<path d="M3 6h2v1H3z"/>',
    '<path d="M2 6h1v1h3V6h1v1H6v1H3V7H2z"/>',
    '<path d="M3 6h1v1h1V6h1v1H5v1H4V7H3z"/>',
  ][mouthStyle];

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 8 8" shape-rendering="crispEdges">`,
    `<path fill="${background}" d="M0 0h8v8H0z"/>`,
    `<path fill="${shirt}" d="M1 8V7h1V6h4v1h1v1z"/>`,
    `<path fill="${skin}" d="M2 2h4v1h1v3H6v1H2V6H1V3h1z"/>`,
    `<g fill="${hair}">${hairPixels}</g>`,
    `<g fill="#25282f">${eyes}${mouth}</g>`,
    '</svg>',
  ].join('');

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
