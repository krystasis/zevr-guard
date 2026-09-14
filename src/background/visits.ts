import { registrableDomain } from './lookalike';

// First-seen tracking for the password guard's "first visit to this site"
// notice. Stores registrable domain -> first-seen timestamp, locally only,
// capped so the map cannot grow without bound.

const STORAGE_KEY = 'zg.seenHosts';
// Exact-hostname history, kept separately from the registrable-domain map
// above. The "established site" check cannot use that map: registrableDomain
// is a last-two-labels approximation, so every tenant of a hosting provider
// collapses onto one key — a single workers.dev site the user visits weekly
// would vouch for all 58 workers.dev phishing hosts in today's feed. Keying
// on the full hostname and only counting the blocked domain and what sits
// under it keeps one tenant from speaking for its neighbours.
const EXACT_KEY = 'zg.seenExactHosts';
const INSTALL_KEY = 'zg.installedAt';
const MAX_ENTRIES = 3000;
const MAX_EXACT_ENTRIES = 1500;
const FLUSH_MS = 2000;
// A visit still counts as "first" while the site was discovered this
// recently — long enough to reach the login form, short enough that a site
// used yesterday never warns.
const FRESH_MS = 10 * 60 * 1000;
// Right after install every site is unseen; stay quiet until the map has
// had time to learn the user's routine.
const LEARNING_MS = 48 * 60 * 60 * 1000;

// A site the user has actually settled into: old enough and used often
// enough that a sudden threat-feed listing is more likely to be a fresh
// compromise (or a mistake in the list) than a site they were tricked into
// visiting. Drives the warning page's softer variant.
const ESTABLISHED_MIN_VISITS = 3;
const ESTABLISHED_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Per domain: `first` (first-ever-seen, drives the freshness check), `last`
// (touched every visit, drives LRU eviction) and `n` (visit count, drives
// the established check). Keeping first-seen fixed is what lets isFreshVisit
// tell a genuinely new site apart from a routine one; evicting by last
// activity is what keeps routine sites from being dropped and then mistaken
// for new on the next visit.
interface SeenEntry {
  first: number;
  last: number;
  n: number;
}

export interface VisitRecord {
  first: number;
  last: number;
  n: number;
}

let cache: Record<string, SeenEntry> | null = null;
let exactCache: Record<string, SeenEntry> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function getSeen(): Promise<Record<string, SeenEntry>> {
  if (cache) return cache;
  try {
    const s = await chrome.storage.local.get(STORAGE_KEY);
    const raw = s[STORAGE_KEY] as
      | Record<string, (Omit<SeenEntry, 'n'> & { n?: number }) | number>
      | undefined;
    cache = {};
    // Migrate the old shapes: a bare timestamp, then {first,last} without a
    // count. Both become one recorded visit, which is the most we can honestly
    // claim about them.
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (typeof v === 'number') cache[k] = { first: v, last: v, n: 1 };
      else cache[k] = { first: v.first, last: v.last, n: v.n ?? 1 };
    }
  } catch {
    cache = {};
  }
  return cache;
}

async function getExact(): Promise<Record<string, SeenEntry>> {
  if (exactCache) return exactCache;
  try {
    const s = await chrome.storage.local.get(EXACT_KEY);
    exactCache = (s[EXACT_KEY] as Record<string, SeenEntry> | undefined) ?? {};
  } catch {
    exactCache = {};
  }
  return exactCache;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void (async () => {
      if (!cache) return;
      const entries = Object.entries(cache);
      if (entries.length > MAX_ENTRIES) {
        // Evict least-recently-active, not oldest-discovered.
        entries.sort((a, b) => b[1].last - a[1].last);
        cache = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
      }
      if (exactCache) {
        const exact = Object.entries(exactCache);
        if (exact.length > MAX_EXACT_ENTRIES) {
          exact.sort((a, b) => b[1].last - a[1].last);
          exactCache = Object.fromEntries(exact.slice(0, MAX_EXACT_ENTRIES));
        }
      }
      try {
        await chrome.storage.local.set({
          [STORAGE_KEY]: cache,
          ...(exactCache ? { [EXACT_KEY]: exactCache } : {}),
        });
      } catch {
        // best-effort
      }
    })();
  }, FLUSH_MS);
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

function touch(map: Record<string, SeenEntry>, key: string, now: number): void {
  const entry = map[key];
  if (entry) {
    entry.last = now; // touch for LRU; keep first fixed
    entry.n += 1;
  } else {
    map[key] = { first: now, last: now, n: 1 };
  }
}

export async function recordVisit(host: string): Promise<void> {
  const normalized = normalizeHost(host);
  const domain = registrableDomain(normalized);
  if (!domain) return;
  const now = Date.now();
  touch(await getSeen(), domain, now);
  touch(await getExact(), normalized, now);
  scheduleFlush();
}

export async function markInstalled(): Promise<void> {
  try {
    const s = await chrome.storage.local.get(INSTALL_KEY);
    if (!s[INSTALL_KEY]) {
      await chrome.storage.local.set({ [INSTALL_KEY]: Date.now() });
    }
  } catch {
    // best-effort
  }
}

/** True when the domain was first seen only minutes ago. */
export async function isFreshVisit(host: string): Promise<boolean> {
  try {
    const s = await chrome.storage.local.get(INSTALL_KEY);
    const installedAt = (s[INSTALL_KEY] as number | undefined) ?? 0;
    if (!installedAt || Date.now() - installedAt < LEARNING_MS) return false;
  } catch {
    return false;
  }

  const domain = registrableDomain(host.toLowerCase());
  if (!domain) return false;
  const seen = await getSeen();
  const entry = seen[domain];
  return entry !== undefined && Date.now() - entry.first < FRESH_MS;
}

/**
 * The user's history with exactly this site: visits to the domain itself and
 * to anything under it, and nothing else. `evil.workers.dev` therefore never
 * inherits the history of another workers.dev tenant.
 */
export async function getVisitRecord(host: string): Promise<VisitRecord | null> {
  const domain = normalizeHost(host);
  if (!domain) return null;
  const exact = await getExact();
  let first = Infinity;
  let last = 0;
  let n = 0;
  for (const [seenHost, entry] of Object.entries(exact)) {
    if (seenHost !== domain && !seenHost.endsWith(`.${domain}`)) continue;
    first = Math.min(first, entry.first);
    last = Math.max(last, entry.last);
    n += entry.n;
  }
  return n > 0 ? { first, last, n } : null;
}

/**
 * True when the user has a real track record with this site: first seen at
 * least a week ago and visited a few times since, with the extension itself
 * installed long enough for that history to mean anything.
 */
export async function isEstablishedSite(host: string): Promise<boolean> {
  try {
    const s = await chrome.storage.local.get(INSTALL_KEY);
    const installedAt = (s[INSTALL_KEY] as number | undefined) ?? 0;
    if (!installedAt || Date.now() - installedAt < LEARNING_MS) return false;
  } catch {
    return false;
  }
  const entry = await getVisitRecord(host);
  if (!entry) return false;
  return (
    entry.n >= ESTABLISHED_MIN_VISITS &&
    Date.now() - entry.first >= ESTABLISHED_MIN_AGE_MS
  );
}
