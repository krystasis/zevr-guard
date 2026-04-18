import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const MALWARE_SEED_PATH = resolve(ROOT, 'src/data/malware.json');
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
const LP_FEED_MANIFEST = resolve(LP_FEED_DIR, 'feed.json');

function feedPublishEnabled(): boolean {
  if (process.env.FEED_PUBLISH_DIR) return true;
  return existsSync(resolve(ROOT, 'lp'));
}

const URLHAUS_API = 'https://urlhaus.abuse.ch/downloads/hostfile/';
const URLHAUS_MAX = 5000;
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
    resourceTypes: string[];
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

async function loadSeedDomains(): Promise<string[]> {
  const raw = await readFile(MALWARE_SEED_PATH, 'utf8');
  return JSON.parse(raw) as string[];
}

function buildRules(domains: string[]): BlockRule[] {
  const rules: BlockRule[] = [];
  let id = 1;
  const subResources = [
    'script',
    'image',
    'xmlhttprequest',
    'sub_frame',
    'stylesheet',
    'font',
    'media',
    'websocket',
  ];

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
        resourceTypes: subResources,
      },
    });

    if (rules.length >= URLHAUS_MAX) break;
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
  // NB: main_frame is deliberately excluded. These categories only block the
  // sub-resources ads / trackers pull in; the user is still free to navigate
  // to the top-level page (matches uBlock Origin behaviour for this list).
  const resourceTypes = [
    'script',
    'image',
    'xmlhttprequest',
    'sub_frame',
    'stylesheet',
    'font',
    'media',
    'websocket',
  ];
  let id = 1;
  for (const domain of domains) {
    if (GLOBAL_DOMAIN_ALLOWLIST.has(domain)) continue;
    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes,
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

function collectAdvertisingDomains(
  trackers: TrackerDB,
  easyListDomains: TrackerDB,
): string[] {
  const set = new Set<string>();
  for (const [domain, entry] of Object.entries(trackers)) {
    if (entry.category === 'advertising') set.add(domain);
  }
  for (const domain of Object.keys(easyListDomains)) set.add(domain);
  return Array.from(set).sort();
}

function collectTrackingDomains(trackers: TrackerDB): string[] {
  const entries: Array<{ domain: string; prevalence: number }> = [];
  for (const [domain, entry] of Object.entries(trackers)) {
    if (!TRACKING_CATEGORIES.has(entry.category)) continue;
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
  const fetched = await fetchURLhausDomains();
  const seed = await loadSeedDomains();

  const merged = Array.from(new Set([...fetched, ...seed]));
  const capped = merged.slice(0, Math.floor(URLHAUS_MAX / 2));

  console.log(
    `[build-rules] ${fetched.length} fetched, ${seed.length} seed, ${capped.length} final`,
  );

  await writeFile(MALWARE_SEED_PATH, JSON.stringify(capped, null, 2) + '\n');

  const rules = buildRules(capped);
  await ensureDir(BLOCK_RULES_PATH);
  await writeFile(BLOCK_RULES_PATH, JSON.stringify(rules, null, 2) + '\n');

  console.log(`[build-rules] wrote ${rules.length} rules`);

  if (feedPublishEnabled()) {
    await ensureDir(LP_FEED_MALWARE);
    await writeFile(LP_FEED_MALWARE, JSON.stringify(capped));
  }

  const trackers = await buildTrackerDB();
  await buildCategoryRulesets(trackers);
  await writeFeedManifest();
  await downloadGeoLite();
  await downloadTwemojiFlags();
}

async function buildCategoryRulesets(trackers: TrackerDB): Promise<void> {
  const easyList = await fetchEasyListDomains();

  const adsDomains = collectAdvertisingDomains(trackers, easyList);
  const adsRules = buildCategoryRules(adsDomains);
  await ensureDir(ADS_RULES_PATH);
  await writeFile(ADS_RULES_PATH, JSON.stringify(adsRules, null, 2) + '\n');

  const trackingDomains = collectTrackingDomains(trackers);
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
    },
  };
  await ensureDir(LP_FEED_MANIFEST);
  await writeFile(LP_FEED_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
