import type { Connection, RiskLevel, TrackerDB, TrackerEntry } from '../types';
import trackerDB from '../data/trackers.json';
import malwareDB from '../data/malware.json';

const BUNDLED_TRACKERS: TrackerDB = trackerDB as TrackerDB;
const BUNDLED_MALWARE: Set<string> = new Set(malwareDB as string[]);

let TRACKERS: TrackerDB = BUNDLED_TRACKERS;
let MALWARE_SET: Set<string> = BUNDLED_MALWARE;

export function setTrackerOverride(db: TrackerDB | null): void {
  TRACKERS = db && Object.keys(db).length > 0 ? db : BUNDLED_TRACKERS;
}

export function setMalwareOverride(list: string[] | null): void {
  MALWARE_SET =
    list && list.length > 0 ? new Set(list) : BUNDLED_MALWARE;
}

const SUSPICIOUS_CATEGORIES = new Set([
  'advertising',
  'tracking',
  'analytics',
  'fingerprinting',
  'social',
]);

export function lookupTracker(domain: string): TrackerEntry | null {
  const direct = TRACKERS[domain];
  if (direct) return direct;

  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    const hit = TRACKERS[parent];
    if (hit) return hit;
  }
  return null;
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
  const list = Object.values(connections);
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
