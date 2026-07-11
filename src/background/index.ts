import './buffer-polyfill';
import type { Connection, MessageRequest, PageStats, UserLocation } from '../types';
import {
  calcRiskScore,
  ensureTrackerDB,
  getRiskLevel,
  isMalware,
  lookupTracker,
  scoreToRiskLevel,
} from './risk';
import { initFeed, refreshFeed } from './feed';
import { t, getLocale, loadLocale, subscribeLocale } from '../shared/i18n';
import { syncCategoryRulesets } from './rulesets';
import { getGeoData } from './geo';
import {
  getPagesCached,
  markPagesDirty,
  getSettings,
  setSettings,
  getTodayStats,
  markTodayDirty,
  getStatsHistory,
  incrementLifetimeBlocked,
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
  matchesDomainOrParent,
  pauseSite,
  resumeSite,
  syncMalwareSessionRules,
  unblockDomain,
} from './blocking';
import {
  addLookalikeBypass,
  checkNavigation,
  isLookalikeBypassed,
} from './lookalike';
import { isFreshVisit, markInstalled, recordVisit } from './visits';
import {
  blockCountry,
  getCountryRuleStats,
  isCountryBlockedDomain,
  noteConnection,
  syncCountryBlocking,
  unblockCountry,
} from './country';
import { initWeeklyReport } from './weekly';

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
    const pages = await getPagesCached();
    const result = mutator(pages[tabId], pages);
    if (result === null) {
      delete pages[tabId];
    } else {
      pages[tabId] = result;
    }
    markPagesDirty();
    return result;
  } finally {
    resolveLock();
    if (pageLocks.get(tabId) === next) pageLocks.delete(tabId);
  }
}

type RequestOutcome = 'completed' | 'blocked' | 'failed';

interface RequestEvent {
  tabId: number;
  url: string;
  ip?: string;
  timeStamp?: number;
  initiator?: string;
}

// Navigation start per tab, used to drop events that were emitted for the
// previous document but processed (async) after the tab moved on.
const navStartTimes = new Map<number, number>();

async function resetPage(tabId: number): Promise<void> {
  navStartTimes.set(tabId, Date.now());
  await updatePage(tabId, () => null);
  clearBadge(tabId);
}

/**
 * Requests without a tab (site service workers, shared workers) used to be
 * dropped entirely. They cannot be attributed to a page, but they are real
 * traffic — count them into the daily stats keyed by their initiator.
 */
async function handleBackgroundRequest(
  details: RequestEvent,
  outcome: RequestOutcome,
): Promise<void> {
  if (outcome === 'failed') return;
  if (!details.initiator || !/^https?:/.test(details.initiator)) return;

  let domain: string;
  let initiatorHost: string;
  try {
    domain = new URL(details.url).hostname;
    initiatorHost = new URL(details.initiator).hostname;
  } catch {
    return;
  }
  if (!domain || domain === initiatorHost) return;

  await feedReady;
  await ensureTrackerDB();

  const tracker = lookupTracker(domain);
  const riskLevel = getRiskLevel(domain);
  const geo = details.ip ? await getGeoData(details.ip) : null;
  void noteConnection(domain, geo?.countryCode);
  const blockedByUs =
    outcome === 'blocked' && (await isBlockAttributedToUs(domain, tracker));
  await updateTodayStats(domain, tracker, riskLevel, geo, blockedByUs);
}

/**
 * A block surfaced via net::ERR_BLOCKED_BY_CLIENT can come from any
 * extension. Only claim it in the daily stats when one of our own rule
 * sources covers the domain (category rulesets are approximated by a
 * tracker-DB hit, which is what they are built from).
 */
async function isBlockAttributedToUs(
  domain: string,
  tracker: ReturnType<typeof lookupTracker>,
): Promise<boolean> {
  if (isMalware(domain)) return true;
  if (await isCountryBlockedDomain(domain)) return true;
  const blocked = await getBlockedDomains();
  if (matchesDomainOrParent(domain, blocked)) return true;
  if (tracker) {
    const settings = await getSettings();
    if (settings.blockCategories.advertising || settings.blockCategories.tracking) {
      return true;
    }
  }
  return false;
}

