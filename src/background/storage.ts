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
const HISTORY_DAYS = 30;

let pagesCache: Record<number, PageStats> | null = null;
let pagesDirty = false;
let todayCache: TodayStats | null = null;
let todayDirty = false;
let lifetimeCache: { blocked: number } | null = null;
let lifetimeDirty = false;
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
  if (lifetimeDirty && lifetimeCache) {
    lifetimeDirty = false;
    await chrome.storage.local.set({ 'zg.lifetime': lifetimeCache });
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

export async function setTodayStats(stats: TodayStats): Promise<void> {
  todayCache = stats;
  await chrome.storage.local.set({ todayStats: stats });
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
