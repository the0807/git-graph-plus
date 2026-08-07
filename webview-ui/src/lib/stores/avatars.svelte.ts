import { SvelteMap } from 'svelte/reactivity';
import { getVsCodeApi } from '../vscode-api';

/** 1x1 transparent GIF shown while an avatar is pending or unavailable, so the
 *  layout stays stable and no broken-image icon flashes. */
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * Avatars are fetched and cached by the extension host (see `AvatarCache`),
 * not by this webview. That keeps the renderer from opening a fresh connection
 * to gravatar.com on every render/scroll/window — the socket exhaustion in
 * issue #38.
 *
 * `url(email, size)` is meant to be read directly in markup: it returns the
 * cached data URI (reactively, via SvelteMap) and, on the first read for a
 * given key, asks the extension to resolve it. While pending or unavailable it
 * returns a transparent pixel so callers can use it as a drop-in `src`.
 */
class AvatarStore {
  // key -> data URI; '' means resolved-but-unavailable (failed fetch).
  private cache = new SvelteMap<string, string>();
  private requested = new Set<string>();
  private generation = 0;

  private key(email: string, size: number): string {
    return `${email.trim().toLowerCase()}:${size}`;
  }

  url(email: string, size: number): string {
    const key = this.key(email, size);
    const hit = this.cache.get(key);
    if (hit === undefined && !this.requested.has(key)) {
      this.requested.add(key);
      getVsCodeApi().postMessage({
        type: 'getAvatar',
        payload: { email, size, generation: this.generation },
      });
    }
    return hit || TRANSPARENT_PIXEL;
  }

  receive(email: string, size: number, dataUri: string | null, generation = this.generation): void {
    if (generation !== this.generation) return;
    this.cache.set(this.key(email, size), dataUri ?? '');
  }

  reset(): void {
    this.generation += 1;
    this.cache.clear();
    this.requested.clear();
  }
}

export const avatarStore = new AvatarStore();