async function handleRequest(
  details: RequestEvent,
  outcome: RequestOutcome = 'completed',
): Promise<void> {
  if (details.tabId < 0) {
    await handleBackgroundRequest(details, outcome);
    return;
  }

  const navStart = navStartTimes.get(details.tabId);
  if (navStart && details.timeStamp && details.timeStamp < navStart) return;

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

  // Give the stored feed a chance to become the active DB before falling
  // back to fetching the bundled tracker JSON.
  await feedReady;
  await ensureTrackerDB();

  const tracker = lookupTracker(domain);
  const riskLevel = getRiskLevel(domain);
  const geo = details.ip ? await getGeoData(details.ip) : null;
  void noteConnection(domain, geo?.countryCode);
  const blockedDomains = await getBlockedDomains();
  const isBlocked =
    outcome === 'blocked' || matchesDomainOrParent(domain, blockedDomains);

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
    if (outcome === 'blocked') base.blockedCount += 1;
    base.riskScore = calcRiskScore(base.connections);
    base.riskLevel = scoreToRiskLevel(base.riskScore);
    base.lastUpdated = Date.now();
    return base;
  });

  const blockedByUs =
    outcome === 'blocked' && (await isBlockAttributedToUs(domain, tracker));

  if (page) {
    if (blockedByUs) {
      flashBlockedBadge(details.tabId, () =>
        updateBadge(details.tabId, page.riskLevel, page.riskScore),
      );
    } else {
      updateBadge(details.tabId, page.riskLevel, page.riskScore);
    }
  }

  await updateTodayStats(domain, tracker, riskLevel, geo, blockedByUs);

  if (riskLevel === 'dangerous' && outcome === 'completed') {
    flashDangerBadge(details.tabId);
    const settings = await getSettings();
    if (settings.notificationsEnabled) {
      chrome.notifications.create(`danger-${domain}-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('public/icons/icon48.png'),
        title: t('dangerNotifTitle', '⚠️ Dangerous Connection Detected'),
        message: t(
          'dangerNotifMessage',
          `${domain} is a known malware/phishing domain.`,
          domain,
        ),
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
  blockedByUs: boolean,
): Promise<void> {
  const today = await getTodayStats();
  today.totalConnections += 1;
  if (blockedByUs) {
    today.blockedConnections += 1;
    today.blockedDomains[domain] = (today.blockedDomains[domain] ?? 0) + 1;
    const lifetime = await incrementLifetimeBlocked();
    void maybePromptReview(lifetime);
  }
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
  markTodayDirty();
}

// Lookalike (homoglyph / typosquat / brand-embedding) navigations cannot be
// covered by DNR rules — they need per-URL heuristics. Inspect main-frame
// requests and swap the tab to the warning page on a hit.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    try {
      void recordVisit(new URL(details.url).hostname);
    } catch {
      // unparsable URL
    }
    void checkNavigation(details.tabId, details.url);
  },
  {
    urls: ['http://*/*', 'https://*/*'],
    types: ['main_frame' as chrome.webRequest.ResourceType],
  },
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    void handleRequest(details);
  },
  { urls: ['<all_urls>'] },
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.error === 'net::ERR_BLOCKED_BY_CLIENT') {
      void handleRequest(details, 'blocked');
    } else if (details.error !== 'net::ERR_ABORTED') {
      // DNS failures, refused connections, timeouts: the attempt itself is
      // worth surfacing (e.g. beacons to a dead C2 host). ERR_ABORTED is
      // excluded — pages cancel their own requests constantly.
      void handleRequest(details, 'failed');
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

// ---------------------------------------------------------------------------
// Review prompt: once per milestone, ask happy users for a store review.
// ---------------------------------------------------------------------------

const REVIEW_MILESTONES = [1000, 10000];
const REVIEW_SHOWN_KEY = 'zg.reviewPromptShown';

async function maybePromptReview(lifetimeBlocked: number): Promise<void> {
  const milestone = REVIEW_MILESTONES.filter((m) => lifetimeBlocked >= m).pop();
  if (!milestone) return;
  try {
    const s = await chrome.storage.local.get(REVIEW_SHOWN_KEY);
    const shown = (s[REVIEW_SHOWN_KEY] as number | undefined) ?? 0;
    if (shown >= milestone) return;
    const settings = await getSettings();
    if (!settings.notificationsEnabled) return;
    await chrome.storage.local.set({ [REVIEW_SHOWN_KEY]: milestone });
    const count = milestone.toLocaleString();
    chrome.notifications.create(`zg-review-${milestone}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('public/icons/icon128.png'),
      title: t('reviewPromptTitle', `🎉 ${count} threats blocked!`, count),
      message: t(
        'reviewPromptMessage',
        'Zevr Guard has been quietly protecting you. If it helps, a quick review helps others find it too.',
      ),
      buttons: [
        { title: t('reviewPromptRate', 'Rate Zevr Guard ★') },
        { title: t('reviewPromptLater', 'Later') },
      ],
      priority: 1,
    });
  } catch {
    // notifications are best-effort
  }
}

chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
  if (id.startsWith('zg-review-') && buttonIndex === 0) {
    // Edge installs come from the Edge Add-ons store, not CWS.
    const isEdge = navigator.userAgent.includes(' Edg/');
    void chrome.tabs.create({
      url: isEdge
        ? `https://microsoftedge.microsoft.com/addons/detail/${chrome.runtime.id}`
        : `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`,
    });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const pages = await getPagesCached();
  const page = pages[tabId];
  if (page) updateBadge(tabId, page.riskLevel, page.riskScore);
  else clearBadge(tabId);
});

