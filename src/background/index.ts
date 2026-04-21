import './buffer-polyfill';
import type { Connection, MessageRequest, PageStats, UserLocation } from '../types';
import {
  calcRiskScore,
  getRiskLevel,
  lookupTracker,
  scoreToRiskLevel,
} from './risk';
import { initFeed, refreshFeed } from './feed';
import { syncCategoryRulesets } from './rulesets';
import { getGeoData } from './geo';
import {
  getPages,
  setPages,
  getSettings,
  setSettings,
  getTodayStats,
  setTodayStats,
  getCachedUserLocation,
  setCachedUserLocation,
} from './storage';
import {
  clearBadge,
  flashBlockedBadge,
  flashDangerBadge,
  updateBadge,
} from './badge';
import {
  allowDomain,
  blockDomain,
  disallowDomain,
  getBlockedDomains,
  unblockDomain,
} from './blocking';

const pageLocks = new Map<number, Promise<void>>();

async function updatePage(
  tabId: number,
  mutator: (page: PageStats | undefined, pages: Record<number, PageStats>) => PageStats | null,
): Promise<PageStats | null> {
  const prev = pageLocks.get(tabId) ?? Promise.resolve();
  let resolveLock!: () => void;
  const next = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  pageLocks.set(tabId, prev.then(() => next));

  try {
    await prev;
    const pages = await getPages();
    const result = mutator(pages[tabId], pages);
    if (result === null) {
      delete pages[tabId];
    } else {
      pages[tabId] = result;
    }
    await setPages(pages);
    return result;
  } finally {
    resolveLock();
    if (pageLocks.get(tabId) === next) pageLocks.delete(tabId);
  }
}

