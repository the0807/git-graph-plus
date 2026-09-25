// Issue #61: helpers for the opt-in "load history as you scroll" behaviour.

/** Distance from the bottom (px) that counts as "near the bottom". */
export const AUTO_LOAD_THRESHOLD_PX = 300;

/**
 * True when the scroll container is within `threshold` px of its bottom.
 * Content that fits the viewport counts as being at the bottom (there is
 * nothing left to scroll), and non-finite layout metrics are treated as
 * "not near the bottom" so a broken measurement never triggers a request.
 */
export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold: number = AUTO_LOAD_THRESHOLD_PX,
): boolean {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(clientHeight) || !Number.isFinite(scrollHeight)) {
    return false;
  }
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}
