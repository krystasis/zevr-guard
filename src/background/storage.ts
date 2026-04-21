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

export async function getTodayStats(): Promise<TodayStats> {
  const s = await chrome.storage.local.get('todayStats');
  const existing = s.todayStats as Partial<TodayStats> | undefined;
  const today = new Date().toISOString().slice(0, 10);
  if (!existing || existing.date !== today) {
    const fresh = getDefaultTodayStats();
    await chrome.storage.local.set({ todayStats: fresh });
    return fresh;
  }
  return {
    ...getDefaultTodayStats(),
    ...existing,
    companyCounts: existing.companyCounts ?? {},
    trackerDomains: existing.trackerDomains ?? {},
    blockedDomains: existing.blockedDomains ?? {},
  } as TodayStats;
}

export async function setTodayStats(stats: TodayStats): Promise<void> {
  await chrome.storage.local.set({ todayStats: stats });
}

export async function getCachedUserLocation(): Promise<UserLocation | null> {
  const s = await chrome.storage.local.get('userLocation');
  return (s.userLocation as UserLocation | null | undefined) ?? null;
}

export async function setCachedUserLocation(loc: UserLocation): Promise<void> {
  await chrome.storage.local.set({ userLocation: loc });
}
