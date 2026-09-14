import { findSelfOrParent } from '../shared/domain';
import { FEED_MAX_DOMAINS } from '../shared/limits';
import { getSettings, setSettings } from './storage';
import { getMalwareDomains } from './risk';

// NB: block rules deliberately omit resourceTypes. The DNR default is "every
// resource type except main_frame", which covers ping (sendBeacon), object,
// csp_report, webtransport, webbundle and other — types the old explicit list
// silently let through. main_frame is handled by the redirect rule instead.

const ALL_RESOURCES = [
  'script',
  'image',
  'xmlhttprequest',
  'sub_frame',
  'stylesheet',
  'font',
  'media',
  'websocket',
  'ping',
  'object',
  'csp_report',
  'webtransport',
  'webbundle',
  'other',
  'main_frame',
] as unknown as chrome.declarativeNetRequest.ResourceType[];

const MAIN_FRAME = 'main_frame' as unknown as chrome.declarativeNetRequest.ResourceType;

export { ALL_RESOURCES, ALLOW_ACTION };
const BLOCK_ACTION = 'block' as unknown as chrome.declarativeNetRequest.RuleActionType;
const REDIRECT_ACTION = 'redirect' as unknown as chrome.declarativeNetRequest.RuleActionType;
const ALLOW_ACTION = 'allow' as unknown as chrome.declarativeNetRequest.RuleActionType;

// Allow rules must beat every block/redirect/category rule, so give them
// a far higher priority than anything else dynamic or static.
export const ALLOW_PRIORITY = 1000;

// Country-learning rules live in their own id range (see country.ts). Manual
// block/allow/pause rules must never allocate into it, and must never be
// removed as if they were manual — otherwise the two owners corrupt each
// other's inventory.
export const COUNTRY_ID_BASE = 1_000_000;

/** Highest manual (non-country) dynamic rule id, for max+1 allocation. */
function maxManualId(rules: chrome.declarativeNetRequest.Rule[]): number {
  const ids = rules.map((r) => r.id).filter((id) => id < COUNTRY_ID_BASE);
  return ids.length > 0 ? Math.max(...ids) : 10_000;
}

export async function blockDomain(domain: string): Promise<void> {
  // Idempotency is keyed on the manual blocklist, the source of truth for
  // user blocks — not on the presence of any `||domain` rule, which would
  // also match a country-learning rule and wrongly skip creating the user's
  // own (independent) block.
  const settings = await getSettings();
  if (settings.customBlockList.includes(domain)) return;

  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const maxId = maxManualId(rules);
  const subId = maxId + 1;
  const redirectId = maxId + 2;
  const redirectPath = chrome.runtime.getURL(
    `src/warning/index.html?blocked=${encodeURIComponent(domain)}`,
  );

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [
      {
        id: subId,
        priority: 1,
        action: { type: BLOCK_ACTION },
        condition: {
          urlFilter: `||${domain}`,
        },
      },
      {
        id: redirectId,
        priority: 2,
        action: {
          type: REDIRECT_ACTION,
          redirect: { url: redirectPath },
        },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: [MAIN_FRAME],
        },
      },
    ],
    removeRuleIds: [],
  });

  if (!settings.customBlockList.includes(domain)) {
    settings.customBlockList.push(domain);
    await setSettings(settings);
  }
}

export async function unblockDomain(domain: string): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  // Only remove the user's own (manual-range) rules. A country-learning rule
  // for the same domain is owned by country.ts and must not be orphaned here.
  const removeIds = rules
    .filter((r) => r.condition.urlFilter === `||${domain}` && r.id < COUNTRY_ID_BASE)
    .map((r) => r.id);

  if (removeIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [],
      removeRuleIds: removeIds,
    });
  }

  const settings = await getSettings();
  settings.customBlockList = settings.customBlockList.filter((d) => d !== domain);
  await setSettings(settings);
}

export async function getBlockedDomains(): Promise<Set<string>> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const blocked = new Set<string>();
  for (const r of rules) {
    if (r.action.type !== BLOCK_ACTION && r.action.type !== REDIRECT_ACTION) {
      continue;
    }
    const filter = r.condition.urlFilter;
    if (filter?.startsWith('||')) {
      blocked.add(filter.slice(2));
    }
  }
  return blocked;
}

