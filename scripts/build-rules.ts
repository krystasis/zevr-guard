import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOwner } from '../src/background/companies';
import { applySafelist, createSafelist } from './safelist';
import { FEED_MAX_DOMAINS } from '../src/shared/limits';
// `s` is omitted for domains carried over from a seed that predates this file:
// we do not know which feed first listed them, and guessing would put a wrong
// attribution in front of the user.
import type { MalwareMeta, MalwareMetaEntry } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const MALWARE_SEED_PATH = resolve(ROOT, 'src/data/malware.json');
// Tranco top sites (https://tranco-list.eu, snapshot 2026-07-18, top 10k).
// Feeds the safelist that keeps shared/popular sites out of the malware
// set — see scripts/safelist.ts and docs/sources/tranco.md.
const TRANCO_SNAPSHOT_PATH = resolve(ROOT, 'src/data/tranco.snapshot.json');
// Per-domain provenance for the malware set: which upstream source listed a
// domain and when it first appeared. Shown on the warning page so a block can
// be traced to something the user can look up, instead of being a bare verdict.
const MALWARE_META_PATH = resolve(ROOT, 'src/data/malware.meta.json');
// The popular-domain guard the extension itself applies to a downloaded feed.
// The build safelist protects what we publish; this protects the user when
// what arrives is not what we published.
const POPULAR_PATH = resolve(ROOT, 'src/data/popular.json');
const POPULAR_COUNT = 10_000;
const BLOCK_RULES_PATH = resolve(ROOT, 'public/rules/block_rules.json');
const ADS_RULES_PATH = resolve(ROOT, 'public/rules/ads_rules.json');
const TRACKING_RULES_PATH = resolve(ROOT, 'public/rules/tracking_rules.json');
const TRACKERS_SEED_PATH = resolve(ROOT, 'src/data/trackers.seed.json');
const TRACKERS_OUTPUT_PATH = resolve(ROOT, 'src/data/trackers.json');
const GEOLITE_COUNTRY_PATH = resolve(ROOT, 'assets/GeoLite2-Country.mmdb');
const GEOLITE_ASN_PATH = resolve(ROOT, 'assets/GeoLite2-ASN.mmdb');
const FLAGS_DIR = resolve(ROOT, 'assets/flags');
// Threat-feed publishing target.
// Defaults to ./lp/public/feed/v1 when present (local dev with LP checked out
// next to this repo). Override with FEED_PUBLISH_DIR to point CI elsewhere.
// When neither exists, feed publishing is skipped (extension build still works).
const LP_FEED_DIR =
  process.env.FEED_PUBLISH_DIR ?? resolve(ROOT, 'lp/public/feed/v1');
const LP_FEED_TRACKERS = resolve(LP_FEED_DIR, 'trackers.json');
const LP_FEED_MALWARE = resolve(LP_FEED_DIR, 'malware.json');
const LP_FEED_MALWARE_META = resolve(LP_FEED_DIR, 'malware.meta.json');
const LP_FEED_MANIFEST = resolve(LP_FEED_DIR, 'feed.json');

function feedPublishEnabled(): boolean {
  if (process.env.FEED_PUBLISH_DIR) return true;
  return existsSync(resolve(ROOT, 'lp'));
}

const URLHAUS_API = 'https://urlhaus.abuse.ch/downloads/hostfile/';
// Two static rules per domain, matching what the session mirror builds.
const STATIC_RULES_MAX = FEED_MAX_DOMAINS * 2;
// ThreatFox (also abuse.ch) shares URLhaus' permissive terms and adds C2 /
// botnet / payload-hosting IOCs that the URLhaus hostfile alone misses.
// The recent-IOC export is public; if abuse.ch requires an Auth-Key on the
// account, set THREATFOX_AUTH_KEY and it is sent as the documented header.
const THREATFOX_EXPORT = 'https://threatfox.abuse.ch/export/json/recent/';
const DDG_TDS_URL =
  'https://staticcdn.duckduckgo.com/trackerblocking/v5/current/ios-tds.json';
const DISCONNECT_URL = 'https://services.disconnect.me/disconnect.json';
const EASYPRIVACY_URL = 'https://easylist.to/easylist/easyprivacy.txt';
const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt';
const ADGUARD_TRACKING_URL =
  'https://filters.adtidy.org/extension/ublock/filters/3.txt';
const GHOSTERY_TRACKERDB_URL =
  'https://github.com/ghostery/trackerdb/releases/latest/download/trackerdb.json';

