import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AvatarCache, type AvatarFetcher } from '../avatar-cache';

// A fake fetcher that records every URL it is asked to fetch and returns a
// fixed PNG payload, so tests never touch the network.
function makeFetcher(): { fetcher: AvatarFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: AvatarFetcher = async (url) => {
    calls.push(url);
    return { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' };
  };
  return { fetcher, calls };
}

describe('AvatarCache', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ggp-avatar-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('fetches an avatar once and returns a base64 data URI', async () => {
    const { fetcher, calls } = makeFetcher();
    const cache = new AvatarCache(null, fetcher);

    const uri = await cache.get('Alice@Example.com', 32);

    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(calls).toHaveLength(1);
    // Email is hashed lowercase+trimmed per the gravatar spec.
    expect(calls[0]).toContain('https://www.gravatar.com/avatar/');
    expect(calls[0]).toContain('s=32');
  });

  it('generates a retro avatar offline', async () => {
    const { fetcher, calls } = makeFetcher();
    const cache = new AvatarCache(null, fetcher, { source: 'retro' });

    const uri = await cache.get('Alice@Example.com', 32);

    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(calls).toHaveLength(0);
  });

  it('generates the same Retro avatar for equivalent emails across instances', async () => {
    const first = new AvatarCache(null, makeFetcher().fetcher, { source: 'retro' });
    const second = new AvatarCache(null, makeFetcher().fetcher, { source: 'retro' });

    expect(await first.get('Alice@Example.com', 32)).toBe(
      await second.get('  alice@example.com  ', 32),
    );
  });

  it('generates different Retro avatars for different emails', async () => {
    const cache = new AvatarCache(null, makeFetcher().fetcher, { source: 'retro' });

    expect(await cache.get('alice@example.com', 32)).not.toBe(
      await cache.get('bob@example.com', 32),
    );
  });

  it('does not reuse a Gravatar disk entry for the Retro source', async () => {
    await new AvatarCache(tmpDir, makeFetcher().fetcher).get('alice@example.com', 32);
    const { fetcher, calls } = makeFetcher();

    const uri = await new AvatarCache(tmpDir, fetcher, { source: 'retro' })
      .get('alice@example.com', 32);

    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(calls).toHaveLength(0);
  });

  it('serves repeat requests from memory without re-fetching', async () => {
    const { fetcher, calls } = makeFetcher();
    const cache = new AvatarCache(null, fetcher);

    await cache.get('alice@example.com', 32);
    await cache.get('  Alice@Example.com  ', 32); // same identity after normalization

    expect(calls).toHaveLength(1);
  });

  it('de-duplicates concurrent requests for the same avatar', async () => {
    const { fetcher, calls } = makeFetcher();
    const cache = new AvatarCache(null, fetcher);

    const [a, b] = await Promise.all([
      cache.get('alice@example.com', 32),
      cache.get('alice@example.com', 32),
    ]);

    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it('persists to disk so a fresh instance avoids the network', async () => {
    const { fetcher: f1, calls: c1 } = makeFetcher();
    const first = new AvatarCache(tmpDir, f1);
    await first.get('alice@example.com', 32);
    expect(c1).toHaveLength(1);

    const { fetcher: f2, calls: c2 } = makeFetcher();
    const second = new AvatarCache(tmpDir, f2);
    const uri = await second.get('alice@example.com', 32);

    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(c2).toHaveLength(0); // served from disk, no fetch
  });

  it('returns null when the fetch fails', async () => {
    const failing: AvatarFetcher = async () => null;
    const cache = new AvatarCache(null, failing);

    expect(await cache.get('alice@example.com', 32)).toBeNull();
  });

  it('re-fetches once a cached entry exceeds its TTL', async () => {
    const { fetcher: f1 } = makeFetcher();
    await new AvatarCache(tmpDir, f1).get('alice@example.com', 32);

    // Age the cached file well past any reasonable TTL.
    const [name] = await fs.readdir(tmpDir);
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365);
    await fs.utimes(path.join(tmpDir, name), old, old);

    const { fetcher: f2, calls: c2 } = makeFetcher();
    const uri = await new AvatarCache(tmpDir, f2).get('alice@example.com', 32);

    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(c2).toHaveLength(1); // stale -> re-fetched
  });

  it('serves the stale cached copy when a refresh fails', async () => {
    const { fetcher: f1 } = makeFetcher();
    await new AvatarCache(tmpDir, f1).get('alice@example.com', 32);

    const [name] = await fs.readdir(tmpDir);
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365);
    await fs.utimes(path.join(tmpDir, name), old, old);

    const failing: AvatarFetcher = async () => null;
    const uri = await new AvatarCache(tmpDir, failing).get('alice@example.com', 32);

    expect(uri).toMatch(/^data:image\/png;base64,/); // stale copy, not null
  });

  it('prunes the disk cache so it does not grow unbounded', async () => {
    const { fetcher } = makeFetcher();
    const cache = new AvatarCache(tmpDir, fetcher, { maxDiskEntries: 2 });

    await cache.get('a@example.com', 32);
    await cache.get('b@example.com', 32);
    await cache.get('c@example.com', 32);
    await cache.get('d@example.com', 32);

    const files = await fs.readdir(tmpDir);
    expect(files.length).toBeLessThanOrEqual(2);
  });

  it('falls back to image/png when the fetcher reports no content type', async () => {
    const fetcher: AvatarFetcher = async () => ({ data: Buffer.from([1, 2, 3]), contentType: '' });
    const cache = new AvatarCache(null, fetcher);

    const uri = await cache.get('alice@example.com', 32);

    expect(uri).toMatch(/^data:image\/png;base64,/);
  });

  it('evicts the least-recently-used entry once memory exceeds its cap', async () => {
    // MAX_MEMORY_ENTRIES is 500; the 501st distinct avatar evicts the oldest.
    const { fetcher, calls } = makeFetcher();
    const cache = new AvatarCache(null, fetcher); // memory-only, no disk

    for (let i = 0; i <= 500; i++) await cache.get(`u${i}@example.com`, 32);
    expect(calls).toHaveLength(501);

    // u0 was the oldest and was evicted when u500 pushed the map past the cap,
    // so requesting it again re-fetches.
    await cache.get('u0@example.com', 32);
    expect(calls).toHaveLength(502);

    // A recently-used entry is still served from memory (no extra fetch).
    await cache.get('u500@example.com', 32);
    expect(calls).toHaveLength(502);
  });

  it('still returns the avatar when the best-effort disk write fails', async () => {
    // Point the cache dir at an existing *file* so mkdir/writeFile throw; the
    // write is best-effort and must not stop the avatar from being served.
    const filePath = path.join(tmpDir, 'not-a-directory');
    await fs.writeFile(filePath, 'x');

    const { fetcher, calls } = makeFetcher();
    const cache = new AvatarCache(filePath, fetcher);

    const uri = await cache.get('alice@example.com', 32);

    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(calls).toHaveLength(1);
  });
});
