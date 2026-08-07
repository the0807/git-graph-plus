import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as https from 'https';
import { generateRetroAvatar } from './retro-avatar';

/** Fetches the raw bytes for an avatar URL. Returns null on any failure so the
 *  cache can degrade gracefully (the webview falls back to no avatar). Injected
 *  in tests so they never touch the network. */
export type AvatarFetcher = (url: string) => Promise<{ data: Buffer; contentType: string } | null>;
export type AvatarSource = 'gravatar' | 'retro';

const MAX_MEMORY_ENTRIES = 500;
const FETCH_TIMEOUT_MS = 10000;
const MAX_AVATAR_BYTES = 256 * 1024; // avatars are tiny; cap to avoid abuse
// Cap the on-disk cache so it can't grow without bound across many repos and
// contributors over time. ~1000 tiny files is a few MB at most.
const DEFAULT_MAX_DISK_ENTRIES = 1000;
// How long a cached avatar is served before we re-fetch, so a contributor's
// updated Gravatar propagates within a day. Re-fetching at most once per avatar
// per day is nowhere near the per-render hammering we set out to eliminate.
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Caches Gravatar avatars in the extension host (memory + disk) and serves
 *  them to the webview as base64 data URIs. This keeps the webview renderer
 *  from opening a fresh connection to gravatar.com on every render/scroll/
 *  window — the root cause of the socket exhaustion in issue #38. */
export class AvatarCache {
  private memory = new Map<string, string>(); // key -> data URI
  private inflight = new Map<string, Promise<string | null>>();
  private maxDiskEntries: number;
  private ttlMs: number;
  private source: AvatarSource;

  constructor(
    private cacheDir: string | null = null,
    private fetcher: AvatarFetcher = defaultFetcher,
    opts?: { maxDiskEntries?: number; ttlMs?: number; source?: AvatarSource },
  ) {
    this.maxDiskEntries = opts?.maxDiskEntries ?? DEFAULT_MAX_DISK_ENTRIES;
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.source = opts?.source === 'retro' ? 'retro' : 'gravatar';
  }

  /** Returns a base64 data URI for the avatar, or null if it cannot be loaded. */
  async get(email: string, size: number): Promise<string | null> {
    const norm = normalizeEmail(email);
    const key = `${this.source}:${norm}:${size}`;

    const mem = this.memory.get(key);
    if (mem !== undefined) {
      // LRU: refresh recency.
      this.memory.delete(key);
      this.memory.set(key, mem);
      return mem;
    }

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.load(key, norm, size).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async load(key: string, normEmail: string, size: number): Promise<string | null> {
    if (this.source === 'retro') {
      const dataUri = generateRetroAvatar(normEmail, size);
      this.remember(key, dataUri);
      return dataUri;
    }

    const hash = md5(normEmail);
    const diskFile = this.cacheDir ? path.join(this.cacheDir, `${hash}-${size}`) : null;

    // Disk hit. Serve it if still within the TTL; otherwise keep it as a
    // fallback and try to refresh from the network below.
    let staleDataUri: string | null = null;
    if (diskFile) {
      try {
        const stat = await fs.stat(diskFile);
        const dataUri = await fs.readFile(diskFile, 'utf8');
        if (Date.now() - stat.mtimeMs <= this.ttlMs) {
          this.remember(key, dataUri);
          return dataUri;
        }
        staleDataUri = dataUri;
      } catch {
        // disk miss — fall through to network
      }
    }

    const url = `https://www.gravatar.com/avatar/${hash}?s=${size}&d=retro`;
    const res = await this.fetcher(url);
    if (!res) {
      // Refresh failed (e.g. offline). Fall back to the stale copy if we have
      // one so the avatar doesn't disappear; cache it for the session so we
      // don't retry on every render.
      if (staleDataUri !== null) this.remember(key, staleDataUri);
      return staleDataUri;
    }

    const mime = res.contentType || 'image/png';
    const dataUri = `data:${mime};base64,${res.data.toString('base64')}`;
    this.remember(key, dataUri);

    if (diskFile && this.cacheDir) {
      try {
        await fs.mkdir(this.cacheDir, { recursive: true });
        await fs.writeFile(diskFile, dataUri, 'utf8');
        await this.pruneDisk();
      } catch {
        // best-effort disk cache; ignore write failures
      }
    }

    return dataUri;
  }

  /** Evicts the least-recently-used (by mtime) files once the directory exceeds
   *  the cap, so the on-disk cache stays bounded. Best-effort and tolerant of
   *  concurrent writers. */
  private async pruneDisk(): Promise<void> {
    if (!this.cacheDir) return;
    const dir = this.cacheDir;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    if (names.length <= this.maxDiskEntries) return;

    const stats = await Promise.all(
      names.map(async (name) => {
        try {
          const s = await fs.stat(path.join(dir, name));
          return { name, mtime: s.mtimeMs };
        } catch {
          return null;
        }
      }),
    );
    const sortable = stats.filter((s): s is { name: string; mtime: number } => s !== null);
    sortable.sort((a, b) => a.mtime - b.mtime); // oldest first

    const toRemove = sortable.slice(0, sortable.length - this.maxDiskEntries);
    await Promise.all(
      toRemove.map((s) => fs.rm(path.join(dir, s.name), { force: true }).catch(() => { /* best-effort */ })),
    );
  }

  private remember(key: string, dataUri: string): void {
    this.memory.set(key, dataUri);
    if (this.memory.size > MAX_MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
  }
}

/** Default fetcher backed by Node's https. Resolves to null on any error,
 *  non-200 status, timeout, or oversized response. */
const defaultFetcher: AvatarFetcher = (url) =>
  new Promise((resolve) => {
    let settled = false;
    const done = (value: { data: Buffer; contentType: string } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        done(null);
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_AVATAR_BYTES) {
          req.destroy();
          done(null);
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        done({
          data: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || 'image/png',
        });
      });
      res.on('error', () => done(null));
    });

    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy();
      done(null);
    });
    req.on('error', () => done(null));
  });
