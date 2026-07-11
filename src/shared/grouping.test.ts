import { describe, expect, it } from 'vitest';
import { groupByCompany, groupByCountry } from './grouping';
import type { Connection } from '../types';

function conn(over: Partial<Connection>): Connection {
  return {
    domain: 'x.com',
    company: null,
    category: null,
    country: null,
    countryName: null,
    flag: null,
    lat: null,
    lon: null,
    org: null,
    isp: null,
    asn: null,
    count: 1,
    riskLevel: 'safe',
    isBlocked: false,
    firstSeen: 0,
    lastSeen: 0,
    ...over,
  };
}

describe('groupByCountry', () => {
  it('groups connections by country and sums requests', () => {
    const groups = groupByCountry([
      conn({ domain: 'a', country: 'US', countryName: 'United States', count: 3 }),
      conn({ domain: 'b', country: 'US', countryName: 'United States', count: 2 }),
      conn({ domain: 'c', country: 'DE', countryName: 'Germany', count: 5 }),
    ]);
    const us = groups.find((g) => g.country === 'US')!;
    expect(us.domains).toHaveLength(2);
    expect(us.requests).toBe(5);
    expect(us.countryName).toBe('United States');
  });

  it('sorts by top risk, then request volume', () => {
    const groups = groupByCountry([
      conn({ domain: 'a', country: 'US', riskLevel: 'safe', count: 100 }),
      conn({ domain: 'b', country: 'DE', riskLevel: 'dangerous', count: 1 }),
    ]);
    expect(groups[0].country).toBe('DE'); // dangerous outranks high-volume safe
  });

  it('always places the unknown-country bucket last', () => {
    const groups = groupByCountry([
      conn({ domain: 'a', country: null, riskLevel: 'dangerous', count: 99 }),
      conn({ domain: 'b', country: 'US', riskLevel: 'safe', count: 1 }),
    ]);
    expect(groups[groups.length - 1].country).toBeNull();
  });
});

describe('groupByCompany', () => {
  it('buckets unknown company under a single key', () => {
    const groups = groupByCompany([
      conn({ domain: 'a', company: null }),
      conn({ domain: 'b', company: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].domains).toHaveLength(2);
  });

  it('carries the group top risk', () => {
    const groups = groupByCompany([
      conn({ domain: 'a', company: 'Ad Co', riskLevel: 'tracker' }),
      conn({ domain: 'b', company: 'Ad Co', riskLevel: 'suspicious' }),
    ]);
    expect(groups[0].topRisk).toBe('suspicious');
  });
});
