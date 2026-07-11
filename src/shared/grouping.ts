import type { Connection, RiskLevel } from '../types';

// Shared connection-grouping used by both the popup and the side panel.

export const RISK_ORDER: Record<RiskLevel, number> = {
  dangerous: 0,
  suspicious: 1,
  tracker: 2,
  safe: 3,
};

function topRisk(connections: Connection[]): RiskLevel {
  return connections.reduce<RiskLevel>(
    (top, c) => (RISK_ORDER[c.riskLevel] < RISK_ORDER[top] ? c.riskLevel : top),
    'safe',
  );
}

export interface CompanyGroup {
  company: string;
  domains: Connection[];
  requests: number;
  topRisk: RiskLevel;
}

export function groupByCompany(connections: Connection[]): CompanyGroup[] {
  const map = new Map<string, Connection[]>();
  for (const c of connections) {
    const key = c.company ?? '(unknown)';
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([company, arr]) => ({
      company,
      domains: arr,
      requests: arr.reduce((s, c) => s + c.count, 0),
      topRisk: topRisk(arr),
    }))
    .sort(
      (a, b) =>
        RISK_ORDER[a.topRisk] - RISK_ORDER[b.topRisk] || b.requests - a.requests,
    );
}

export interface CountryGroup {
  country: string | null;
  countryName: string | null;
  domains: Connection[];
  requests: number;
  topRisk: RiskLevel;
}

export function groupByCountry(connections: Connection[]): CountryGroup[] {
  const map = new Map<string, Connection[]>();
  for (const c of connections) {
    const key = c.country ?? '';
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([country, arr]) => ({
      country: country || null,
      countryName: arr.find((c) => c.countryName)?.countryName ?? null,
      domains: arr,
      requests: arr.reduce((s, c) => s + c.count, 0),
      topRisk: topRisk(arr),
    }))
    .sort((a, b) => {
      // Unknown-country bucket always last.
      if (!a.country !== !b.country) return a.country ? -1 : 1;
      return RISK_ORDER[a.topRisk] - RISK_ORDER[b.topRisk] || b.requests - a.requests;
    });
}
