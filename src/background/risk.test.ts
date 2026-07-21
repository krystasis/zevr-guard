import { afterEach, describe, expect, it } from 'vitest';
import {
  calcRiskScore,
  lookupTracker,
  pageRiskLevel,
  scoreToRiskLevel,
  setTrackerOverride,
} from './risk';
import { resolveOwner } from './companies';
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

describe('pageRiskLevel', () => {
  it('keeps heavy but ordinary tracking in the tracker tier', () => {
    const conns = toMap(
      Array.from({ length: 30 }, () =>
        conn({ riskLevel: 'suspicious', category: 'advertising' }),
      ),
    );
    const score = calcRiskScore(conns);
    expect(score).toBeGreaterThanOrEqual(40); // would read "suspicious" by score alone
    expect(pageRiskLevel(score, conns)).toBe('tracker');
  });

  it('flags the page when a dangerous connection is present', () => {
    const conns = toMap([
      conn({ riskLevel: 'dangerous' }),
      conn({ riskLevel: 'safe' }),
    ]);
    expect(pageRiskLevel(calcRiskScore(conns), conns)).toBe('suspicious');
  });

  it('calms down once the dangerous connection is blocked', () => {
    const conns = toMap([conn({ riskLevel: 'dangerous', isBlocked: true })]);
    expect(pageRiskLevel(calcRiskScore(conns), conns)).toBe('safe');
  });
});

describe('lookupTracker', () => {
  afterEach(() => setTrackerOverride(null));

  it('borrows the owner from a parent entry when the hit says Unknown', () => {
    setTrackerOverride({
      'g.doubleclick.net': { company: 'Unknown', category: 'advertising' },
      'doubleclick.net': { company: 'Google', category: 'advertising' },
    });
    const hit = lookupTracker('cm.g.doubleclick.net');
    expect(hit?.company).toBe('Google');
    expect(hit?.category).toBe('advertising');
  });

  it('keeps the most specific category while resolving the owner', () => {
    setTrackerOverride({
      'files.bbci.co.uk': { company: 'Unknown', category: 'tracking' },
      'bbci.co.uk': { company: 'BBC', category: 'cdn' },
    });
    const hit = lookupTracker('static.files.bbci.co.uk');
    expect(hit?.company).toBe('BBC');
    expect(hit?.category).toBe('tracking');
  });

  it('returns the direct hit untouched when its owner is known', () => {
    setTrackerOverride({
      'pagead2.googlesyndication.com': { company: 'Google', category: 'advertising' },
      'googlesyndication.com': { company: 'Other', category: 'cdn' },
    });
    expect(lookupTracker('pagead2.googlesyndication.com')?.company).toBe('Google');
  });
});

describe('resolveOwner', () => {
  it('prefers a real DB company', () => {
    expect(resolveOwner('x.doubleclick.net', 'Acme')).toBe('Acme');
  });

  it('falls back to the curated map for Unknown', () => {
    expect(resolveOwner('x.doubleclick.net', 'Unknown')).toBe('Google');
    expect(resolveOwner('tag.yjtag.jp', null)).toBe('LY Corporation');
  });

  it('returns null instead of the literal Unknown', () => {
    expect(resolveOwner('tracker.example-nowhere.dev', 'Unknown')).toBeNull();
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