// Per-ruleset cap. Chrome MV3 gives a global safe limit of 30,000 enabled
// static rules, so we keep each category well under that to leave room for
// the malware ruleset and other extensions.
const CATEGORY_RULES_MAX = 25_000;

// First-party apex domains to *never* block, even if an upstream data source
// has categorised them as advertising/tracking (common for large ad-funded
// services). Subdomains carrying actual ads (e.g. pagead.googlesyndication.com)
// remain blockable because only the apex is allowlisted.
const GLOBAL_DOMAIN_ALLOWLIST = new Set<string>([
  'google.com',
  'www.google.com',
  'youtube.com',
  'www.youtube.com',
  'facebook.com',
  'www.facebook.com',
  'instagram.com',
  'amazon.com',
  'amazon.co.jp',
  'apple.com',
  'icloud.com',
  'microsoft.com',
  'office.com',
  'live.com',
  'bing.com',
  'x.com',
  'www.x.com',
  'twitter.com',
  'linkedin.com',
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'stackoverflow.com',
  'stackexchange.com',
  'reddit.com',
  'wikipedia.org',
  'cloudflare.com',
  'mozilla.org',
  'chromium.org',
  'wordpress.com',
  'paypal.com',
  'ebay.com',
  'yahoo.com',
  'yahoo.co.jp',
  'dropbox.com',
  'slack.com',
  'zoom.us',
  'pinterest.com',
  'tiktok.com',
  'spotify.com',
  'discord.com',
  'whatsapp.com',
  'telegram.org',
  'twitch.tv',
  'adobe.com',
  'netflix.com',
  'shopify.com',
  'stripe.com',
  'medium.com',
  'nytimes.com',
  'bbc.com',
  'bbc.co.uk',
  'duckduckgo.com',
  'bing.com',
  'openai.com',
  'chatgpt.com',
  'anthropic.com',
  'claude.ai',
]);
const GEOLITE_COUNTRY_URL =
  'https://github.com/P3TERX/GeoLite.mmdb/releases/latest/download/GeoLite2-Country.mmdb';
const GEOLITE_ASN_URL =
  'https://github.com/P3TERX/GeoLite.mmdb/releases/latest/download/GeoLite2-ASN.mmdb';
const TWEMOJI_BASE =
  'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg';

type BlockRule = {
  id: number;
  priority: number;
  action:
    | { type: 'block' }
    | { type: 'redirect'; redirect: { extensionPath: string } };
  condition: {
    urlFilter: string;
    // Omitted for block rules: the DNR default ("every type except
    // main_frame") also covers ping/beacon, object, csp_report,
    // webtransport, webbundle and other.
    resourceTypes?: string[];
  };
};

interface TrackerEntry {
  company: string;
  category: string;
  prevalence?: number;
}
type TrackerDB = Record<string, TrackerEntry>;

interface DDGTracker {
  domain?: string;
  owner?: { name?: string; displayName?: string };
  prevalence?: number;
  categories?: string[];
}

interface DDGEntity {
  displayName?: string;
  prevalence?: number;
  domains?: string[];
}

interface DDGTDS {
  trackers?: Record<string, DDGTracker>;
  entities?: Record<string, DDGEntity>;
  domains?: Record<string, string>;
}

async function fetchURLhausDomains(): Promise<string[]> {
  try {
    const res = await fetch(URLHAUS_API, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`URLhaus returned ${res.status}`);
    const text = await res.text();
    const domains = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/^127\.0\.0\.1\s+/, ''))
      .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d));
    return Array.from(new Set(domains));
  } catch (err) {
    console.warn(
      '[build-rules] URLhaus fetch failed, using seed list:',
      (err as Error).message,
    );
    return [];
  }
}

/** Extract a bare, blockable hostname from a ThreatFox IOC value. */
function hostFromIoc(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (!host) return null;
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }
  // Strip any leftover path or :port (domain:port IOCs).
  host = host.split('/')[0].split(':')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return null; // drops IPs too
  return host;
}

