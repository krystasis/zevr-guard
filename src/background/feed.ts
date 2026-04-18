import type { TrackerDB } from '../types';
import { setMalwareOverride, setTrackerOverride } from './risk';

const FEED_BASE = 'https://zevrhq.com/feed/v1';
const ALARM_NAME = 'zg-feed-update';
const PERIOD_MINUTES = 24 * 60;
const STALE_MS = 25 * 60 * 60 * 1000;

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

export async function refreshFeed(force = false): Promise<void> {
  const meta = await getMeta();
  const results = await Promise.allSettled([
    fetchChannel<TrackerDB>(
      `${FEED_BASE}/trackers.json`,
      STORAGE_TRACKERS,
      force ? undefined : meta.trackers?.etag,
    ),
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
    if (r.data) setTrackerOverride(r.data);
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
}

export async function initFeed(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([STORAGE_TRACKERS, STORAGE_MALWARE]);
    const trackers = stored[STORAGE_TRACKERS] as TrackerDB | undefined;
    const malware = stored[STORAGE_MALWARE] as string[] | undefined;
    if (trackers) setTrackerOverride(trackers);
    if (malware) setMalwareOverride(malware);
  } catch {
    // ignore — bundled data remains active
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
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshFeed();
});
