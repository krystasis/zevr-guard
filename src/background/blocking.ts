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
const BLOCK_ACTION = 'block' as unknown as chrome.declarativeNetRequest.RuleActionType;
const REDIRECT_ACTION = 'redirect' as unknown as chrome.declarativeNetRequest.RuleActionType;
const ALLOW_ACTION = 'allow' as unknown as chrome.declarativeNetRequest.RuleActionType;

// Allow rules must beat every block/redirect/category rule, so give them
// a far higher priority than anything else dynamic or static.
const ALLOW_PRIORITY = 1000;

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

export async function allowDomain(domain: string): Promise<void> {
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
  if (set.has(domain)) return true;
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (set.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

const SESSION_APPLIED_KEY = 'zg.sessionRules.applied';
// Chrome caps session rules at 5,000 and each domain takes two rules
// (main_frame redirect + everything-else block).
const MAX_SESSION_DOMAINS = 2400;

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

  // Skip the (frequent) service-worker restarts where nothing changed.
  const key = `${enabled}:${domains.length}:${domains[0] ?? ''}:${domains[domains.length - 1] ?? ''}`;
  try {
    const stored = await chrome.storage.session.get(SESSION_APPLIED_KEY);
    if (stored[SESSION_APPLIED_KEY] === key) return;
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

  const existing = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules,
  });
  try {
    await chrome.storage.session.set({ [SESSION_APPLIED_KEY]: key });
  } catch {
    // ignore
  }
}
