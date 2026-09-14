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

// --- session allow rules -----------------------------------------------------
// These live above SESSION_ALLOW_ID_BASE so the feed mirror, which rewrites its
// own range on every refresh, cannot wipe the user's "continue this time".

interface StubRule {
  id: number;
  priority: number;
  action: { type: string };
  condition: { urlFilter?: string; resourceTypes?: string[] };
}

function stubSessionRules(initial: StubRule[] = []) {
  let rules = [...initial];
  (globalThis as unknown as { chrome: Record<string, unknown> }).chrome = {
    ...(globalThis as unknown as { chrome: Record<string, unknown> }).chrome,
    declarativeNetRequest: {
      getSessionRules: async () => rules,
      updateSessionRules: async (o: { removeRuleIds?: number[]; addRules?: StubRule[] }) => {
        const remove = new Set(o.removeRuleIds ?? []);
        rules = rules.filter((r) => !remove.has(r.id)).concat(o.addRules ?? []);
      },
    },
  };
  return () => rules;
}

describe('allowDomainForSession', () => {
  it('allocates above the feed range and is idempotent', async () => {
    const read = stubSessionRules([
      { id: 1, priority: 2, action: { type: 'redirect' }, condition: { urlFilter: '||feed.example' } },
    ]);
    const { allowDomainForSession, getSessionAllowedDomains, SESSION_ALLOW_ID_BASE } =
      await import('./blocking');

    await allowDomainForSession('example.com');
    const added = read().filter((r) => r.id >= SESSION_ALLOW_ID_BASE);
    expect(added).toHaveLength(1);
    expect(added[0].condition.urlFilter).toBe('||example.com');
    expect(added[0].action.type).toBe('allow');
    // Must outrank the feed's redirect (priority 2) and block (priority 1).
    expect(added[0].priority).toBeGreaterThan(2);
    expect(added[0].condition.resourceTypes).toContain('main_frame');

    await allowDomainForSession('example.com');
    expect(read().filter((r) => r.id >= SESSION_ALLOW_ID_BASE)).toHaveLength(1);
    expect(await getSessionAllowedDomains()).toEqual(new Set(['example.com']));
    // The feed rule is untouched.
    expect(read().some((r) => r.id === 1)).toBe(true);
  });

  it('leaves the global pause rule alone', async () => {
    const { SESSION_GLOBAL_ID_BASE } = await import('./blocking');
    const read = stubSessionRules([
      {
        id: SESSION_GLOBAL_ID_BASE,
        priority: 1000,
        action: { type: 'allow' },
        condition: { urlFilter: '*' },
      },
    ]);
    const { allowDomainForSession, getSessionAllowedDomains } = await import('./blocking');

    await allowDomainForSession('example.com');
    // The pause rule is neither evicted nor treated as the id high-water mark.
    expect(read().some((r) => r.id === SESSION_GLOBAL_ID_BASE)).toBe(true);
    const added = read().find((r) => r.condition.urlFilter === '||example.com');
    expect(added?.id).toBeLessThan(SESSION_GLOBAL_ID_BASE);
    // ...nor reported as a domain the user allowed.
    expect(await getSessionAllowedDomains()).toEqual(new Set(['example.com']));
  });

  it('evicts the oldest once the budget is spent', async () => {
    const read = stubSessionRules();
    const { allowDomainForSession, SESSION_ALLOW_ID_BASE } = await import('./blocking');
    for (let i = 0; i < 101; i++) await allowDomainForSession(`d${i}.example`);
    const allows = read().filter((r) => r.id >= SESSION_ALLOW_ID_BASE);
    expect(allows).toHaveLength(100);
    // d0 was the first in, so it is the first out; the newest is still there.
    expect(allows.some((r) => r.condition.urlFilter === '||d0.example')).toBe(false);
    expect(allows.some((r) => r.condition.urlFilter === '||d100.example')).toBe(true);
  });
});
