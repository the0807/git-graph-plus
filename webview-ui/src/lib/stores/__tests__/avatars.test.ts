import { describe, it, expect } from 'vitest';
import { avatarStore } from '../avatars.svelte';

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// Read the messages the store posted to the extension host via the recording
// stub installed in the webview test setup.
function postedTypes(): string[] {
  return globalThis.__postedMessages.map((m) => (m.data as { type: string }).type);
}

describe('avatarStore', () => {
  it('returns a transparent pixel and requests the avatar on first read', () => {
    const result = avatarStore.url('first@example.com', 32);

    expect(result).toBe(TRANSPARENT_PIXEL);
    expect(postedTypes()).toContain('getAvatar');
    const msg = globalThis.__postedMessages.at(-1)?.data as {
      type: string;
      payload: { email: string; size: number; generation: number };
    };
    expect(msg.payload).toEqual({
      email: 'first@example.com',
      size: 32,
      generation: expect.any(Number),
    });
  });

  it('does not re-request a key that is already pending', () => {
    avatarStore.url('second@example.com', 32);
    const countAfterFirst = globalThis.__postedMessages.length;
    avatarStore.url('second@example.com', 32); // same key — should not re-post
    expect(globalThis.__postedMessages.length).toBe(countAfterFirst);
  });

  it('serves a resolved data URI after receive()', () => {
    const dataUri = 'data:image/png;base64,AAAA';
    avatarStore.receive('third@example.com', 32, dataUri);
    expect(avatarStore.url('third@example.com', 32)).toBe(dataUri);
  });

  it('treats a null receive() as resolved-but-unavailable (transparent pixel, no re-request)', () => {
    avatarStore.receive('fourth@example.com', 32, null);
    const countBefore = globalThis.__postedMessages.length;
    const result = avatarStore.url('fourth@example.com', 32);
    expect(result).toBe(TRANSPARENT_PIXEL);
    // It is cached as '' so url() must not fire another getAvatar request.
    expect(globalThis.__postedMessages.length).toBe(countBefore);
  });

  it('normalizes email casing and whitespace into the same cache key', () => {
    avatarStore.receive('Fifth@Example.com', 32, 'data:image/png;base64,BBBB');
    expect(avatarStore.url('  fifth@example.com  ', 32)).toBe('data:image/png;base64,BBBB');
  });

  it('requests avatars again after the configured source changes', () => {
    const email = 'source-switch@example.com';
    avatarStore.receive(email, 32, 'data:image/png;base64,OLD');
    const messagesBeforeReset = globalThis.__postedMessages.length;

    avatarStore.reset();
    const result = avatarStore.url(email, 32);

    expect(result).toBe(TRANSPARENT_PIXEL);
    expect(globalThis.__postedMessages).toHaveLength(messagesBeforeReset + 1);
    expect(globalThis.__postedMessages.at(-1)?.data).toEqual({
      type: 'getAvatar',
      payload: { email, size: 32, generation: expect.any(Number) },
    });
  });

  it('ignores a response from the avatar source used before reset', () => {
    const email = 'source-race@example.com';
    avatarStore.reset();
    avatarStore.url(email, 32);
    const oldRequest = globalThis.__postedMessages.at(-1)?.data as {
      payload: { generation: number };
    };

    avatarStore.reset();
    avatarStore.url(email, 32);
    const newRequest = globalThis.__postedMessages.at(-1)?.data as {
      payload: { generation: number };
    };

    avatarStore.receive(email, 32, 'data:image/png;base64,OLD', oldRequest.payload.generation);
    expect(avatarStore.url(email, 32)).toBe(TRANSPARENT_PIXEL);

    avatarStore.receive(email, 32, 'data:image/png;base64,NEW', newRequest.payload.generation);
    expect(avatarStore.url(email, 32)).toBe('data:image/png;base64,NEW');
  });
});
