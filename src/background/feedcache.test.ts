import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasCachedTrackers,
  putCachedTrackers,
  readCachedTrackers,
} from './feedcache';

function installCachesMock(store: Map<string, Response>) {
  const cache = {
    put: vi.fn(async (key: string, res: Response) => {
      store.set(key, res);
    }),
    match: vi.fn(async (key: string) => store.get(key)),
  };
  vi.stubGlobal('caches', {
    open: vi.fn(async () => cache),
  });
  return cache;
}

describe('feedcache', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a feed response through the cache', async () => {
    const store = new Map<string, Response>();
    installCachesMock(store);
    const db = { 'tracker.example': { company: 'X', category: 'tracking' } };
    await putCachedTrackers(new Response(JSON.stringify(db)));
    expect(await hasCachedTrackers()).toBe(true);
    expect(await readCachedTrackers()).toEqual(db);
  });

  it('returns null when nothing is cached', async () => {
    installCachesMock(new Map());
    expect(await hasCachedTrackers()).toBe(false);
    expect(await readCachedTrackers()).toBeNull();
  });

  it('returns null for an empty or unparsable cached body', async () => {
    const store = new Map<string, Response>();
    installCachesMock(store);
    await putCachedTrackers(new Response('{}'));
    expect(await readCachedTrackers()).toBeNull();
    await putCachedTrackers(new Response('not json'));
    expect(await readCachedTrackers()).toBeNull();
  });

  it('survives a missing Cache API', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await hasCachedTrackers()).toBe(false);
    expect(await readCachedTrackers()).toBeNull();
  });
});
