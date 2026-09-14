import { createNotificationSafe, reviewPageUrl } from '../shared/compat';
import './buffer-polyfill';
import type {
  BlockContext,
  Connection,
  MessageRequest,
  PageStats,
  UserLocation,
} from '../types';
import {
  calcRiskScore,
  ensureTrackerDB,
  ensureMalwareMeta,
  getMalwareFeedGeneratedAt,
  getRiskLevel,
  isMalware,
  lookupMalwareMeta,
  lookupTracker,
  pageRiskLevel,
} from './risk';
import { initFeed, refreshFeed } from './feed';
import { t, getLocale, loadLocale, subscribeLocale } from '../shared/i18n';
import { syncCategoryRulesets } from './rulesets';
import { getGeoData, countryCentroid } from './geo';
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
  allowDomainForSession,
  armStaticMalwareRules,
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
import { isEstablishedSite, isFreshVisit, getVisitRecord, markInstalled, recordVisit } from './visits';
import { isSameSite, isValidHostname } from '../shared/domain';
import { resolveOwner } from './companies';
import {
  buildHaystack,
  computeEntry,
  extractBody,
  isThirdPartySend,
  maskValue,
  scan,
  type WatchEntry,
} from './exfil';
import {
  addLeakEvent,
  clearLeakEvents,
  getLeakEvents,
  getWatchList,
  setWatchList,
} from './storage';
import type { WatchItem } from '../types';
import { recallDomainGeo, rememberDomainGeo } from './domaingeo';
import {
  blockCountry,
  getCountryRuleStats,
  getBlockingCountry,
  isCountryBlockedDomain,
  noteConnection,
  syncCountryBlocking,
  unblockCountry,
} from './country';
import { initWeeklyReport } from './weekly';
import {
  getPauseState,
  isPaused,
  pauseAll,
  pauseReady,
  reconcilePause,
  resumeAll,
} from './pause';

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
  type?: string;
}

// Navigation start per tab, used to drop events that were emitted for the
// previous document but processed (async) after the tab moved on.
const navStartTimes = new Map<number, number>();

// Last http(s) main-frame URL requested per tab. A DNR redirect to the
// warning page carries only the blocked domain, so this is how "allow and
// continue" finds its way back to the page the user actually asked for.
const lastMainFrameUrl = new Map<number, string>();

/**
 * Where to send the tab after the user allows `domain`. Only ever the URL
 * this tab was actually heading to, and only when it really belongs to the
 * allowed domain — never an arbitrary URL, so the warning page cannot be
 * turned into an open redirect.
 */
function sameSiteHttpUrl(candidate: string | undefined, domain: string): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!matchesDomainOrParent(url.hostname.toLowerCase(), new Set([domain]))) return null;
    return candidate;
  } catch {
    return null;
  }
}

/**
 * `offered` is the URL the warning page was handed by GET_BLOCK_CONTEXT and
 * sends back when the user acts. The map below is the better source but lives
 * only in this worker's memory: read a warning page for half a minute, the
 * worker idles out, and the deep link would be lost — so the page's copy is
 * accepted as a fallback, held to exactly the same check.
 */
function resolveResumeUrl(
  tabId: number | undefined,
  domain: string,
  offered?: string,
): string | null {
  const remembered = tabId !== undefined ? lastMainFrameUrl.get(tabId) : undefined;
  return sameSiteHttpUrl(remembered, domain) ?? sameSiteHttpUrl(offered, domain);
}

/**
 * Which of our own rule sources blocks this domain, if any. Used to gate the
 * warning page's state-changing controls: the page is web-accessible, so a
 * hostile site could open it with ?blocked=<attacker domain> and try to get
 * the user to click "allow".
 */
