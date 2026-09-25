import { describe, it, expect } from 'vitest';
import { AUTO_LOAD_THRESHOLD_PX, isNearBottom } from '../auto-load';

describe('isNearBottom', () => {
  it('is false when the viewport is far from the bottom', () => {
    expect(isNearBottom(0, 300, 3000)).toBe(false);
  });

  it('is true at the exact bottom', () => {
    expect(isNearBottom(2700, 300, 3000)).toBe(true);
  });

  it('is true within the default threshold', () => {
    expect(isNearBottom(2700 - AUTO_LOAD_THRESHOLD_PX, 300, 3000)).toBe(true);
  });

  it('is false just beyond the default threshold', () => {
    expect(isNearBottom(2700 - AUTO_LOAD_THRESHOLD_PX - 1, 300, 3000)).toBe(false);
  });

  it('honours a caller-supplied threshold', () => {
    expect(isNearBottom(2700 - 100, 300, 3000, 50)).toBe(false);
    expect(isNearBottom(2700 - 50, 300, 3000, 50)).toBe(true);
  });

  it('treats content that fits the viewport as being at the bottom', () => {
    expect(isNearBottom(0, 800, 500)).toBe(true);
  });

  it('is false for non-finite measurements', () => {
    expect(isNearBottom(NaN, 300, 3000)).toBe(false);
    expect(isNearBottom(0, Infinity, 3000)).toBe(false);
    expect(isNearBottom(0, 300, NaN)).toBe(false);
  });
});