async function fetchThreatFoxDomains(): Promise<string[]> {
  try {
    const headers: Record<string, string> = {};
    if (process.env.THREATFOX_AUTH_KEY) {
      headers['Auth-Key'] = process.env.THREATFOX_AUTH_KEY;
    }
    const res = await fetch(THREATFOX_EXPORT, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`ThreatFox returned ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    const domains: string[] = [];
    // Export shape: { "<id>": [ { ioc_type, ioc/ioc_value, ... } ], ... }
    for (const entries of Object.values(data)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        const rec = e as { ioc_type?: string; ioc?: string; ioc_value?: string };
        const type = rec.ioc_type ?? '';
        if (type !== 'domain' && type !== 'url') continue;
        const host = hostFromIoc(rec.ioc_value ?? rec.ioc ?? '');
        if (host) domains.push(host);
      }
    }
    return Array.from(new Set(domains));
  } catch (err) {
    console.warn(
      '[build-rules] ThreatFox fetch failed, skipping source:',
      (err as Error).message,
    );
    return [];
  }
}

/** Interleave two ranked lists so both sources survive the malware cap. */
function interleave(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/**
 * Previous run's provenance, so "first listed" keeps meaning first — not
 * "first seen by the run that happened to write this file". The published
 * feed wins over the local build output: CI starts from a clean checkout.
 */
async function loadPreviousMeta(): Promise<Record<string, MalwareMetaEntry>> {
  for (const path of [LP_FEED_MALWARE_META, MALWARE_META_PATH]) {
    try {
      const raw = JSON.parse(await readFile(path, 'utf8')) as MalwareMeta;
      if (raw?.domains && typeof raw.domains === 'object') return raw.domains;
    } catch {
      // try next source
    }
  }
  return {};
}

function buildMalwareMeta(
  domains: string[],
  origin: Map<string, 'u' | 't'>,
  previous: Record<string, MalwareMetaEntry>,
  today: string,
): MalwareMeta {
  const out: Record<string, MalwareMetaEntry> = {};
  for (const domain of domains) {
    const before = previous[domain];
    // A domain carried over from the seed has no live source this run; keep
    // what it was first listed as, and leave it unset when even that is
    // unknown rather than inventing an attribution.
    const source = origin.get(domain) ?? before?.s;
    out[domain] = {
      ...(source ? { s: source } : {}),
      f: before?.f ?? today,
    };
  }
  return { generatedAt: new Date().toISOString(), domains: out };
}

async function loadTrancoSnapshot(): Promise<string[]> {
  const raw = await readFile(TRANCO_SNAPSHOT_PATH, 'utf8');
  const list = JSON.parse(raw) as unknown;
  if (!Array.isArray(list) || list.length < 1000) {
    // Refuse to build a feed without the guard rail rather than silently
    // shipping a popular-site block again.
    throw new Error(`[build-rules] tranco snapshot missing or too small: ${TRANCO_SNAPSHOT_PATH}`);
  }
  return list as string[];
}

async function loadSeedDomains(): Promise<string[]> {
  // MALWARE_SEED_PATH is a build output and gitignored, so it is absent on
  // clean checkouts (CI). Fall back to the previously published feed to keep
  // accumulating domains across runs, then to an empty seed.
  for (const path of [MALWARE_SEED_PATH, LP_FEED_MALWARE]) {
    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as string[];
    } catch {
      // try next source
    }
  }
  console.warn('[build-rules] no malware seed found, starting from fetched set only');
  return [];
}

function buildRules(domains: string[]): BlockRule[] {
  const rules: BlockRule[] = [];
  let id = 1;

  for (const domain of domains) {
    rules.push({
      id: id++,
      priority: 2,
      action: {
        type: 'redirect',
        redirect: {
          extensionPath: `/src/warning/index.html?blocked=${encodeURIComponent(domain)}`,
        },
      },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: ['main_frame'],
      },
    });

    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}`,
      },
    });

    if (rules.length >= STATIC_RULES_MAX) break;
  }

  return rules;
}

function mapDDGCategory(cats: string[] = []): string {
  const s = cats.map((c) => c.toLowerCase());
  if (s.some((c) => c.includes('fingerprint') || c.includes('session replay')))
    return 'fingerprinting';
  if (
    s.some(
      (c) =>
        c.includes('advertising') ||
        c.includes('ad motivated tracking') ||
        c.includes('ad fraud') ||
        c.includes('action pixels'),
    )
  )
    return 'advertising';
  if (
    s.some(
      (c) =>
        c.includes('analytics') ||
        c.includes('audience measurement') ||
        c.includes('third-party analytics'),
    )
  )
    return 'tracking';
  if (s.some((c) => c.includes('social'))) return 'social';
  if (s.some((c) => c.includes('tag manager'))) return 'tracking';
  if (s.some((c) => c.includes('cdn') || c.includes('content delivery'))) return 'cdn';
  if (s.some((c) => c.includes('maps'))) return 'maps';
  if (s.some((c) => c.includes('video') || c.includes('embedded'))) return 'embed';
  if (s.some((c) => c.includes('payment'))) return 'payment';
  if (s.some((c) => c.includes('consent'))) return 'consent';
  if (s.some((c) => c.includes('sso') || c.includes('federated login'))) return 'login';
  if (s.some((c) => c.includes('support chat') || c.includes('customer interaction')))
    return 'chat';
  return cats[0]?.toLowerCase() ?? 'other';
}

