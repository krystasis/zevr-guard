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
  | { type: 'DISALLOW_DOMAIN'; domain: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Settings }
  | { type: 'GET_PAGE_STATS'; tabId: number }
  | { type: 'GET_TODAY_STATS' }
  | { type: 'GET_USER_LOCATION' };
