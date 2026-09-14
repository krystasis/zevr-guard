export type RiskLevel = 'safe' | 'tracker' | 'suspicious' | 'dangerous';

export interface Connection {
  domain: string;
  company: string | null;
  category: string | null;
  country: string | null;
  countryName: string | null;
  flag: string | null;
  lat: number | null;
  lon: number | null;
  org: string | null;
  isp: string | null;
  asn: string | null;
  count: number;
  riskLevel: RiskLevel;
  isBlocked: boolean;
  firstSeen: number;
  lastSeen: number;
}

export interface PageStats {
  tabId: number;
  url: string;
  host: string;
  connections: Record<string, Connection>;
  totalCount: number;
  blockedCount: number;
  riskScore: number;
  riskLevel: RiskLevel;
  lastUpdated: number;
}

export interface BlockCategories {
  advertising: boolean;
  tracking: boolean;
  malware: boolean;
  custom: boolean;
}

export interface Settings {
  blockingEnabled: boolean;
  notificationsEnabled: boolean;
  blockCategories: BlockCategories;
  customBlockList: string[];
  customWhiteList: string[];
  /** Hosts where blocking is paused (requests initiated by these sites are allowed). */
  pausedSites: string[];
  /** Warn when a password field is focused in a risky context. */
  passwordWarningsEnabled: boolean;
  /** ISO 3166-1 alpha-2 codes whose traffic is blocked (learning rules). */
  blockedCountries: string[];
}

export interface TrackerDomainInfo {
  count: number;
  company: string | null;
  category: string | null;
  country: string | null;
  countryName: string | null;
  riskLevel: 'tracker' | 'suspicious';
}

export interface TodayStats {
  date: string;
  totalConnections: number;
  blockedConnections: number;
  trackersDetected: number;
  dangerousDetected: number;
  companiesDetected: string[];
  companyCounts: Record<string, number>;
  trackerDomains: Record<string, TrackerDomainInfo>;
  blockedDomains: Record<string, number>;
}

export interface StorageData {
  pages: Record<number, PageStats>;
  settings: Settings;
  todayStats: TodayStats;
}

export interface TrackerEntry {
  company: string;
  category: string;
  prevalence?: number;
}

export type TrackerDB = Record<string, TrackerEntry>;

export interface UserLocation {
  lat: number;
  lng: number;
  countryCode: string;
  countryName: string;
}

export type MessageRequest =
  | { type: 'BLOCK_DOMAIN'; domain: string }
  | { type: 'UNBLOCK_DOMAIN'; domain: string }
  | { type: 'ALLOW_DOMAIN'; domain: string }
  | { type: 'ALLOW_AND_OPEN'; domain: string }
  | { type: 'GET_BLOCK_CONTEXT'; domain: string; country?: string }
  | { type: 'ALLOW_FOR_SESSION_AND_OPEN'; domain: string }
  | { type: 'DISALLOW_DOMAIN'; domain: string }
  | { type: 'PAUSE_SITE'; host: string }
  | { type: 'RESUME_SITE'; host: string }
  | { type: 'BYPASS_LOOKALIKE'; host: string }
  | { type: 'PASSWORD_CONTEXT'; host: string; isSecure: boolean }
  | { type: 'BLOCK_COUNTRY'; country: string }
  | { type: 'UNBLOCK_COUNTRY'; country: string }
  | { type: 'REPORT_PHISHING'; domain: string; context: string | null; alsoBlock?: boolean }
  | { type: 'GET_COUNTRY_STATS' }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Settings }
  | { type: 'GET_PAGE_STATS'; tabId: number }
  | { type: 'GET_TODAY_STATS' }
  | { type: 'GET_STATS_HISTORY' }
  | { type: 'GET_USER_LOCATION' }
  | { type: 'GET_WATCH' }
  | { type: 'ADD_WATCH'; kind: 'email' | 'phone' | 'custom'; value: string }
  | { type: 'REMOVE_WATCH'; id: string }
  | { type: 'GET_LEAKS' }
  | { type: 'CLEAR_LEAKS' };

/**
 * Per-domain provenance for the malware feed. `src` is omitted for domains
 * carried over from a seed that predates the metadata file.
 */
export interface MalwareMetaEntry {
  s?: 'u' | 't' | 'm';
  f: string;
}
export interface MalwareMeta {
  generatedAt: string;
  domains: Record<string, MalwareMetaEntry>;
}

/**
 * What the background knows about a domain the warning page is showing.
 * The warning page is web-accessible, so any site can deep-link it with
 * arbitrary params; every state-changing control on that page is gated on
 * this answer rather than on the params themselves.
 */
export interface BlockContext {
  /** True only when one of our own rule sources actually blocks this domain. */
  blockedByUs: boolean;
  source: 'feed' | 'manual' | 'country' | null;
  /** The http(s) URL this tab was heading to, when it is on `domain`. */
  url: string | null;
  /** True when the country in the params is really on the user's block list. */
  countryBlocked: boolean;
  /**
   * Set only for a feed block on a site the user has a history with: the
   * warning page then offers a softer, reversible way through instead of
   * treating it like a site they have never seen.
   */
  established: { since: number; n: number } | null;
  /** Which upstream list named this domain, and when it first appeared. */
  meta: { src: 'u' | 't' | 'm' | null; since: string } | null;
  /** When the threat list this verdict came from was built. */
  feedGeneratedAt: string | null;
}

/** A value the user asked Zevr Guard to watch for in outbound traffic. */
export interface WatchItem {
  id: string;
  kind: 'email' | 'phone' | 'custom';
  value: string;
}

/** A recorded data-exfiltration event (one watched value seen leaving). */
export interface LeakEvent {
  id: string;
  kind: 'email' | 'phone' | 'custom';
  display: string;
  destination: string;
  host: string;
  pageHost: string | null;
  ts: number;
}