interface DisconnectJSON {
  categories?: Record<string, Array<Record<string, Record<string, string[]>>>>;
}

function mapDisconnectCategory(cat: string): string {
  const c = cat.toLowerCase();
  if (c.includes('advert')) return 'advertising';
  if (c.includes('analytic')) return 'tracking';
  if (c.includes('social')) return 'social';
  if (c.includes('fingerprint')) return 'fingerprinting';
  if (c.includes('session')) return 'fingerprinting';
  if (c.includes('crypto')) return 'cryptomining';
  if (c.includes('content')) return 'cdn';
  if (c.includes('disconnect')) return 'tracking';
  return 'tracking';
}

async function fetchDisconnectTrackers(): Promise<TrackerDB> {
  try {
    const res = await fetch(DISCONNECT_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Disconnect ${res.status}`);
    const data = (await res.json()) as DisconnectJSON;
    const db: TrackerDB = {};
    for (const [categoryName, entries] of Object.entries(data.categories ?? {})) {
      const category = mapDisconnectCategory(categoryName);
      for (const entry of entries) {
        for (const [companyName, companyMap] of Object.entries(entry)) {
          for (const [, domains] of Object.entries(companyMap)) {
            if (!Array.isArray(domains)) continue;
            for (const domain of domains) {
              if (typeof domain !== 'string') continue;
              const d = domain.toLowerCase();
              if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(d)) continue;
              if (!db[d]) db[d] = { company: companyName, category };
            }
          }
        }
      }
    }
    return db;
  } catch (err) {
    console.warn(
      '[build-rules] Disconnect fetch failed:',
      (err as Error).message,
    );
    return {};
  }
}

async function fetchABPDomains(
  url: string,
  sourceLabel: string,
): Promise<TrackerDB> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${sourceLabel} ${res.status}`);
    const text = await res.text();
    const db: TrackerDB = {};
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;
      if (line.startsWith('@@')) continue; // exception rules
      if (!line.startsWith('||')) continue; // domain anchors only
      const dollarIdx = line.indexOf('$');
      const head = dollarIdx >= 0 ? line.slice(2, dollarIdx) : line.slice(2);
      const cleaned = head.replace(/[/^*].*$/, '');
      if (!cleaned) continue;
      if (cleaned.includes('*') || cleaned.includes('/') || cleaned.includes('?')) continue;
      const d = cleaned.toLowerCase();
      if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(d)) continue;
      if (!db[d]) db[d] = { company: 'Unknown', category: 'tracking' };
    }
    return db;
  } catch (err) {
    console.warn(
      `[build-rules] ${sourceLabel} fetch failed:`,
      (err as Error).message,
    );
    return {};
  }
}

async function fetchEasyPrivacyDomains(): Promise<TrackerDB> {
  return fetchABPDomains(EASYPRIVACY_URL, 'EasyPrivacy');
}

async function fetchAdguardDomains(): Promise<TrackerDB> {
  return fetchABPDomains(ADGUARD_TRACKING_URL, 'AdGuard Tracking');
}

interface GhosteryPattern {
  name?: string;
  category?: string;
  organization?: string | null;
  domains?: string[];
}
interface GhosteryOrganization {
  name?: string;
}
interface GhosteryTrackerDB {
  patterns?: Record<string, GhosteryPattern>;
  organizations?: Record<string, GhosteryOrganization>;
  domains?: Record<string, string>; // domain -> pattern slug
}

