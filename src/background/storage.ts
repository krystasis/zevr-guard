import type {
  LeakEvent,
  PageStats,
  Settings,
  TodayStats,
  UserLocation,
  WatchItem,
} from '../types';

export function getDefaultSettings(): Settings {
  return {
    notificationsEnabled: true,
    blockCategories: {
      advertising: false,
      tracking: false,
      malware: true,
      custom: true,
    },
    customBlockList: [],
    customWhiteList: [],
    pausedSites: [],
    passwordWarningsEnabled: true,
    blockedCountries: [],
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
  const stored = s.settings as Partial<Settings> | undefined;
  const def = getDefaultSettings();
  if (!stored) return def;
  // Merge so settings stored by older versions gain newly added fields.
  return {
    ...def,
    ...stored,
    blockCategories: { ...def.blockCategories, ...stored.blockCategories },
    customBlockList: stored.customBlockList ?? [],
    customWhiteList: stored.customWhiteList ?? [],
    pausedSites: stored.pausedSites ?? [],
    passwordWarningsEnabled: stored.passwordWarningsEnabled ?? true,
    blockedCountries: stored.blockedCountries ?? [],
  };
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
// A write that failed (quota, mostly) will not start succeeding 500ms later,
// so back the retry off instead of spinning on it twice a second.
const RETRY_MS = 30_000;
const HISTORY_DAYS = 30;

// Per-day caps for the maps that grow one entry per distinct domain / company
// seen. Thirty days of these live in `statsHistory` and chrome.storage.local
// is capped at 10MB (no `unlimitedStorage`), so an uncapped heavy day can take
// the whole key over quota and stop every stats write. The busiest entries are
// what the popup and the weekly report show, so those are the ones kept.
export const MAX_TRACKER_DOMAINS = 500;
export const MAX_BLOCKED_DOMAINS = 500;
export const MAX_COMPANIES = 300;

let pagesCache: Record<number, PageStats> | null = null;
let pagesDirty = false;
let todayCache: TodayStats | null = null;
let todayDirty = false;
let lifetimeCache: { blocked: number } | null = null;
let lifetimeDirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Every write stands alone: chrome.storage.local rejects once the quota is
// reached, and a failure must not throw away the in-memory copy it was about
// to persist, skip the writes after it, or escape as an unhandled rejection
// (the callers are `void flush()`). So each block re-arms its dirty flag and a
// retry is scheduled instead.
async function flush(): Promise<void> {
  let failed = false;
  if (pagesDirty && pagesCache) {
    pagesDirty = false;
    try {
      await setPages(pagesCache);
    } catch {
      pagesDirty = true;
      failed = true;
    }
  }
  if (todayDirty && todayCache) {
    todayDirty = false;
    try {
      await setTodayStats(todayCache);
    } catch {
      todayDirty = true;
      failed = true;
    }
  }
  if (lifetimeDirty && lifetimeCache) {
    lifetimeDirty = false;
    try {
      await chrome.storage.local.set({ 'zg.lifetime': lifetimeCache });
    } catch {
      lifetimeDirty = true;
      failed = true;
    }
  }
  if (failed) scheduleFlush(RETRY_MS);
}

function scheduleFlush(delayMs = FLUSH_MS): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delayMs);
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
    if (existing?.date && (existing.totalConnections ?? 0) > 0) {
      await archiveDay(existing as TodayStats);
    }
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

/** Keep the `max` busiest entries of a counted map, dropping the rest. */
function capByCount<T>(
  map: Record<string, T>,
  max: number,
  countOf: (value: T) => number,
): Record<string, T> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  keys.sort((a, b) => countOf(map[b]) - countOf(map[a]));
  const kept: Record<string, T> = {};
  for (const key of keys.slice(0, max)) kept[key] = map[key];
  return kept;
}

/**
 * Bound a day's per-domain maps, in place so the in-memory copy shrinks with
 * the stored one. Nothing below the cap is touched.
 */
