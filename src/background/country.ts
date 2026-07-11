import type { Settings } from '../types';
import { getSettings, setSettings } from './storage';
import { COUNTRY_ID_BASE, matchesDomainOrParent } from './blocking';

// ---------------------------------------------------------------------------
// Country blocking.
//
// DNR rules match domains, not countries, and a request's country is only
// known once an IP has been observed. So this is a *learning* blocker: the
// first request to a domain in a blocked country goes through, its geo
// lookup marks the domain, and from then on the domain is blocked by a
// dynamic rule pair (block everything + redirect main_frame to the warning
// page). The rule inventory is bookkept per country so unblocking a country
// removes exactly its rules.
// ---------------------------------------------------------------------------

const MAP_KEY = 'zg.countryRules';
// Each domain costs two dynamic rules. Chrome guarantees at least 5,000
// dynamic rules; stay well under it and leave room for user block rules.
const MAX_DOMAINS = 1200;
const EVICT_BATCH = 100;

const BLOCK_ACTION = 'block' as unknown as chrome.declarativeNetRequest.RuleActionType;
const REDIRECT_ACTION = 'redirect' as unknown as chrome.declarativeNetRequest.RuleActionType;
const MAIN_FRAME = 'main_frame' as unknown as chrome.declarativeNetRequest.ResourceType;

interface CountryRuleEntry {
  ids: [number, number];
  country: string;
  ts: number;
}

type RuleMap = Record<string, CountryRuleEntry>;

// Hot path (every request) checks this set — kept in sync with settings via
// syncCountryBlocking() on boot and on every settings update.
let activeCountries = new Set<string>();
let ruleMapCache: RuleMap | null = null;
// Serializes rule-map mutations; concurrent requests to two new domains must
// not allocate the same rule ids.
let mutation: Promise<unknown> = Promise.resolve();

/**
 * Append a task to the serialized mutation chain. The task is wrapped so a
 * rejection (e.g. a DNR error) can never poison the chain — every member
 * resolves, so later mutations still run.
 */
function enqueue(task: () => Promise<void>): Promise<void> {
  const run = mutation.then(() => task().catch(() => {}));
  mutation = run;
  return run;
}

async function getRuleMap(): Promise<RuleMap> {
  if (!ruleMapCache) {
    try {
      const s = await chrome.storage.local.get(MAP_KEY);
      ruleMapCache = (s[MAP_KEY] as RuleMap | undefined) ?? {};
    } catch {
      ruleMapCache = {};
    }
  }
  return ruleMapCache;
}

async function saveRuleMap(): Promise<void> {
  if (!ruleMapCache) return;
  try {
    await chrome.storage.local.set({ [MAP_KEY]: ruleMapCache });
  } catch {
    // rules still active; map rebuilds on next mutation
  }
}

export async function syncCountryBlocking(settings?: Settings): Promise<void> {
  const s = settings ?? (await getSettings());
  activeCountries = new Set(s.blockedCountries.map((c) => c.toUpperCase()));

  // Drop rules for countries that are no longer blocked.
  const map = await getRuleMap();
  const stale = Object.entries(map).filter(([, e]) => !activeCountries.has(e.country));
  if (stale.length > 0) {
    const removeRuleIds = stale.flatMap(([, e]) => e.ids);
    for (const [domain] of stale) delete map[domain];
    await enqueue(async () => {
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [],
        removeRuleIds,
      });
    });
    await saveRuleMap();
  }
}

export function isCountryBlockingActive(): boolean {
  return activeCountries.size > 0;
}

export async function isCountryBlockedDomain(domain: string): Promise<boolean> {
  const map = await getRuleMap();
  return matchesDomainOrParent(domain, new Set(Object.keys(map)));
}

// Allocate ids from the dedicated country range, so they never collide with
// manual block/allow/pause rules (which allocate below COUNTRY_ID_BASE).
async function nextRuleIds(count: number): Promise<number[]> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const ids = rules.map((r) => r.id).filter((id) => id >= COUNTRY_ID_BASE);
  const maxId = ids.length > 0 ? Math.max(...ids) : COUNTRY_ID_BASE - 1;
  return Array.from({ length: count }, (_, i) => maxId + 1 + i);
}

/**
 * Called for every observed connection once its country is known. Adds the
 * blocking rule pair when the domain sits in a blocked country. Returns the
 * country code when a new rule was created (used for stats/badge).
 */
export async function noteConnection(
  domain: string,
  country: string | null | undefined,
): Promise<string | null> {
  if (!country) return null;
  const code = country.toUpperCase();
  if (!activeCountries.has(code)) return null;
  if (!domain || domain.includes(':')) return null;

  const settings = await getSettings();
  if (matchesDomainOrParent(domain, new Set(settings.customWhiteList))) return null;

  const map = await getRuleMap();
  if (map[domain]) return null;

  let created = false;
  await enqueue(async () => {
    // Re-check inside the lock: the country may have been unblocked between
    // the pre-check above and this task running.
    if (!activeCountries.has(code)) return;
    if (map[domain]) return;

    // LRU eviction to stay under the dynamic-rule budget.
    const entries = Object.entries(map);
    if (entries.length >= MAX_DOMAINS) {
      entries.sort((a, b) => a[1].ts - b[1].ts);
      const evicted = entries.slice(0, EVICT_BATCH);
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [],
        removeRuleIds: evicted.flatMap(([, e]) => e.ids),
      });
      for (const [d] of evicted) delete map[d];
    }

    const [blockId, redirectId] = await nextRuleIds(2);
    const warningUrl = chrome.runtime.getURL(
      `src/warning/index.html?blocked=${encodeURIComponent(domain)}` +
        `&reason=country&country=${encodeURIComponent(code)}`,
    );
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: blockId,
          priority: 1,
          action: { type: BLOCK_ACTION },
          condition: { urlFilter: `||${domain}` },
        },
        {
          id: redirectId,
          priority: 2,
          action: { type: REDIRECT_ACTION, redirect: { url: warningUrl } },
          condition: { urlFilter: `||${domain}`, resourceTypes: [MAIN_FRAME] },
        },
      ],
      removeRuleIds: [],
    });
    map[domain] = { ids: [blockId, redirectId], country: code, ts: Date.now() };
    created = true;
  });
  if (!created) return null;
  await saveRuleMap();
  return code;
}

export async function blockCountry(code: string): Promise<void> {
  const settings = await getSettings();
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return;
  if (!settings.blockedCountries.includes(upper)) {
    settings.blockedCountries.push(upper);
    await setSettings(settings);
  }
  await syncCountryBlocking(settings);
}

export async function unblockCountry(code: string): Promise<void> {
  const settings = await getSettings();
  const upper = code.toUpperCase();
  settings.blockedCountries = settings.blockedCountries.filter((c) => c !== upper);
  await setSettings(settings);
  await syncCountryBlocking(settings);
}

/** Per-country count of domains currently held by learning rules. */
export async function getCountryRuleStats(): Promise<Record<string, number>> {
  const map = await getRuleMap();
  const stats: Record<string, number> = {};
  for (const e of Object.values(map)) {
    stats[e.country] = (stats[e.country] ?? 0) + 1;
  }
  return stats;
}