function mapGhosteryCategory(category: string | undefined): string {
  const c = (category ?? '').toLowerCase();
  if (c === 'advertising') return 'advertising';
  if (c === 'pornvertising') return 'advertising';
  if (c === 'site_analytics') return 'tracking';
  if (c === 'social_media') return 'social';
  if (c === 'cdn' || c === 'hosting') return 'cdn';
  if (c === 'consent') return 'consent';
  if (c === 'customer_interaction') return 'chat';
  if (c === 'email') return 'tracking';
  if (c === 'audio_video_player') return 'embed';
  if (c === 'essential') return 'cdn';
  if (c === 'extensions') return 'tracking';
  if (c === 'misc') return 'tracking';
  if (c === 'telemetry') return 'tracking';
  if (c === 'adult_advertising') return 'advertising';
  if (c === 'fingerprinting' || c === 'session_replay') return 'fingerprinting';
  return 'tracking';
}

async function fetchGhosteryTrackers(): Promise<TrackerDB> {
  try {
    const res = await fetch(GHOSTERY_TRACKERDB_URL, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Ghostery ${res.status}`);
    const data = (await res.json()) as GhosteryTrackerDB;
    const db: TrackerDB = {};

    const orgName: Record<string, string> = {};
    for (const [slug, org] of Object.entries(data.organizations ?? {})) {
      orgName[slug] = org.name ?? slug;
    }

    const patternMeta: Record<
      string,
      { company: string; category: string }
    > = {};
    for (const [slug, p] of Object.entries(data.patterns ?? {})) {
      const company =
        (p.organization && orgName[p.organization]) ||
        p.name ||
        'Unknown';
      const category = mapGhosteryCategory(p.category);
      patternMeta[slug] = { company, category };
      for (const domain of p.domains ?? []) {
        if (typeof domain !== 'string') continue;
        const d = domain.toLowerCase();
        if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(d)) continue;
        if (!db[d]) db[d] = { company, category };
      }
    }
    for (const [domain, slug] of Object.entries(data.domains ?? {})) {
      const d = domain.toLowerCase();
      if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(d)) continue;
      if (db[d]) continue;
      const meta = patternMeta[slug];
      if (meta) db[d] = meta;
    }
    return db;
  } catch (err) {
    console.warn(
      '[build-rules] Ghostery trackerdb fetch failed:',
      (err as Error).message,
    );
    return {};
  }
}

async function fetchDDGTrackers(): Promise<TrackerDB> {
  const res = await fetch(DDG_TDS_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`DDG TDS ${res.status}`);
  const data = (await res.json()) as DDGTDS;

  const db: TrackerDB = {};
  const entityDisplayName: Record<string, string> = {};
  for (const [key, ent] of Object.entries(data.entities ?? {})) {
    entityDisplayName[key] = ent?.displayName ?? key;
  }

  for (const [domain, t] of Object.entries(data.trackers ?? {})) {
    const category = mapDDGCategory(t.categories);
    const company =
      t.owner?.displayName?.trim() ||
      t.owner?.name?.trim() ||
      'Unknown';
    db[domain] = {
      company,
      category,
      ...(typeof t.prevalence === 'number' ? { prevalence: t.prevalence } : {}),
    };
  }

  for (const [domain, entityKey] of Object.entries(data.domains ?? {})) {
    if (db[domain]) continue;
    db[domain] = {
      company: entityDisplayName[entityKey] ?? entityKey,
      category: 'other',
    };
  }

  return db;
}

async function buildTrackerDB(): Promise<TrackerDB> {
  let seed: TrackerDB = {};
  if (existsSync(TRACKERS_SEED_PATH)) {
    seed = JSON.parse(await readFile(TRACKERS_SEED_PATH, 'utf8')) as TrackerDB;
  } else {
    console.warn('[build-rules] trackers.seed.json not found, skipping seed');
  }

  let ddg: TrackerDB = {};
  try {
    ddg = await fetchDDGTrackers();
  } catch (err) {
    console.warn(
      '[build-rules] DDG Tracker Radar fetch failed:',
      (err as Error).message,
    );
  }

  const [disconnect, ghostery, adguard, easyPrivacy] = await Promise.all([
    fetchDisconnectTrackers(),
    fetchGhosteryTrackers(),
    fetchAdguardDomains(),
    fetchEasyPrivacyDomains(),
  ]);

  // Precedence (later wins): bare domains → richer metadata
  // seed > DDG (rich) > Ghostery (rich) > Disconnect (rich) > AdGuard (bare) > EasyPrivacy (bare)
  const merged: TrackerDB = {
    ...easyPrivacy,
    ...adguard,
    ...disconnect,
    ...ghostery,
    ...ddg,
    ...seed,
  };

  // ~90% of entries end up with company "Unknown" while a parent domain (or
  // the curated map) often names the owner. Resolve it here so every client
  // — including versions without the runtime fallback — gets real names.
  let resolved = 0;
  for (const [domain, entry] of Object.entries(merged)) {
    if (entry.company && entry.company !== 'Unknown') continue;
    let owner: string | null = null;
    const parts = domain.split('.');
    for (let i = 1; i < parts.length - 1 && !owner; i++) {
      const parent = merged[parts.slice(i).join('.')];
      if (parent && parent.company && parent.company !== 'Unknown') {
        owner = parent.company;
      }
    }
    owner ??= resolveOwner(domain, null);
    if (owner) {
      entry.company = owner;
      resolved++;
    }
  }
  console.log(`[build-rules] resolved owner for ${resolved} Unknown entries`);

  await ensureDir(TRACKERS_OUTPUT_PATH);
  const trackersJSON = JSON.stringify(merged);
  await writeFile(TRACKERS_OUTPUT_PATH, trackersJSON);

  if (feedPublishEnabled()) {
    await ensureDir(LP_FEED_TRACKERS);
    await writeFile(LP_FEED_TRACKERS, trackersJSON);
  }

  console.log(
    `[build-rules] trackers.json: ${Object.keys(merged).length} entries ` +
      `(seed ${Object.keys(seed).length} / DDG ${Object.keys(ddg).length} / ` +
      `Ghostery ${Object.keys(ghostery).length} / Disconnect ${Object.keys(disconnect).length} / ` +
      `AdGuard ${Object.keys(adguard).length} / EasyPrivacy ${Object.keys(easyPrivacy).length})`,
  );

  return merged;
}

async function fetchEasyListDomains(): Promise<TrackerDB> {
  return fetchABPDomains(EASYLIST_URL, 'EasyList');
}

function buildCategoryRules(domains: string[]): BlockRule[] {
  const rules: BlockRule[] = [];
  // NB: main_frame stays unblocked. Omitting resourceTypes matches every
  // other type (the DNR default), so these categories only block the
  // sub-resources ads / trackers pull in — including ping/beacon — while
  // the user is still free to navigate to the top-level page (matches
  // uBlock Origin behaviour for this list).
  let id = 1;
  for (const domain of domains) {
    if (GLOBAL_DOMAIN_ALLOWLIST.has(domain)) continue;
    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}`,
      },
    });
    if (rules.length >= CATEGORY_RULES_MAX) break;
  }
  return rules;
}