/**
 * Whitelist a domain. Allowing something the user had previously blocked by
 * hand also lifts that block: three entry points reach this (the warning
 * page, the popup's allow button, a false-positive report) and without it
 * they disagreed, leaving the same domain in customBlockList and
 * customWhiteList at once and listed twice in Settings.
 */
export async function allowDomain(domain: string): Promise<void> {
  const current = await getSettings();
  if (current.customBlockList.includes(domain)) {
    await unblockDomain(domain);
  }

  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const existingAllow = rules.find(
    (r) =>
      r.action.type === ALLOW_ACTION &&
      r.condition.urlFilter === `||${domain}`,
  );
  if (existingAllow) {
    const settings = await getSettings();
    if (!settings.customWhiteList.includes(domain)) {
      settings.customWhiteList.push(domain);
      await setSettings(settings);
    }
    return;
  }

  const maxId = maxManualId(rules);
  const allowId = maxId + 1;

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [
      {
        id: allowId,
        priority: ALLOW_PRIORITY,
        action: { type: ALLOW_ACTION },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: ALL_RESOURCES,
        },
      },
    ],
    removeRuleIds: [],
  });

  const settings = await getSettings();
  if (!settings.customWhiteList.includes(domain)) {
    settings.customWhiteList.push(domain);
    await setSettings(settings);
  }
}

export async function disallowDomain(domain: string): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = rules
    .filter(
      (r) =>
        r.action.type === ALLOW_ACTION &&
        r.condition.urlFilter === `||${domain}`,
    )
    .map((r) => r.id);

  if (removeIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [],
      removeRuleIds: removeIds,
    });
  }

  const settings = await getSettings();
  settings.customWhiteList = settings.customWhiteList.filter(
    (d) => d !== domain,
  );
  await setSettings(settings);
}

export async function getAllowedDomains(): Promise<Set<string>> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const allowed = new Set<string>();
  for (const r of rules) {
    if (r.action.type !== ALLOW_ACTION) continue;
    const filter = r.condition.urlFilter;
    if (filter?.startsWith('||')) {
      allowed.add(filter.slice(2));
    }
  }
  return allowed;
}

// Pause rules allow *everything initiated by* a given site, as an escape
// hatch when blocking breaks it. Identified by this urlFilter so they never
// collide with per-domain (`||domain`) allow rules.
const PAUSE_URL_FILTER = '*';

function isPauseRule(r: chrome.declarativeNetRequest.Rule, host?: string): boolean {
  const cond = r.condition as { initiatorDomains?: string[]; urlFilter?: string };
  if (r.action.type !== ALLOW_ACTION) return false;
  if (cond.urlFilter !== PAUSE_URL_FILTER) return false;
  if (!cond.initiatorDomains || cond.initiatorDomains.length !== 1) return false;
  return host === undefined || cond.initiatorDomains[0] === host;
}

export async function pauseSite(host: string): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  if (!rules.some((r) => isPauseRule(r, host))) {
    const maxId = maxManualId(rules);
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: maxId + 1,
          priority: ALLOW_PRIORITY,
          action: { type: ALLOW_ACTION },
          condition: {
            urlFilter: PAUSE_URL_FILTER,
            initiatorDomains: [host],
            resourceTypes: ALL_RESOURCES,
          } as chrome.declarativeNetRequest.RuleCondition,
        },
      ],
      removeRuleIds: [],
    });
  }

  const settings = await getSettings();
  if (!settings.pausedSites.includes(host)) {
    settings.pausedSites.push(host);
    await setSettings(settings);
  }
}

export async function resumeSite(host: string): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = rules.filter((r) => isPauseRule(r, host)).map((r) => r.id);
  if (removeIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [],
      removeRuleIds: removeIds,
    });
  }

  const settings = await getSettings();
  settings.pausedSites = settings.pausedSites.filter((h) => h !== host);
  await setSettings(settings);
}

/**
 * `||domain` rules also match subdomains, so membership checks against the
 * blocked/allowed sets must walk parent labels too.
 */
export function matchesDomainOrParent(domain: string, set: Set<string>): boolean {
  return findSelfOrParent(domain, (c) => (set.has(c) ? true : undefined)) === true;
}

