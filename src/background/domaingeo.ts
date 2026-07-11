import type { GeoData } from './geo';
import { resolveCountryCentroid } from './geo';

// ---------------------------------------------------------------------------
// Remembered domain → country, so a connection still shows its location when
// a later request to the same host is served from cache (webRequest reports
// no IP for cache hits, so the live geo lookup returns nothing). Everything
// stays on-device — we only cache what we already resolved locally, never
// send a domain anywhere.
// ---------------------------------------------------------------------------

interface StoredGeo {
  code: string;
  name: string | null;
}

const STORAGE_KEY = 'zg.domainGeo';
const MAX_ENTRIES = 5000;
const FLUSH_MS = 3000;

let cache: Record<string, StoredGeo> | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<Record<string, StoredGeo>> {
  if (cache) return cache;
  try {
    const s = await chrome.storage.local.get(STORAGE_KEY);
    cache = (s[STORAGE_KEY] as Record<string, StoredGeo> | undefined) ?? {};
  } catch {
    cache = {};
  }
  return cache;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!dirty || !cache) return;
    dirty = false;
    // Bound the map: drop arbitrary excess (all entries are equally cheap to
    // relearn on the next network hit).
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete cache[k];
    }
    void chrome.storage.local.set({ [STORAGE_KEY]: cache }).catch(() => {});
  }, FLUSH_MS);
}

/** Record a freshly-resolved country for a host. */
export async function rememberDomainGeo(host: string, geo: GeoData): Promise<void> {
  if (!geo.countryCode) return;
  const map = await load();
  const prev = map[host];
  if (prev && prev.code === geo.countryCode) return;
  map[host] = { code: geo.countryCode, name: geo.country ?? null };
  dirty = true;
  scheduleFlush();
}

/** Reconstruct a minimal GeoData from a previously-remembered country. */
export async function recallDomainGeo(host: string): Promise<GeoData | null> {
  const map = await load();
  const stored = map[host];
  if (!stored) return null;
  const centroid = resolveCountryCentroid(stored.code);
  return {
    country: stored.name ?? stored.code,
    countryCode: stored.code,
    flag: countryCodeToFlag(stored.code),
    lat: centroid ? centroid[0] : 0,
    lon: centroid ? centroid[1] : 0,
    org: null,
    isp: null,
    asn: null,
  };
}

function countryCodeToFlag(code: string): string {
  if (!code || code.length !== 2) return '🌐';
  return code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}