const TRACKING_CATEGORIES = new Set([
  'tracking',
  'analytics',
  'fingerprinting',
  'social',
]);

// Categories that describe infrastructure rather than advertising. When the
// tracker DB says a domain is one of these, an EasyList hit on it is an
// artefact of our own extraction, not a verdict about the domain.
const INFRASTRUCTURE_CATEGORIES = new Set([
  'cdn',
  'embed',
  'maps',
  'video',
  'payment',
  'consent',
  'login',
  'chat',
  'monitoring',
  'other',
]);

/**
 * A category block is a whole-domain block, so it needs evidence that the
 * domain really is what the list says. Without this, `||amazonaws.com`,
 * `||googleapis.com` and `||workers.dev` all ended up in the rulesets:
 * turning on "Advertising" would have broken every site serving assets from
 * S3 or Google's CDN — the same shared-host failure that put steamcommunity
 * in the malware list, one ruleset over.
 *
 * Evidence is a named owner, a category that is actually about advertising or
 * tracking, and some measured presence on the web — or simply being obscure
 * enough that a mistake costs little. The prevalence bar is deliberately low:
 * real ad networks measure well under 1% (taboola 0.034, outbrain 0.049), so
 * anything higher would throw them out along with the noise.
 */
function hasCategoryEvidence(
  domain: string,
  entry: TrackerEntry | undefined,
  popularRank: Map<string, number>,
): boolean {
  if (!popularRank.has(domain)) return true; // obscure: low blast radius
  if (!entry) return false; // popular and only EasyList says so
  if (INFRASTRUCTURE_CATEGORIES.has(entry.category)) return false;
  const known = !!entry.company && entry.company !== 'Unknown';
  return known && (entry.prevalence ?? 0) >= 0.01;
}