function stripHash(u: string): string {
  const i = u.indexOf('#');
  return i === -1 ? u : u.slice(0, i);
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (changeInfo.status === 'loading') {
    await resetPage(tabId);
    return;
  }
  // URL changed without a load: SPA route change via the history API.
  // Start a fresh page so stats reflect the current route.
  const pages = await getPagesCached();
  const prevUrl = pages[tabId]?.url;
  if (prevUrl && stripHash(prevUrl) !== stripHash(changeInfo.url)) {
    await resetPage(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  navStartTimes.delete(tabId);
  await updatePage(tabId, () => null);
});

async function syncFromStoredSettings(): Promise<void> {
  try {
    const settings = await getSettings();
    await syncCategoryRulesets(settings);
    await syncCountryBlocking(settings);
  } catch (err) {
    console.warn(
      '[Zevr Guard] syncCategoryRulesets on boot failed:',
      (err as Error).message,
    );
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void markInstalled();
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
  void initWeeklyReport();
});

// Chrome opens this page right after the extension is removed — the only
// chance to learn why someone left. The URL is static per locale and carries
// no parameters: we learn nothing about who uninstalled.
function syncUninstallUrl(): void {
  const page = getLocale() === 'ja' ? 'ja/uninstall/' : 'uninstall/';
  try {
    void chrome.runtime.setUninstallURL(`https://zevrhq.com/${page}`);
  } catch {
    // best-effort
  }
}

subscribeLocale(syncUninstallUrl);

const feedReady = initFeed().catch(() => {});
void loadLocale();
void syncFromStoredSettings();
void initWeeklyReport();

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
        case 'PAUSE_SITE':
          await pauseSite(message.host);
          sendResponse({ success: true });
          break;
        case 'RESUME_SITE':
          await resumeSite(message.host);
          sendResponse({ success: true });
          break;
        case 'BYPASS_LOOKALIKE':
          await addLookalikeBypass(message.host);
          sendResponse({ success: true });
          break;
        case 'GET_STATS_HISTORY':
          sendResponse({ history: await getStatsHistory() });
          break;
        case 'GET_SETTINGS':
          sendResponse({ settings: await getSettings() });
          break;
        case 'UPDATE_SETTINGS':
          await setSettings(message.settings);
          await syncCategoryRulesets(message.settings);
          await syncMalwareSessionRules();
          await syncCountryBlocking(message.settings);
          sendResponse({ success: true });
          break;
        case 'BLOCK_COUNTRY':
          await blockCountry(message.country);
          sendResponse({ success: true });
          break;
        case 'UNBLOCK_COUNTRY':
          await unblockCountry(message.country);
          sendResponse({ success: true });
          break;
        case 'GET_COUNTRY_STATS':
          sendResponse({ stats: await getCountryRuleStats() });
          break;
        case 'PASSWORD_CONTEXT': {
          const settings = await getSettings();
          let context: {
            level: 'danger' | 'notice';
            title: string;
            message: string;
            dismiss: string;
          } | null = null;
          if (settings.passwordWarningsEnabled) {
            const dismiss = t('pwWarnDismiss', 'Dismiss');
            if (await isLookalikeBypassed(message.host)) {
              context = {
                level: 'danger',
                title: t('pwWarnLookalikeTitle', 'You are on a suspected lookalike site'),
                message: t(
                  'pwWarnLookalikeMsg',
                  'You chose to proceed to this site earlier. A password typed here may go to an impostor.',
                ),
                dismiss,
              };
            } else if (!message.isSecure) {
              context = {
                level: 'danger',
                title: t('pwWarnHttpTitle', 'This page is not encrypted'),
                message: t(
                  'pwWarnHttpMsg',
                  'The connection is plain HTTP — a password typed here can be read in transit.',
                ),
                dismiss,
              };
            } else if (await isFreshVisit(message.host)) {
              context = {
                level: 'notice',
                title: t('pwWarnFirstTitle', 'First password on this site'),
                message: t(
                  'pwWarnFirstMsg',
                  "You've never signed in here before. Double-check the address bar first.",
                ),
                dismiss,
              };
            }
          }
          sendResponse({ context });
          break;
        }
        case 'GET_PAGE_STATS': {
          const pages = await getPagesCached();
          const page = pages[message.tabId] ?? null;
          if (page) {
            const blocked = await getBlockedDomains();
            for (const domain of Object.keys(page.connections)) {
              page.connections[domain].isBlocked =
                page.connections[domain].isBlocked ||
                matchesDomainOrParent(domain, blocked);
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