async function classifyBlock(
  domain: string,
): Promise<{
  blockedByUs: boolean;
  source: 'feed' | 'manual' | 'country' | null;
  country: string | null;
}> {
  // The user's own block is checked first: when a domain they blocked by hand
  // later turns up on the feed, calling it a feed block would offer them a
  // "report this as a mistake" button for their own decision.
  const settings = await getSettings();
  if (matchesDomainOrParent(domain, new Set(settings.customBlockList))) {
    return { blockedByUs: true, source: 'manual', country: null };
  }
  if (isMalware(domain)) return { blockedByUs: true, source: 'feed', country: null };
  const blocked = await getBlockedDomains();
  if (matchesDomainOrParent(domain, blocked)) {
    return { blockedByUs: true, source: 'manual', country: null };
  }
  const country = await getBlockingCountry(domain);
  if (country) return { blockedByUs: true, source: 'country', country };
  return { blockedByUs: false, source: null, country: null };
}

async function resetPage(tabId: number): Promise<void> {
  navStartTimes.set(tabId, Date.now());
  leakSeen.delete(tabId);
  await updatePage(tabId, () => null);
  // While paused the badge carries the paused indicator; clearing per-tab text
  // on every navigation would wipe it off each tab as the user browses.
  if (!isPaused()) clearBadge(tabId);
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
  let geo = details.ip ? await getGeoData(details.ip) : null;
  if (geo) void rememberDomainGeo(domain, geo);
  else geo = await recallDomainGeo(domain);
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
  // Badge writes below consult isPaused(); knowing the answer keeps a restart
  // from painting over the paused indicator.
  await pauseReady();
  if (details.tabId < 0) {
    await handleBackgroundRequest(details, outcome);
    return;
  }

  // A main-frame load is the page itself, never one of its connections.
  // It also races tab.url (still the previous document here), which used
  // to attribute each navigation to the page the user just left.
  if (details.type === 'main_frame') {
    // Recorded here rather than on the request, so that "have I been here
    // before" means the page actually loaded. A blocked navigation redirects
    // to the extension's warning page and never completes on the original
    // host, so retries at a blocked site cannot accumulate into a history —
    // while a site the user allowed, or visited with protection paused, gets
    // the record it needs for the first-password notice and the softer
    // warning variant.
    if (outcome === 'completed') {
      try {
        const url = new URL(details.url);
        // http(s) only. The warning page and the popup are main-frame loads
        // too, and recording the extension's own id as a visited site both
        // pollutes the history and, because the map is written back whole,
        // overwrites the real entries.
        if (/^https?:$/.test(url.protocol)) void recordVisit(url.hostname);
      } catch {
        // unparsable URL
      }
    }
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
  // First-party means the same registrable domain, not the same hostname —
  // a site's own subdomains (cdn.example.com on example.com) are not
  // third-party connections and must not raise the page's risk score.
  if (isSameSite(domain, tabUrl.hostname)) return;

  // Give the stored feed a chance to become the active DB before falling
  // back to fetching the bundled tracker JSON.
  await feedReady;
  await ensureTrackerDB();

  const tracker = lookupTracker(domain);
  const riskLevel = getRiskLevel(domain);
  let geo = details.ip ? await getGeoData(details.ip) : null;
  if (geo) void rememberDomainGeo(domain, geo);
  else geo = await recallDomainGeo(domain);
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
          company: resolveOwner(domain, tracker?.company),
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
    base.riskLevel = pageRiskLevel(base.riskScore, base.connections);
    base.lastUpdated = Date.now();
    return base;
  });

  const blockedByUs =
    outcome === 'blocked' && (await isBlockAttributedToUs(domain, tracker));

  // While paused the badge carries the paused indicator; per-tab writes would
  // paint over it and hide the one thing the user needs to see.
  if (page && !isPaused()) {
    if (blockedByUs) {
      flashBlockedBadge(details.tabId, () =>
        updateBadge(details.tabId, page.riskLevel, page.riskScore),
      );
    } else {
      updateBadge(details.tabId, page.riskLevel, page.riskScore);
    }
  }

  await updateTodayStats(domain, tracker, riskLevel, geo, blockedByUs);

  if (riskLevel === 'dangerous' && outcome === 'completed' && !isPaused()) {
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
        company: resolveOwner(domain, tracker?.company),
        category: tracker?.category ?? null,
        country: geo?.countryCode ?? null,
        countryName: geo?.country ?? null,
        riskLevel,
      };
    }
  }
  const owner = tracker ? resolveOwner(domain, tracker.company) : null;
  if (owner) {
    if (!today.companiesDetected.includes(owner)) {
      today.companiesDetected.push(owner);
    }
    today.companyCounts[owner] = (today.companyCounts[owner] ?? 0) + 1;
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
      const url = new URL(details.url);
      if (/^https?:$/.test(url.protocol)) {
        lastMainFrameUrl.set(details.tabId, details.url);
      }
    } catch {
      // unparsable URL
    }
    // Paused means "stop interrupting me": DNR blocks are lifted by the pause
    // rule, and this interstitial has to stand down with them. Right after a
    // service-worker restart the pause state is not known yet, so wait for it
    // rather than assume protection is on and swap the tab out from under a
    // user who explicitly paused.
    void (async () => {
      await pauseReady();
      if (!isPaused()) void checkNavigation(details.tabId, details.url);
    })();
  },
  {
    urls: ['http://*/*', 'https://*/*'],
    types: ['main_frame' as chrome.webRequest.ResourceType],
  },
);