function collectAdvertisingDomains(
  trackers: TrackerDB,
  easyListDomains: TrackerDB,
  popularRank: Map<string, number>,
): string[] {
  const set = new Set<string>();
  for (const [domain, entry] of Object.entries(trackers)) {
    if (entry.category === 'advertising') set.add(domain);
  }
  for (const domain of Object.keys(easyListDomains)) set.add(domain);
  return Array.from(set)
    .filter((d) => hasCategoryEvidence(d, trackers[d], popularRank))
    .sort((a, b) => (trackers[b]?.prevalence ?? 0) - (trackers[a]?.prevalence ?? 0));
}

function collectTrackingDomains(
  trackers: TrackerDB,
  popularRank: Map<string, number>,
): string[] {
  const entries: Array<{ domain: string; prevalence: number }> = [];
  for (const [domain, entry] of Object.entries(trackers)) {
    if (!TRACKING_CATEGORIES.has(entry.category)) continue;
    if (!hasCategoryEvidence(domain, entry, popularRank)) continue;
    entries.push({ domain, prevalence: entry.prevalence ?? 0 });
  }
  // Higher prevalence first so the most-seen trackers win the per-ruleset cap.
  entries.sort((a, b) => b.prevalence - a.prevalence);
  return entries.map((e) => e.domain);
}

async function ensureDir(path: string): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function downloadFile(url: string, outPath: string): Promise<number> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  await ensureDir(outPath);
  await writeFile(outPath, buf);
  return buf.byteLength;
}

async function downloadGeoLite(): Promise<void> {
  try {
    const [cSize, aSize] = await Promise.all([
      downloadFile(GEOLITE_COUNTRY_URL, GEOLITE_COUNTRY_PATH),
      downloadFile(GEOLITE_ASN_URL, GEOLITE_ASN_PATH),
    ]);
    console.log(
      `[build-rules] GeoLite2: Country ${(cSize / 1024 / 1024).toFixed(1)}MB, ASN ${(aSize / 1024 / 1024).toFixed(1)}MB`,
    );
  } catch (err) {
    console.warn('[build-rules] GeoLite2 download failed:', (err as Error).message);
  }
}

function codeToTwemojiFilename(code: string): string {
  const chars = code.toUpperCase().split('');
  const codepoints = chars.map((c) =>
    (0x1f1e6 + c.charCodeAt(0) - 65).toString(16),
  );
  return codepoints.join('-') + '.svg';
}

async function downloadTwemojiFlags(): Promise<void> {
  const centroids = JSON.parse(
    await readFile(resolve(ROOT, 'src/data/country_centroids.json'), 'utf8'),
  ) as Record<string, [number, number]>;
  const codes = Object.keys(centroids);

  await ensureDir(resolve(FLAGS_DIR, '_'));

  const batchSize = 20;
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (code) => {
        const outPath = resolve(FLAGS_DIR, `${code.toLowerCase()}.svg`);
        if (existsSync(outPath)) {
          skipped += 1;
          return;
        }
        const url = `${TWEMOJI_BASE}/${codeToTwemojiFilename(code)}`;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) {
            failed += 1;
            return;
          }
          const text = await res.text();
          await writeFile(outPath, text);
          ok += 1;
        } catch {
          failed += 1;
        }
      }),
    );
  }

  console.log(
    `[build-rules] Twemoji flags: ${ok} downloaded, ${skipped} cached, ${failed} failed`,
  );
}