/** FNV-1a over the joined list: cheap, and sensitive to any single change. */
function hashDomains(domains: string[]): string {
  let h = 0x811c9dc5;
  for (const domain of domains) {
    for (let i = 0; i < domain.length; i++) {
      h ^= domain.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f; // '/' separator, so ['ab','c'] and ['a','bc'] differ
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const SESSION_APPLIED_KEY = 'zg.sessionRules.applied';
// Chrome caps session rules at 5,000 and each domain takes two rules
// (main_frame redirect + everything-else block). Shared with the feed build so
// the list can never be longer than what gets mirrored into rules.
const MAX_SESSION_DOMAINS = FEED_MAX_DOMAINS;

// Session-scoped "allow for this browser session" rules live above this id.
// The feed mirror below owns 1..MAX_SESSION_DOMAINS*2 and must never remove
// them: 2400*2 = 4800 feed rules + at most MAX_SESSION_ALLOWS = 100 allows
// stays under Chrome's 5,000 session-rule cap.
export const SESSION_ALLOW_ID_BASE = 900_000;
// The global pause owns everything above this, and must never be counted,
// evicted or overwritten by the per-domain allows below it. Budget:
// 4,800 feed + 100 per-domain allows + 1 pause, under Chrome's 5,000.
export const SESSION_GLOBAL_ID_BASE = 950_000;
const MAX_SESSION_ALLOWS = 100;

function isSessionAllowId(id: number): boolean {
  return id >= SESSION_ALLOW_ID_BASE && id < SESSION_GLOBAL_ID_BASE;
}

/**
 * Mirror the current malware feed into DNR session rules so blocking follows
 * the daily feed instead of the rules baked into the store package. Session
 * rules are cleared on browser restart; initFeed() re-applies them on boot.
 */
export async function syncMalwareSessionRules(): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return;

  const settings = await getSettings();
  const enabled = settings.blockCategories.malware !== false;
  const domains = enabled ? getMalwareDomains().slice(0, MAX_SESSION_DOMAINS) : [];

  // Skip the (frequent) service-worker restarts where nothing changed. The
  // key has to be content-derived: the list is prevalence-sorted and truncated
  // to exactly FEED_MAX_DOMAINS, so length and endpoints barely move between
  // daily builds — and a false positive removed today would then keep
  // blocking until the browser restarted.
  const key = `${enabled}:${domains.length}:${hashDomains(domains)}`;
  try {
    const stored = await chrome.storage.session.get(SESSION_APPLIED_KEY);
    if (stored[SESSION_APPLIED_KEY] === key) {
      await retireStaticMalwareRules();
      return;
    }
  } catch {
    // session storage unavailable — apply unconditionally
  }

  const addRules: chrome.declarativeNetRequest.Rule[] = [];
  let id = 1;
  for (const domain of domains) {
    addRules.push({
      id: id++,
      priority: 2,
      action: {
        type: REDIRECT_ACTION,
        redirect: {
          url: chrome.runtime.getURL(
            `src/warning/index.html?blocked=${encodeURIComponent(domain)}`,
          ),
        },
      },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: [MAIN_FRAME],
      },
    });
    addRules.push({
      id: id++,
      priority: 1,
      action: { type: BLOCK_ACTION },
      condition: {
        urlFilter: `||${domain}`,
      },
    });
  }

  try {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({
      // Only the feed mirror's own id range. Session allow rules (the
      // "continue this time" escape hatch) are owned by allowDomainForSession
      // and must survive every feed refresh.
      removeRuleIds: existing.filter((r) => r.id < SESSION_ALLOW_ID_BASE).map((r) => r.id),
      addRules,
    });
    try {
      await chrome.storage.session.set({ [SESSION_APPLIED_KEY]: key });
    } catch {
      // ignore
    }
    await retireStaticMalwareRules();
  } catch (err) {
    // The mirror failed, so the packaged snapshot stays on: stale beats
    // nothing. Without this the ruleset armed at startup would also be left
    // enabled for the whole session, blocking domains the feed has dropped.
    console.warn('[Zevr Guard] session rule sync failed:', (err as Error).message);
    throw err;
  }
}

const STATIC_MALWARE_RULESET = 'block_rules';

/**
 * The packaged `block_rules` ruleset is a snapshot of the feed on build day.
 * Once the live feed is mirrored into session rules it must step aside:
 * otherwise a domain the feed has since dropped (a false positive such as
 * steamcommunity.com in 1.5.12) stays blocked until the next store release,
 * and the malware toggle cannot switch it off.
 *
 * It is not retired for good, though. Session rules die with the browser
 * while the disabled state persists, so retiring it once would leave every
 * subsequent launch unprotected from the first restored tab until the worker
 * finished rebuilding ~4,800 rules. armStaticMalwareRules() puts it back at
 * startup and this takes it away again as soon as the mirror is live.
 */
/**
 * Re-enable the packaged ruleset so something covers the window between
 * browser launch and the first session-rule sync. Safe because the packaged
 * set is built with the same safelist as the feed: nothing popular is in it.
 */
export async function armStaticMalwareRules(): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.getEnabledRulesets || !dnr.updateEnabledRulesets) return;
  // Never against the user's wishes: someone who turned malware blocking off
  // would otherwise get the packaged list back on at every browser start, for
  // exactly the window in which restored tabs load.
  const settings = await getSettings();
  if (settings.blockCategories.malware === false) return;
  try {
    const enabled = await dnr.getEnabledRulesets();
    if (enabled.includes(STATIC_MALWARE_RULESET)) return;
    await dnr.updateEnabledRulesets({ enableRulesetIds: [STATIC_MALWARE_RULESET] });
  } catch (err) {
    console.warn('[Zevr Guard] could not arm static rules:', (err as Error).message);
  }
}