// --- Data-exfiltration watch ---------------------------------------------
// Precomputed match tokens for the user's watched values. Empty (feature
// inert) until the user registers something.
let watchEntries: WatchEntry[] = [];

async function reloadWatch(): Promise<void> {
  const list = await getWatchList();
  const computed = await Promise.all(list.map((w) => computeEntry(w)));
  watchEntries = computed.filter((e): e is WatchEntry => e !== null);
}
void reloadWatch();

// Per-tab dedupe so one page load doesn't fire the same leak repeatedly.
const leakSeen = new Map<number, Set<string>>();

async function reportLeaks(
  details: chrome.webRequest.WebRequestBodyDetails,
  hits: WatchEntry[],
): Promise<void> {
  let host: string;
  try {
    host = new URL(details.url).hostname;
  } catch {
    return;
  }
  let pageHost: string | null = null;
  try {
    pageHost = details.initiator ? new URL(details.initiator).hostname : null;
  } catch {
    pageHost = null;
  }

  const seen = leakSeen.get(details.tabId) ?? new Set<string>();
  leakSeen.set(details.tabId, seen);

  const fresh: WatchEntry[] = [];
  for (const h of hits) {
    const key = `${host}|${h.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(h);
    await addLeakEvent({
      id: `${Date.now()}-${h.id}`,
      kind: h.kind,
      display: h.display,
      destination: host,
      host,
      pageHost,
      ts: Date.now(),
    });
  }
  if (fresh.length === 0) return;

  // The alert itself still fires while paused — a pause is about not blocking,
  // not about hiding that data just left. The badge is the one thing that must
  // keep saying "paused".
  if (!isPaused()) flashDangerBadge(details.tabId);

  const kindWord = (k: WatchEntry['kind']): string =>
    t(
      `leakKind_${k}`,
      k === 'email' ? 'your email' : k === 'phone' ? 'your phone number' : 'your info',
    );
  const first = fresh[0];
  const what = `${kindWord(first.kind)} (${first.display})`;
  const extra = fresh.length > 1 ? ` +${fresh.length - 1}` : '';

  chrome.tabs
    .sendMessage(details.tabId, {
      type: 'DATA_LEAK',
      destination: host,
      title: t('leakTitle', 'Your information was just sent'),
      message: t('leakBody', `${what}${extra} was sent to ${host}`, `${what}${extra}`, host),
      blockLabel: t('leakBlock', `Block ${host}`, host),
      dismiss: t('pwWarnDismiss', 'Dismiss'),
    })
    .catch(() => {
      // no content script on this page (e.g. chrome:// or a discarded tab)
    });
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (watchEntries.length === 0 || details.tabId < 0) return;
    if (!isThirdPartySend(details.initiator, details.url)) return;
    const body = extractBody(details.requestBody ?? undefined);
    const hits = scan(buildHaystack(details.url, body), watchEntries);
    if (hits.length > 0) void reportLeaks(details, hits);
  },
  {
    urls: ['http://*/*', 'https://*/*'],
    types: [
      'image',
      'script',
      'xmlhttprequest',
      'ping',
      'sub_frame',
      'media',
      'websocket',
      'csp_report',
      'other',
    ] as chrome.webRequest.ResourceType[],
  },
  ['requestBody'],
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
      // Ask our own CDN where the request came from. Cloudflare resolves the
      // location at the edge from the connecting IP, so nothing about the
      // user is sent anywhere a third party could see — the browsing history
      // never leaves the device, and this endpoint stores nothing. When the
      // edge only knows the country (no precise lat/lng), fall back to that
      // country's centroid, which is bundled offline.
      const res = await fetch('https://feedback.zevrhq.com/v1/whereami', {
        signal: AbortSignal.timeout(4000),
      });
      const j = (await res.json()) as {
        lat?: number | null;
        lng?: number | null;
        cc?: string | null;
      };
      const cc = typeof j.cc === 'string' ? j.cc.toUpperCase() : null;
      if (!cc) return null;

      let lat = typeof j.lat === 'number' ? j.lat : null;
      let lng = typeof j.lng === 'number' ? j.lng : null;
      if (lat === null || lng === null) {
        const centroid = countryCentroid(cc);
        if (!centroid) return null;
        [lat, lng] = centroid;
      }

      const loc: UserLocation = {
        lat,
        lng,
        countryCode: cc,
        countryName: cc,
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
    createNotificationSafe(`zg-review-${milestone}`, {
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
    void chrome.tabs.create({ url: reviewPageUrl() });
  }
});

// Firefox drops notification buttons; clicking the notification body is
// the only affordance there, so mirror the primary action.
chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith('zg-review-')) {
    void chrome.tabs.create({ url: reviewPageUrl() });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (isPaused()) return; // leave the paused indicator in place
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
  // A document load resets the page. changeInfo.url is absent on a plain
  // reload of the same URL, so key the reset off status, not url — otherwise
  // reloading keeps stale stats (e.g. a blocked count that never clears).
  if (changeInfo.status === 'loading') {
    await resetPage(tabId);
    return;
  }
  if (!changeInfo.url) return;
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
  lastMainFrameUrl.delete(tabId);
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
  // Set the install timestamp on update too, not only fresh installs — it is
  // idempotent (only sets if unset) and gates the password guard's "first
  // visit" learning window. Without it, users who upgrade from a version
  // before this feature would never get the first-visit notice.
  void markInstalled();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/index.html') });
    void refreshFeed(true);
  } else if (details.reason === 'update') {
    void refreshFeed();
  }
  void syncFromStoredSettings();
});

chrome.runtime.onStartup.addListener(() => {
  // Session rules are gone after a restart and take a moment to rebuild, so
  // put the packaged ruleset back first; initFeed retires it again once the
  // live mirror is in place.
  void armStaticMalwareRules();
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
void reconcilePause();

chrome.runtime.onMessage.addListener(
  (message: MessageRequest, _sender, sendResponse) => {
    (async () => {
      switch (message.type) {
        // These four take a domain that, since the settings panel grew a text
        // field, can be anything a person typed. The popup validates first, but
        // a bad string here would become a DNR urlFilter — and a rejected
        // updateDynamicRules throws past sendResponse, leaving the caller
        // hanging — so the background checks again rather than trust it.
        case 'BLOCK_DOMAIN': {
          const domain = message.domain.trim().toLowerCase();
          if (!isValidHostname(domain)) {
            sendResponse({ success: false });
            break;
          }
          await blockDomain(domain);
          sendResponse({ success: true });
          break;
        }
        case 'UNBLOCK_DOMAIN': {
          const domain = message.domain.trim().toLowerCase();
          if (!isValidHostname(domain)) {
            sendResponse({ success: false });
            break;
          }
          await unblockDomain(domain);
          sendResponse({ success: true });
          break;
        }
        case 'ALLOW_DOMAIN': {
          const domain = message.domain.trim().toLowerCase();
          if (!isValidHostname(domain)) {
            sendResponse({ success: false });
            break;
          }
          await allowDomain(domain);
          sendResponse({ success: true });
          break;
        }
        case 'GET_BLOCK_CONTEXT': {
          const domain = message.domain.trim().toLowerCase();
          if (!isValidHostname(domain)) {
            sendResponse({
              context: {
                blockedByUs: false,
                source: null,
                url: null,
                country: null,
                established: null,
                meta: null,
                feedGeneratedAt: null,
              } satisfies BlockContext,
            });
            break;
          }
          const { blockedByUs, source, country } = await classifyBlock(domain);
          // Only the feed can be wrong about a site the user already knows.
          // A block they set themselves needs no softening, and a country
          // block has its own answer.
          let established: BlockContext['established'] = null;
          if (source === 'feed' && (await isEstablishedSite(domain))) {
            const record = await getVisitRecord(domain);
            if (record) established = { since: record.first, n: record.n };
          }
          if (source === 'feed') await ensureMalwareMeta();
          const listed = source === 'feed' ? lookupMalwareMeta(domain) : null;
          const context: BlockContext = {
            blockedByUs,
            source,
            url: resolveResumeUrl(_sender.tab?.id, domain),
            country,
            established,
            meta: listed ? { src: listed.s ?? null, since: listed.f } : null,
            feedGeneratedAt: source === 'feed' ? getMalwareFeedGeneratedAt() : null,
          };
          sendResponse({ context });
          break;
        }
        case 'ALLOW_FOR_SESSION_AND_OPEN': {
          // "Continue this time": allow until the browser restarts, leaving
          // no permanent trace. Same gate as ALLOW_AND_OPEN.
          const domain = message.domain.trim().toLowerCase();
          if (!isValidHostname(domain) || !(await classifyBlock(domain)).blockedByUs) {
            sendResponse({ success: false });
            break;
          }
          await allowDomainForSession(domain);
          sendResponse({
            success: true,
            url:
              resolveResumeUrl(_sender.tab?.id, domain, message.url) ??
              `https://${domain}/`,
          });
          break;
        }
        case 'ALLOW_AND_OPEN': {
          // From the warning interstitial: whitelist the domain (which
          // outranks every feed / static / manual block rule), lift a
          // manual block if that is what tripped, and hand back the URL
          // the tab was heading to so the page can resume it.
          const domain = message.domain.trim().toLowerCase();
          // Refuse for a domain we do not actually block: the page asking is
          // web-accessible, so this must not become a way for a site to talk
          // a user into whitelisting somewhere we never warned about.
          if (!isValidHostname(domain) || !(await classifyBlock(domain)).blockedByUs) {
            sendResponse({ success: false });
            break;
          }
          await allowDomain(domain);
          sendResponse({
            success: true,
            url:
              resolveResumeUrl(_sender.tab?.id, domain, message.url) ??
              `https://${domain}/`,
          });
          break;
        }
        case 'DISALLOW_DOMAIN': {
          const domain = message.domain.trim().toLowerCase();
          if (!isValidHostname(domain)) {
            sendResponse({ success: false });
            break;
          }
          await disallowDomain(domain);
          sendResponse({ success: true });
          break;
        }
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
          await pauseReady();
          const settings = await getSettings();
          let context: {
            level: 'danger' | 'notice';
            title: string;
            message: string;
            dismiss: string;
          } | null = null;
          if (settings.passwordWarningsEnabled && !isPaused()) {
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
        case 'REPORT_PHISHING': {
          // The domain can originate from the web-accessible warning page's
          // query params, so validate it as a bare hostname before it becomes
          // a DNR filter or a report payload.
          const reportDomain = message.domain.trim().toLowerCase();
          if (!isValidHostname(reportDomain)) {
            sendResponse({ success: false, blocked: false });
            break;
          }
          // Block locally first (if requested) so the user is protected even
          // if the report request fails; the report itself is best-effort.
          if (message.alsoBlock) {
            await blockDomain(reportDomain).catch(() => {});
          }
          let reported = false;
          try {
            const res = await fetch('https://feedback.zevrhq.com/v1/phishing-report', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                domain: reportDomain,
                context: message.context,
                locale: getLocale(),
              }),
              signal: AbortSignal.timeout(10_000),
            });
            reported = res.ok;
          } catch {
            reported = false;
          }
          sendResponse({ success: reported, blocked: message.alsoBlock === true });
          break;
        }
        case 'REPORT_FALSE_POSITIVE': {
          // The mirror image of REPORT_PHISHING: the user says a block is
          // wrong. Reports are reviewed by hand before anything reaches the
          // safelist — taking them automatically would let anyone unblock a
          // live malware domain by reporting it.
          const fpDomain = message.domain.trim().toLowerCase();
          if (!isValidHostname(fpDomain) || !(await classifyBlock(fpDomain)).blockedByUs) {
            sendResponse({ success: false, allowed: false, url: null });
            break;
          }
          // Honour the user's own choice first; the report is best-effort.
          if (message.alsoAllow) {
            await allowDomain(fpDomain).catch(() => {});
          }
          const listed = lookupMalwareMeta(fpDomain);
          let reported = false;
          try {
            const res = await fetch('https://feedback.zevrhq.com/v1/false-positive', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                domain: fpDomain,
                context: message.context,
                locale: getLocale(),
                version: chrome.runtime.getManifest().version,
                source: listed?.s ?? null,
                feedGeneratedAt: getMalwareFeedGeneratedAt(),
              }),
              signal: AbortSignal.timeout(10_000),
            });
            reported = res.ok;
          } catch {
            reported = false;
          }
          sendResponse({
            success: reported,
            allowed: message.alsoAllow === true,
            url: message.alsoAllow
              ? (resolveResumeUrl(_sender.tab?.id, fpDomain, message.url) ??
                `https://${fpDomain}/`)
              : null,
          });
          break;
        }
        case 'PAUSE_ALL': {
          // Only the three offers the UI makes; anything else would let a
          // stray caller park protection off for an arbitrary span.
          const minutes = message.minutes;
          if (minutes !== null && minutes !== 5 && minutes !== 60) {
            sendResponse({ state: await getPauseState() });
            break;
          }
          sendResponse({ state: await pauseAll(minutes) });
          break;
        }
        case 'RESUME_ALL': {
          const ok = await resumeAll();
          sendResponse({ success: ok, state: await getPauseState() });
          break;
        }
        case 'GET_PAUSE_STATE': {
          sendResponse({ state: await getPauseState() });
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
        case 'GET_WATCH': {
          const list = await getWatchList();
          sendResponse({
            watch: list.map((w) => ({
              id: w.id,
              kind: w.kind,
              display: maskValue(w.kind, w.value),
            })),
          });
          break;
        }
        case 'ADD_WATCH': {
          const item: WatchItem = {
            id: `w${Date.now()}`,
            kind: message.kind,
            value: message.value,
          };
          // computeEntry rejects values too short to watch safely.
          const entry = await computeEntry(item);
          if (!entry) {
            sendResponse({ success: false, error: 'too_short' });
            break;
          }
          const list = await getWatchList();
          list.push(item);
          await setWatchList(list);
          await reloadWatch();
          sendResponse({
            success: true,
            watch: list.map((w) => ({
              id: w.id,
              kind: w.kind,
              display: maskValue(w.kind, w.value),
            })),
          });
          break;
        }
        case 'REMOVE_WATCH': {
          const list = (await getWatchList()).filter((w) => w.id !== message.id);
          await setWatchList(list);
          await reloadWatch();
          sendResponse({ success: true });
          break;
        }
        case 'GET_LEAKS':
          sendResponse({ leaks: await getLeakEvents() });
          break;
        case 'CLEAR_LEAKS':
          await clearLeakEvents();
          sendResponse({ success: true });
          break;
        default:
          sendResponse({ error: 'unknown message' });
      }
    })().catch((err) => sendResponse({ error: (err as Error).message }));
    return true;
  },
);
