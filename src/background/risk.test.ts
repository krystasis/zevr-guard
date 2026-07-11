import { describe, expect, it } from 'vitest';
import { calcRiskScore, scoreToRiskLevel } from './risk';
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

function toMap(list: Connection[]): Record<string, Connection> {
  return Object.fromEntries(list.map((c, i) => [`${c.domain}-${i}`, c]));
}

describe('calcRiskScore', () => {
  it('is zero with no risky connections', () => {
    expect(calcRiskScore(toMap([conn({ riskLevel: 'safe' })]))).toBe(0);
  });

  it('caps at 100 for three or more dangerous connections', () => {
    const list = [1, 2, 3].map(() => conn({ riskLevel: 'dangerous' }));
    expect(calcRiskScore(toMap(list))).toBe(100);
  });

  it('excludes blocked connections from the score', () => {
    const list = [1, 2, 3].map(() =>
      conn({ riskLevel: 'dangerous', isBlocked: true }),
    );
    // All dangerous but blocked -> neutralized -> score 0.
    expect(calcRiskScore(toMap(list))).toBe(0);
  });

  it('grows with more suspicious connections', () => {
    const few = calcRiskScore(
      toMap([conn({ riskLevel: 'suspicious', category: 'advertising' })]),
    );
    const many = calcRiskScore(
      toMap(
        Array.from({ length: 8 }, () =>
          conn({ riskLevel: 'suspicious', category: 'advertising' }),
        ),
      ),
    );
    expect(many).toBeGreaterThan(few);
  });
});

describe('scoreToRiskLevel', () => {
  it.each([
    [0, 'safe'],
    [9, 'safe'],
    [10, 'tracker'],
    [39, 'tracker'],
    [40, 'suspicious'],
    [79, 'suspicious'],
    [80, 'dangerous'],
    [100, 'dangerous'],
  ] as const)('%i -> %s', (score, level) => {
    expect(scoreToRiskLevel(score)).toBe(level);
  });
});
