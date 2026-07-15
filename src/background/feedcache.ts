import type { TrackerDB } from '../types';

// The tracker feed is ~8MB. Persisting it through chrome.storage.local
// structured-clones the whole 118k-entry object graph on the worker
// thread: measured at ~13s per daily refresh (set) and ~1.4s on every
// cold start (get), while pinning ~80% of the 10MB storage quota. The
// Cache API stores the raw HTTP response instead — writes stream the
// body without touching the JS heap, and parsing happens lazily on the
// first lookup that actually needs the DB.
const CACHE_NAME = 'zg-feed';
const TRACKERS_URL = 'https://zevrhq.com/feed/v1/trackers.json';

export async function putCachedTrackers(res: Response): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(TRACKERS_URL, res);
}

export async function hasCachedTrackers(): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(TRACKERS_URL)) !== undefined;
  } catch {
    return false;
  }
}

export async function readCachedTrackers(): Promise<TrackerDB | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(TRACKERS_URL);
    if (!res) return null;
    const db = (await res.json()) as TrackerDB;
    return db && Object.keys(db).length > 0 ? db : null;
  } catch {
    return null;
  }
}