async function main(): Promise<void> {
  const [urlhaus, threatfox] = await Promise.all([
    fetchURLhausDomains(),
    fetchThreatFoxDomains(),
  ]);
  const seed = await loadSeedDomains();

  // Harmless test domain we operate for the hands-on tour at
  // zevrhq.com/tour — the EICAR of this feed. Listing it lets users watch
  // the auto-block work against a real (but safe) "threat" without ever
  // touching actual malware. First so the session-rule cap can't evict it.
  const TOUR_TEST_DOMAIN = 'zevr-tour-threat.krystasis12.workers.dev';

  // Interleave the two live feeds so ThreatFox's unique IOCs are not entirely
  // crowded out of the capped set by URLhaus, then top up from the seed.
  // Which live source listed each domain this run. URLhaus wins a tie: it is
  // the narrower, better-curated of the two.
  const origin = new Map<string, 'u' | 't'>();
  for (const d of threatfox) origin.set(d, 't');
  for (const d of urlhaus) origin.set(d, 'u');

  const merged = Array.from(
    new Set([TOUR_TEST_DOMAIN, ...interleave(urlhaus, threatfox), ...seed]),
  );

  // Upstream feeds list hosts, we block domains: a popular site that once
  // hosted one bad file (steamcommunity.com, t.me, cdn.jsdelivr.net) must
  // never become a whole-site block. Applied to the seed as well so an
  // entry that slipped through an older build cannot survive via carry-over.
  // Only the top ranks are protected outright: malware earns Tranco ranks of
  // its own further down (see scripts/safelist.ts). The band below is
  // reported instead, for a human to glance at.
  const tranco = await loadTrancoSnapshot();
  const popularRank = new Map(tranco.slice(0, 10_000).map((d, i) => [d, i + 1]));
  const safelist = createSafelist({
    popular: tranco,
    limit: 10_000,
    reviewLimit: 50_000,
  });
  const { kept, dropped } = applySafelist(merged, safelist);
  for (const d of dropped) {
    console.log(`[build-rules] safelist dropped ${d.host} (${d.reason})`);
  }
  for (const c of safelist.reviewCandidates(kept)) {
    console.log(
      `[build-rules] review: ${c.host} is blocked but ranks #${c.rank} — check it is not a mistake`,
    );
  }
  // Never publish more than the extension can actually turn into rules: the
  // surplus would be reported as dangerous while nothing blocked it.
  const capped = kept.slice(0, FEED_MAX_DOMAINS);

  console.log(
    `[build-rules] urlhaus ${urlhaus.length}, threatfox ${threatfox.length}, seed ${seed.length}, safelisted ${dropped.length}, ${capped.length} final`,
  );

  await writeFile(MALWARE_SEED_PATH, JSON.stringify(capped, null, 2) + '\n');

  await writeFile(POPULAR_PATH, JSON.stringify(tranco.slice(0, POPULAR_COUNT)));

  const meta = buildMalwareMeta(
    capped,
    origin,
    await loadPreviousMeta(),
    new Date().toISOString().slice(0, 10),
  );
  if (Object.keys(meta.domains).length !== capped.length) {
    throw new Error('[build-rules] malware meta does not cover the malware set');
  }
  await writeFile(MALWARE_META_PATH, JSON.stringify(meta, null, 2) + '\n');

  const rules = buildRules(capped);
  await ensureDir(BLOCK_RULES_PATH);
  await writeFile(BLOCK_RULES_PATH, JSON.stringify(rules, null, 2) + '\n');

  console.log(`[build-rules] wrote ${rules.length} rules`);

  if (feedPublishEnabled()) {
    await ensureDir(LP_FEED_MALWARE);
    await writeFile(LP_FEED_MALWARE, JSON.stringify(capped));
    await writeFile(LP_FEED_MALWARE_META, JSON.stringify(meta));
  }

  const trackers = await buildTrackerDB();
  await buildCategoryRulesets(trackers, popularRank);
  await writeFeedManifest();
  await downloadGeoLite();
  await downloadTwemojiFlags();
}

async function buildCategoryRulesets(
  trackers: TrackerDB,
  popularRank: Map<string, number>,
): Promise<void> {
  const easyList = await fetchEasyListDomains();

  const adsDomains = collectAdvertisingDomains(trackers, easyList, popularRank);
  const adsRules = buildCategoryRules(adsDomains);
  await ensureDir(ADS_RULES_PATH);
  await writeFile(ADS_RULES_PATH, JSON.stringify(adsRules, null, 2) + '\n');

  const trackingDomains = collectTrackingDomains(trackers, popularRank);
  const trackingRules = buildCategoryRules(trackingDomains);
  await ensureDir(TRACKING_RULES_PATH);
  await writeFile(
    TRACKING_RULES_PATH,
    JSON.stringify(trackingRules, null, 2) + '\n',
  );

  console.log(
    `[build-rules] ads_rules.json: ${adsRules.length} rules ` +
      `(pool ${adsDomains.length}, EasyList ${Object.keys(easyList).length})`,
  );
  console.log(
    `[build-rules] tracking_rules.json: ${trackingRules.length} rules ` +
      `(pool ${trackingDomains.length})`,
  );
}

async function writeFeedManifest(): Promise<void> {
  if (!feedPublishEnabled()) return;
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files: {
      trackers: 'trackers.json',
      malware: 'malware.json',
      malwareMeta: 'malware.meta.json',
    },
  };
  await ensureDir(LP_FEED_MANIFEST);
  await writeFile(LP_FEED_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