export function capTodayStats(stats: TodayStats): TodayStats {
  stats.trackerDomains = capByCount(
    stats.trackerDomains,
    MAX_TRACKER_DOMAINS,
    (info) => info.count,
  );
  stats.blockedDomains = capByCount(
    stats.blockedDomains,
    MAX_BLOCKED_DOMAINS,
    (count) => count,
  );
  const companyCounts = capByCount(
    stats.companyCounts,
    MAX_COMPANIES,
    (count) => count,
  );
  if (companyCounts !== stats.companyCounts) {
    stats.companyCounts = companyCounts;
    // The list and the counts name the same companies; keep them in step.
    stats.companiesDetected = stats.companiesDetected.filter(
      (company) => company in companyCounts,
    );
  }
  return stats;
}

export async function setTodayStats(stats: TodayStats): Promise<void> {
  todayCache = stats;
  await chrome.storage.local.set({ todayStats: capTodayStats(stats) });
}

/** Roll a finished day into the bounded history used by the weekly report. */
async function archiveDay(day: TodayStats): Promise<void> {
  try {
    const s = await chrome.storage.local.get('statsHistory');
    const history = (s.statsHistory as TodayStats[] | undefined) ?? [];
    const withoutDupe = history.filter((d) => d.date !== day.date);
    withoutDupe.push(day);
    withoutDupe.sort((a, b) => a.date.localeCompare(b.date));
    await chrome.storage.local.set({
      statsHistory: withoutDupe.slice(-HISTORY_DAYS),
    });
  } catch {
    // history is best-effort
  }
}

/** Lifetime blocked counter, used for the review-prompt milestones. */
export async function incrementLifetimeBlocked(): Promise<number> {
  if (!lifetimeCache) {
    const s = await chrome.storage.local.get('zg.lifetime');
    lifetimeCache = (s['zg.lifetime'] as { blocked: number } | undefined) ?? {
      blocked: 0,
    };
  }
  lifetimeCache.blocked += 1;
  lifetimeDirty = true;
  scheduleFlush();
  return lifetimeCache.blocked;
}

export async function getStatsHistory(): Promise<TodayStats[]> {
  const s = await chrome.storage.local.get('statsHistory');
  return (s.statsHistory as TodayStats[] | undefined) ?? [];
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

// --- Data-exfiltration watch ---------------------------------------------

const WATCH_KEY = 'zg.watch';
const LEAKS_KEY = 'zg.leaks';
const MAX_LEAKS = 100;

export async function getWatchList(): Promise<WatchItem[]> {
  try {
    const s = await chrome.storage.local.get(WATCH_KEY);
    const list = s[WATCH_KEY];
    return Array.isArray(list) ? (list as WatchItem[]) : [];
  } catch {
    return [];
  }
}

export async function setWatchList(items: WatchItem[]): Promise<void> {
  await chrome.storage.local.set({ [WATCH_KEY]: items });
}

export async function getLeakEvents(): Promise<LeakEvent[]> {
  try {
    const s = await chrome.storage.local.get(LEAKS_KEY);
    const list = s[LEAKS_KEY];
    return Array.isArray(list) ? (list as LeakEvent[]) : [];
  } catch {
    return [];
  }
}

// Serialize writes: two leaks firing at once would otherwise read the same
// array and clobber each other (last write wins), silently dropping an event.
let leakWrite: Promise<void> = Promise.resolve();

export async function addLeakEvent(event: LeakEvent): Promise<void> {
  leakWrite = leakWrite
    .then(async () => {
      const events = await getLeakEvents();
      events.unshift(event);
      await chrome.storage.local.set({ [LEAKS_KEY]: events.slice(0, MAX_LEAKS) });
    })
    .catch(() => {
      // keep the chain alive even if one write fails
    });
  return leakWrite;
}

export async function clearLeakEvents(): Promise<void> {
  await chrome.storage.local.set({ [LEAKS_KEY]: [] });
}
