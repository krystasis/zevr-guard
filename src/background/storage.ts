import type { PageStats, Settings, TodayStats, UserLocation } from '../types';

export function getDefaultSettings(): Settings {
  return {
    blockingEnabled: false,
    notificationsEnabled: true,
    blockCategories: {
      advertising: false,
      tracking: false,
      malware: true,
      custom: true,
    },
    customBlockList: [],
    customWhiteList: [],
  };
}

export function getDefaultTodayStats(): TodayStats {
  return {
    date: new Date().toISOString().slice(0, 10),
    totalConnections: 0,
    blockedConnections: 0,
    trackersDetected: 0,
    dangerousDetected: 0,
    companiesDetected: [],
    companyCounts: {},
    trackerDomains: {},
    blockedDomains: {},
  };
}

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get('settings');
  return (s.settings as Settings | undefined) ?? getDefaultSettings();
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

export async function getPages(): Promise<Record<number, PageStats>> {
  const s = await chrome.storage.local.get('pages');
  return (s.pages as Record<number, PageStats> | undefined) ?? {};
}

export async function setPages(pages: Record<number, PageStats>): Promise<void> {
  await chrome.storage.local.set({ pages });
}

// ---------------------------------------------------------------------------
// Write-behind caches. Busy pages produce dozens of requests per second and
// each used to trigger a full read + write of `pages` / `todayStats`. Keep
// the working copy in memory and flush at most every FLUSH_MS.
// ---------------------------------------------------------------------------

const FLUSH_MS = 500;

let pagesCache: Record<number, PageStats> | null = null;
let pagesDirty = false;
let todayCache: TodayStats | null = null;
let todayDirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  if (pagesDirty && pagesCache) {
    pagesDirty = false;
    await setPages(pagesCache);
  }
  if (todayDirty && todayCache) {
    todayDirty = false;
    await setTodayStats(todayCache);
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_MS);
}

export async function getPagesCached(): Promise<Record<number, PageStats>> {
  if (!pagesCache) pagesCache = await getPages();
  return pagesCache;
}

export function markPagesDirty(): void {
  pagesDirty = true;
  scheduleFlush();
}

export async function getTodayStats(): Promise<TodayStats> {
  if (todayCache && todayCache.date === new Date().toISOString().slice(0, 10)) {
    return todayCache;
  }

  const s = await chrome.storage.local.get('todayStats');
  const existing = (todayCache ?? s.todayStats) as Partial<TodayStats> | undefined;
  const today = new Date().toISOString().slice(0, 10);
  if (!existing || existing.date !== today) {
    const fresh = getDefaultTodayStats();
    todayCache = fresh;
    await chrome.storage.local.set({ todayStats: fresh });
    return fresh;
  }
  todayCache = {
    ...getDefaultTodayStats(),
    ...existing,
    companyCounts: existing.companyCounts ?? {},
    trackerDomains: existing.trackerDomains ?? {},
    blockedDomains: existing.blockedDomains ?? {},
  } as TodayStats;
  return todayCache;
}

export function markTodayDirty(): void {
  todayDirty = true;
  scheduleFlush();
}

export async function setTodayStats(stats: TodayStats): Promise<void> {
  todayCache = stats;
  await chrome.storage.local.set({ todayStats: stats });
}

// Best-effort flush when the service worker is about to be torn down.
try {
  chrome.runtime.onSuspend?.addListener(() => {
    void flush();
  });
} catch {
  // ignore
}

export async function getCachedUserLocation(): Promise<UserLocation | null> {
  const s = await chrome.storage.local.get('userLocation');
  return (s.userLocation as UserLocation | null | undefined) ?? null;
}

export async function setCachedUserLocation(loc: UserLocation): Promise<void> {
  await chrome.storage.local.set({ userLocation: loc });
}
