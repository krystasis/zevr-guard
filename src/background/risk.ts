import type { Connection, RiskLevel, TrackerDB, TrackerEntry } from '../types';
// The tracker DB is ~8MB; import it as an asset URL instead of inlining it
// into the service-worker bundle, which made every SW cold start re-parse
// 8MB of JavaScript. It is fetched lazily and skipped entirely once a feed
// override is active.
import trackersUrl from '../data/trackers.json?url';
import malwareDB from '../data/malware.json';
import { readCachedTrackers } from './feedcache';

const BUNDLED_MALWARE: Set<string> = new Set(malwareDB as string[]);

let BUNDLED_TRACKERS: TrackerDB | null = null;
let TRACKERS: TrackerDB | null = null;
let MALWARE_SET: Set<string> = BUNDLED_MALWARE;
let trackersLoading: Promise<void> | null = null;

/**
 * Resolve the active tracker DB. Returns immediately when a feed override
 * (or a previous load) is in place; otherwise loads the cached feed, and
 * falls back to the bundled JSON when no feed has been downloaded yet.
 */
export function ensureTrackerDB(): Promise<void> {
  if (TRACKERS) return Promise.resolve();
  if (BUNDLED_TRACKERS) {
    TRACKERS = BUNDLED_TRACKERS;
    return Promise.resolve();
  }
  if (!trackersLoading) {
    trackersLoading = (async () => {
      // The cached feed is fresher than the bundled DB; fall through when
      // it is absent or unreadable.
      const feed = await readCachedTrackers();
      if (feed) {
        if (!TRACKERS) TRACKERS = feed;
        return;
      }
      const db = (await (await fetch(trackersUrl)).json()) as TrackerDB;
      BUNDLED_TRACKERS = db;
      if (!TRACKERS) TRACKERS = db;
    })().catch((err) => {
      console.warn('[Zevr Guard] tracker DB load failed:', err);
      trackersLoading = null;
    });
  }
  return trackersLoading;
}

export function setTrackerOverride(db: TrackerDB | null): void {
  TRACKERS = db && Object.keys(db).length > 0 ? db : BUNDLED_TRACKERS;
  // The bundled DB may never have been fetched (the cached feed usually
  // wins); let ensureTrackerDB run again instead of latching onto null.
  if (!TRACKERS) trackersLoading = null;
}

export function setMalwareOverride(list: string[] | null): void {
  MALWARE_SET =
    list && list.length > 0 ? new Set(list) : BUNDLED_MALWARE;
}

export function getMalwareDomains(): string[] {
  return Array.from(MALWARE_SET);
}

const SUSPICIOUS_CATEGORIES = new Set([
  'advertising',
  'tracking',
  'analytics',
  'fingerprinting',
  'social',
]);

function hasKnownCompany(entry: TrackerEntry): boolean {
  return !!entry.company && entry.company !== 'Unknown';
}

export function lookupTracker(domain: string): TrackerEntry | null {
  if (!TRACKERS) return null;

  // Most-specific entry wins for category/prevalence, but ~90% of feed
  // entries carry company "Unknown" while a parent domain often names the
  // owner (cm.g.doubleclick.net -> doubleclick.net "Google"). Keep walking
  // up until a known company fills the gap.
  let hit: TrackerEntry | null = TRACKERS[domain] ?? null;
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (hit && hasKnownCompany(hit)) break;
    const parent = TRACKERS[parts.slice(i).join('.')];
    if (!parent) continue;
    if (!hit) {
      hit = parent;
    } else if (hasKnownCompany(parent)) {
      hit = { ...hit, company: parent.company };
    }
  }
  return hit;
}

export function isMalware(domain: string): boolean {
  if (MALWARE_SET.has(domain)) return true;
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (MALWARE_SET.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

export function getRiskLevel(domain: string): RiskLevel {
  if (isMalware(domain)) return 'dangerous';

  const tracker = lookupTracker(domain);
  if (tracker) {
    if (SUSPICIOUS_CATEGORIES.has(tracker.category)) return 'suspicious';
    return 'tracker';
  }
  return 'safe';
}

function categoryWeight(category: string | null): number {
  switch (category?.toLowerCase()) {
    case 'fingerprinting':
      return 8;
    case 'advertising':
      return 4;
    case 'social':
      return 4;
    case 'tracking':
    case 'analytics':
      return 3;
    // infrastructure-level (riskLevel='tracker')
    case 'cdn':
    case 'embed':
    case 'maps':
    case 'video':
    case 'payment':
    case 'consent':
    case 'login':
    case 'chat':
    case 'monitoring':
      return 0.5;
    default:
      return 1;
  }
}

export function calcRiskScore(connections: Record<string, Connection>): number {
  // Blocked connections are neutralized — the score reflects actual exposure.
  const list = Object.values(connections).filter((c) => !c.isBlocked);
  const dangerousCount = list.filter((c) => c.riskLevel === 'dangerous').length;

  if (dangerousCount >= 3) return 100;
  if (dangerousCount === 2) return 85;

  let weight = 0;
  for (const c of list) {
    if (c.riskLevel === 'dangerous' || c.riskLevel === 'safe') continue;
    weight += categoryWeight(c.category);
  }

  const base = Math.min(65, Math.sqrt(weight) * 5.2);

  if (dangerousCount === 1) {
    return Math.round(Math.max(55, Math.min(75, 55 + base * 0.3)));
  }
  return Math.round(base);
}

export function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 80) return 'dangerous';
  if (score >= 40) return 'suspicious';
  if (score >= 10) return 'tracker';
  return 'safe';
}