async function handleRequest(details: chrome.webRequest.WebResponseCacheDetails): Promise<void> {
  if (details.tabId < 0) return;

  let requestUrl: URL;
  try {
    requestUrl = new URL(details.url);
  } catch {
    return;
  }
  const domain = requestUrl.hostname;
  if (!domain || requestUrl.protocol === 'chrome-extension:') return;

  const tab = await chrome.tabs.get(details.tabId).catch(() => null);
  if (!tab?.url) return;

  let tabUrl: URL;
  try {
    tabUrl = new URL(tab.url);
  } catch {
    return;
  }
  if (!/^https?:$/.test(tabUrl.protocol)) return;
  if (domain === tabUrl.hostname) return;

  const tracker = lookupTracker(domain);
  const riskLevel = getRiskLevel(domain);
  const geo = details.ip ? await getGeoData(details.ip) : null;
  const blockedDomains = await getBlockedDomains();
  const isBlocked = blockedDomains.has(domain);

  const page = await updatePage(details.tabId, (existing) => {
    const base: PageStats = existing ?? {
      tabId: details.tabId,
      url: tab.url ?? '',
      host: tabUrl.hostname,
      connections: {},
      totalCount: 0,
      blockedCount: 0,
      riskScore: 0,
      riskLevel: 'safe',
      lastUpdated: Date.now(),
    };

    const current = base.connections[domain];
    const connection: Connection = current
      ? {
          ...current,
          count: current.count + 1,
          lastSeen: Date.now(),
          country: current.country ?? geo?.countryCode ?? null,
          countryName: current.countryName ?? geo?.country ?? null,
          flag: current.flag ?? geo?.flag ?? null,
          lat: current.lat ?? geo?.lat ?? null,
          lon: current.lon ?? geo?.lon ?? null,
          org: current.org ?? geo?.org ?? null,
          isp: current.isp ?? geo?.isp ?? null,
          asn: current.asn ?? geo?.asn ?? null,
          isBlocked,
        }
      : {
          domain,
          company: tracker?.company ?? null,
          category: tracker?.category ?? null,
          country: geo?.countryCode ?? null,
          countryName: geo?.country ?? null,
          flag: geo?.flag ?? null,
          lat: geo?.lat ?? null,
          lon: geo?.lon ?? null,
          org: geo?.org ?? null,
          isp: geo?.isp ?? null,
          asn: geo?.asn ?? null,
          count: 1,
          riskLevel,
          isBlocked,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
        };

    base.connections[domain] = connection;
    base.totalCount += 1;
    base.riskScore = calcRiskScore(base.connections);
    base.riskLevel = scoreToRiskLevel(base.riskScore);
    base.lastUpdated = Date.now();
    return base;
  });

  if (page) updateBadge(details.tabId, page.riskLevel, page.riskScore);

  await updateTodayStats(domain, tracker, riskLevel, geo);

  if (riskLevel === 'dangerous') {
    flashDangerBadge(details.tabId);
    const settings = await getSettings();
    if (settings.notificationsEnabled) {
      chrome.notifications.create(`danger-${domain}-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('public/icons/icon48.png'),
        title: '⚠️ Dangerous Connection Detected',
        message: `${domain} is a known malware/phishing domain.`,
        priority: 2,
      });
    }
  }
}

async function updateTodayStats(
  domain: string,
  tracker: ReturnType<typeof lookupTracker>,
  riskLevel: ReturnType<typeof getRiskLevel>,
  geo: Awaited<ReturnType<typeof getGeoData>>,
): Promise<void> {
  const today = await getTodayStats();
  today.totalConnections += 1;
  if (riskLevel === 'dangerous') today.dangerousDetected += 1;
  if (riskLevel === 'tracker' || riskLevel === 'suspicious') {
    today.trackersDetected += 1;
    const existing = today.trackerDomains[domain];
    if (existing) {
      existing.count += 1;
      if (!existing.country && geo?.countryCode) {
        existing.country = geo.countryCode;
        existing.countryName = geo.country;
      }
    } else {
      today.trackerDomains[domain] = {
        count: 1,
        company: tracker?.company ?? null,
        category: tracker?.category ?? null,
        country: geo?.countryCode ?? null,
        countryName: geo?.country ?? null,
        riskLevel,
      };
    }
  }
  if (tracker?.company) {
    if (!today.companiesDetected.includes(tracker.company)) {
      today.companiesDetected.push(tracker.company);
    }
    today.companyCounts[tracker.company] =
      (today.companyCounts[tracker.company] ?? 0) + 1;
  }
  await setTodayStats(today);
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    void handleRequest(details);
  },
  { urls: ['<all_urls>'] },
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.error === 'net::ERR_BLOCKED_BY_CLIENT' && details.tabId >= 0) {
      let domain: string | null = null;
      try {
        domain = new URL(details.url).hostname;
      } catch {
        // ignore
      }
      void incrementBlocked(details.tabId, domain);
    }
  },
  { urls: ['<all_urls>'] },
);

let userLocationCache: UserLocation | null = null;
let userLocationPromise: Promise<UserLocation | null> | null = null;

async function getUserLocation(): Promise<UserLocation | null> {
  if (userLocationCache) return userLocationCache;
  if (userLocationPromise) return userLocationPromise;

  const stored = await getCachedUserLocation();
  if (stored) {
    userLocationCache = stored;
    return stored;
  }

  userLocationPromise = (async () => {
    try {
      const res = await fetch('https://api.ipify.org?format=json', {
        signal: AbortSignal.timeout(4000),
      });
      const j = (await res.json()) as { ip?: string };
      if (!j.ip) return null;
      const geo = await getGeoData(j.ip);
      if (!geo) return null;
      const loc: UserLocation = {
        lat: geo.lat,
        lng: geo.lon,
        countryCode: geo.countryCode,
        countryName: geo.country,
      };
      userLocationCache = loc;
      await setCachedUserLocation(loc);
      return loc;
    } catch {
      return null;
    } finally {
      userLocationPromise = null;
    }
  })();

  return userLocationPromise;
}

async function incrementBlocked(tabId: number, domain: string | null): Promise<void> {
  const page = await updatePage(tabId, (existing) => {
    if (!existing) return existing ?? null;
    existing.blockedCount += 1;
    existing.lastUpdated = Date.now();
    return existing;
  });

  const today = await getTodayStats();
  today.blockedConnections += 1;
  if (domain) {
    today.blockedDomains[domain] = (today.blockedDomains[domain] ?? 0) + 1;
  }
  await setTodayStats(today);

  if (page) {
    flashBlockedBadge(tabId, () => updateBadge(tabId, page.riskLevel, page.riskScore));
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const pages = await getPages();
  const page = pages[tabId];
  if (page) updateBadge(tabId, page.riskLevel, page.riskScore);
  else clearBadge(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    await updatePage(tabId, () => null);
    clearBadge(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await updatePage(tabId, () => null);
});

async function syncFromStoredSettings(): Promise<void> {
  try {
    const settings = await getSettings();
    await syncCategoryRulesets(settings);
  } catch (err) {
    console.warn(
      '[Zevr Guard] syncCategoryRulesets on boot failed:',
      (err as Error).message,
    );
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/index.html') });
    void refreshFeed(true);
  } else if (details.reason === 'update') {
    void refreshFeed();
  }
  void syncFromStoredSettings();
});

chrome.runtime.onStartup.addListener(() => {
  void initFeed();
  void syncFromStoredSettings();
});

void initFeed();
void syncFromStoredSettings();

chrome.runtime.onMessage.addListener(
  (message: MessageRequest, _sender, sendResponse) => {
    (async () => {
      switch (message.type) {
        case 'BLOCK_DOMAIN':
          await blockDomain(message.domain);
          sendResponse({ success: true });
          break;
        case 'UNBLOCK_DOMAIN':
          await unblockDomain(message.domain);
          sendResponse({ success: true });
          break;
        case 'ALLOW_DOMAIN':
          await allowDomain(message.domain);
          sendResponse({ success: true });
          break;
        case 'DISALLOW_DOMAIN':
          await disallowDomain(message.domain);
          sendResponse({ success: true });
          break;
        case 'GET_SETTINGS':
          sendResponse({ settings: await getSettings() });
          break;
        case 'UPDATE_SETTINGS':
          await setSettings(message.settings);
          await syncCategoryRulesets(message.settings);
          sendResponse({ success: true });
          break;
        case 'GET_PAGE_STATS': {
          const pages = await getPages();
          const page = pages[message.tabId] ?? null;
          if (page) {
            const blocked = await getBlockedDomains();
            for (const domain of Object.keys(page.connections)) {
              page.connections[domain].isBlocked = blocked.has(domain);
            }
          }
          sendResponse({ stats: page });
          break;
        }
        case 'GET_TODAY_STATS':
          sendResponse({ today: await getTodayStats() });
          break;
        case 'GET_USER_LOCATION':
          sendResponse({ location: await getUserLocation() });
          break;
        default:
          sendResponse({ error: 'unknown message' });
      }
    })().catch((err) => sendResponse({ error: (err as Error).message }));
    return true;
  },
);