/**
 * True while the packaged snapshot is still doing the blocking — the window
 * between browser launch and the first session-rule sync. Its contents are a
 * superset of the live feed from build day, so a domain it blocks may not be
 * on the current list at all.
 */
export async function isStaticMalwareRuleActive(): Promise<boolean> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.getEnabledRulesets) return false;
  try {
    return (await dnr.getEnabledRulesets()).includes(STATIC_MALWARE_RULESET);
  } catch {
    return false;
  }
}

async function retireStaticMalwareRules(): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.getEnabledRulesets || !dnr.updateEnabledRulesets) return;
  try {
    const enabled = await dnr.getEnabledRulesets();
    if (!enabled.includes(STATIC_MALWARE_RULESET)) return;
    await dnr.updateEnabledRulesets({ disableRulesetIds: [STATIC_MALWARE_RULESET] });
  } catch (err) {
    console.warn('[Zevr Guard] could not retire static rules:', (err as Error).message);
  }
}

/**
 * Allow a domain until the browser restarts. Used by the warning page's
 * "continue this time" choice for sites the user has a history with: it
 * outranks every block source (same priority as a permanent allow) but
 * leaves no trace in customWhiteList, and session rules are dropped on
 * restart, so protection comes back on its own.
 */
export async function allowDomainForSession(domain: string): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return;
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const allows = existing.filter((r) => isSessionAllowId(r.id));
  if (allows.some((r) => r.condition.urlFilter === `||${domain}`)) return;

  // FIFO eviction: oldest (lowest id) goes first when the budget is spent.
  const removeRuleIds: number[] = [];
  if (allows.length >= MAX_SESSION_ALLOWS) {
    const overflow = allows.length - MAX_SESSION_ALLOWS + 1;
    removeRuleIds.push(
      ...allows
        .map((r) => r.id)
        .sort((a, b) => a - b)
        .slice(0, overflow),
    );
  }
  const maxId = allows.length > 0
    ? Math.max(...allows.map((r) => r.id))
    : SESSION_ALLOW_ID_BASE - 1;

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds,
    addRules: [
      {
        id: maxId + 1,
        priority: ALLOW_PRIORITY,
        action: { type: ALLOW_ACTION },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: ALL_RESOURCES,
        },
      },
    ],
  });
}

/** Domains currently allowed for this browser session only. */
export async function getSessionAllowedDomains(): Promise<Set<string>> {
  if (!chrome.declarativeNetRequest?.getSessionRules) return new Set();
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const allowed = new Set<string>();
  for (const r of rules) {
    if (!isSessionAllowId(r.id)) continue;
    const filter = r.condition.urlFilter;
    if (filter?.startsWith('||')) allowed.add(filter.slice(2));
  }
  return allowed;
}
