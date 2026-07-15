import type { TrackerDB } from '../types';
import { setMalwareOverride, setTrackerOverride } from './risk';
import { syncMalwareSessionRules } from './blocking';
import { hasCachedTrackers, putCachedTrackers } from './feedcache';

const FEED_BASE = 'https://zevrhq.com/feed/v1';
const ALARM_NAME = 'zg-feed-update';
const PERIOD_MINUTES = 24 * 60;
const STALE_MS = 25 * 60 * 60 * 1000;

// Legacy key: the tracker feed used to be persisted here. Kept only so
// initFeed can evict the ~8MB blob from profiles that stored it.
const STORAGE_TRACKERS = 'zg.feed.trackers';
const STORAGE_MALWARE = 'zg.feed.malware';
const STORAGE_META = 'zg.feed.meta';

interface FeedChannelMeta {
  etag?: string;
  updatedAt: number;
}
interface FeedMeta {
  trackers?: FeedChannelMeta;
  malware?: FeedChannelMeta;
}

async function getMeta(): Promise<FeedMeta> {
  try {
    const r = await chrome.storage.local.get(STORAGE_META);
    return (r[STORAGE_META] as FeedMeta) ?? {};
  } catch {
    return {};
  }
}

async function setMeta(meta: FeedMeta): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_META]: meta });
  } catch {
    // ignore
  }
}

async function fetchChannel<T>(
  url: string,
  storageKey: string,
  prevEtag: string | undefined,
): Promise<{ data: T | null; etag?: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (prevEtag) headers['If-None-Match'] = prevEtag;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
    headers,
  });
  if (res.status === 304) return { data: null, etag: prevEtag };
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const data = (await res.json()) as T;
  const etag = res.headers.get('etag') ?? undefined;
  try {
    await chrome.storage.local.set({ [storageKey]: data });
  } catch (err) {
    console.warn('[zg-feed] storage.set failed:', (err as Error).message);
  }
  return { data, etag };
}

// The trackers channel is ~8MB, far too large for chrome.storage.local
// (structured-cloning it blocked the worker for seconds and consumed most
// of the quota). Persist the raw response through the Cache API instead;
// risk.ts parses it lazily on the first lookup after a cold start.
async function fetchTrackers(
  prevEtag: string | undefined,
): Promise<{ etag?: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (prevEtag) headers['If-None-Match'] = prevEtag;
  const res = await fetch(`${FEED_BASE}/trackers.json`, {
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
    headers,
  });
  if (res.status === 304) return { etag: prevEtag };
  if (!res.ok) throw new Error(`${FEED_BASE}/trackers.json -> ${res.status}`);
  const etag = res.headers.get('etag') ?? undefined;
  const forCache = res.clone();
  const data = (await res.json()) as TrackerDB;
  if (Object.keys(data).length === 0) return { etag: prevEtag };
  setTrackerOverride(data);
  try {
    await putCachedTrackers(forCache);
  } catch (err) {
    console.warn('[zg-feed] trackers cache.put failed:', (err as Error).message);
  }
  return { etag };
}

export async function refreshFeed(force = false): Promise<void> {
  const meta = await getMeta();
  const results = await Promise.allSettled([
    fetchTrackers(force ? undefined : meta.trackers?.etag),
    fetchChannel<string[]>(
      `${FEED_BASE}/malware.json`,
      STORAGE_MALWARE,
      force ? undefined : meta.malware?.etag,
    ),
  ]);

  const now = Date.now();
  const nextMeta: FeedMeta = { ...meta };

  if (results[0].status === 'fulfilled') {
    const r = results[0].value;
    nextMeta.trackers = { etag: r.etag ?? meta.trackers?.etag, updatedAt: now };
  } else {
    console.warn('[zg-feed] trackers refresh failed:', results[0].reason);
  }

  if (results[1].status === 'fulfilled') {
    const r = results[1].value;
    if (r.data) setMalwareOverride(r.data);
    nextMeta.malware = { etag: r.etag ?? meta.malware?.etag, updatedAt: now };
  } else {
    console.warn('[zg-feed] malware refresh failed:', results[1].reason);
  }

  await setMeta(nextMeta);

  try {
    await syncMalwareSessionRules();
  } catch (err) {
    console.warn('[zg-feed] session rule sync failed:', (err as Error).message);
  }
}

export async function initFeed(): Promise<void> {
  try {
    // The tracker feed lives in the Cache API and is parsed lazily by
    // risk.ts, so cold start no longer touches the 8MB blob here.
    const stored = await chrome.storage.local.get(STORAGE_MALWARE);
    const malware = stored[STORAGE_MALWARE] as string[] | undefined;
    if (malware) setMalwareOverride(malware);
  } catch {
    // ignore — bundled data remains active
  }

  // Evict the legacy 8MB trackers blob from profiles that predate the
  // Cache API storage; it pinned ~80% of the chrome.storage.local quota.
  try {
    void chrome.storage.local.remove(STORAGE_TRACKERS);
  } catch {
    // ignore
  }

  // Session rules vanish on browser restart; re-apply from whichever malware
  // set is now active (stored feed or bundled fallback).
  try {
    await syncMalwareSessionRules();
  } catch (err) {
    console.warn('[zg-feed] session rule sync failed:', (err as Error).message);
  }

  try {
    const existing = await chrome.alarms.get(ALARM_NAME);
    if (!existing) {
      await chrome.alarms.create(ALARM_NAME, { periodInMinutes: PERIOD_MINUTES });
    }
  } catch {
    // ignore
  }

  const meta = await getMeta();
  const lastUpdated = meta.trackers?.updatedAt ?? 0;
  if (Date.now() - lastUpdated > STALE_MS) {
    void refreshFeed();
  } else if (!(await hasCachedTrackers())) {
    // Fresh meta but no cached feed (first start after migrating off
    // chrome.storage persistence, or an earlier cache.put failure).
    // Force so a 304 against the stored ETag cannot skip repopulating.
    void refreshFeed(true);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshFeed();
});
