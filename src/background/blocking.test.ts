import { describe, expect, it } from 'vitest';
import { matchesDomainOrParent } from './blocking';

describe('matchesDomainOrParent', () => {
  it('matches an exact domain', () => {
    expect(matchesDomainOrParent('evil.com', new Set(['evil.com']))).toBe(true);
  });

  it('matches a subdomain against a blocked parent', () => {
    const set = new Set(['tracker.com']);
    expect(matchesDomainOrParent('ads.tracker.com', set)).toBe(true);
    expect(matchesDomainOrParent('a.b.tracker.com', set)).toBe(true);
  });

  it('does not match a parent against a blocked subdomain', () => {
    // Blocking ads.tracker.com must not block tracker.com itself.
    expect(matchesDomainOrParent('tracker.com', new Set(['ads.tracker.com']))).toBe(
      false,
    );
  });

  it('does not match an unrelated sibling', () => {
    expect(matchesDomainOrParent('nottracker.com', new Set(['tracker.com']))).toBe(
      false,
    );
  });

  it('does not treat the public suffix as a blockable parent', () => {
    // Walking parents must stop before the bare TLD, or blocking one .com
    // domain would leak to every .com.
    expect(matchesDomainOrParent('other.com', new Set(['com']))).toBe(false);
  });

  it('returns false for an empty set', () => {
    expect(matchesDomainOrParent('evil.com', new Set())).toBe(false);
  });
});
