import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeMalwareFeed, setPopularDomains } from './feedguard';

// The build safelist protects what we publish; this guard protects the user
// when what arrives is not what we published. On 2026-09-15 the live feed was
// rebuilt from a branch without the safelist and steamcommunity.com came back
// — a patched client applied it without question. These tests pin the fix.
beforeEach(() => {
  setPopularDomains({
    subtree: ['steamcommunity.com', 't.me', 'google.com'],
    apexOnly: ['workers.dev'],
    pinned: ['zevr-tour-threat.krystasis12.workers.dev'],
  });
});

describe('sanitizeMalwareFeed', () => {
  it('refuses a popular site the feed should never have listed', () => {
    const { kept, dropped } = sanitizeMalwareFeed([
      'evil.example',
      'steamcommunity.com',
      't.me',
    ]);
    expect(kept).toEqual(['evil.example']);
    expect(dropped.map((d) => d.host)).toEqual(['steamcommunity.com', 't.me']);
  });

  it('refuses anything under a popular site too', () => {
    const { kept } = sanitizeMalwareFeed(['login.steamcommunity.com', 'ok.example']);
    expect(kept).toEqual(['ok.example']);
  });

  it('keeps tenants of a shared host, refusing only the host itself', () => {
    // Blocking `||workers.dev` would take every tenant down; blocking one
    // tenant is exactly what the feed is for. Treating the two the same threw
    // away 13 real phishing hosts from a single day's feed — and the tour's
    // own demo domain with them.
    const { kept, dropped } = sanitizeMalwareFeed(['workers.dev', 'phish.workers.dev']);
    expect(kept).toEqual(['phish.workers.dev']);
    expect(dropped.map((d) => d.reason)).toEqual(['shared-suffix:workers.dev']);
  });

  it('keeps the tour domain, which is listed on purpose', () => {
    const { kept } = sanitizeMalwareFeed(['zevr-tour-threat.krystasis12.workers.dev']);
    expect(kept).toEqual(['zevr-tour-threat.krystasis12.workers.dev']);
  });

  it('drops malformed entries rather than letting them fail the whole write', () => {
    const { kept, dropped } = sanitizeMalwareFeed([
      'good.example',
      'not a hostname',
      'http://evil.example/path',
      '',
      42,
      null,
    ]);
    expect(kept).toEqual(['good.example']);
    expect(dropped).toHaveLength(5);
  });

  it('normalises case and a trailing dot', () => {
    expect(sanitizeMalwareFeed(['Evil.Example.']).kept).toEqual(['evil.example']);
  });

  it('still removes malformed entries with no popular list loaded', () => {
    setPopularDomains(null);
    const { kept } = sanitizeMalwareFeed(['ok.example', 'not a hostname']);
    expect(kept).toEqual(['ok.example']);
  });

  it('returns nothing for a payload that is not a list', () => {
    expect(sanitizeMalwareFeed({ oops: true }).kept).toEqual([]);
    expect(sanitizeMalwareFeed(null).kept).toEqual([]);
  });
});

describe('the list can never outgrow the rules', () => {
  it('truncates a feed longer than the mirror can carry', async () => {
    // Otherwise isMalware() calls the surplus dangerous while nothing blocks
    // it, and the popup reports blocks that never happened.
    const { FEED_MAX_DOMAINS } = await import('../shared/limits');
    setPopularDomains(null);
    const list = Array.from({ length: FEED_MAX_DOMAINS + 50 }, (_, i) => `d${i}.example`);
    const { kept, dropped } = sanitizeMalwareFeed(list);
    expect(kept).toHaveLength(FEED_MAX_DOMAINS);
    expect(dropped.filter((d) => d.reason === 'over-budget')).toHaveLength(50);
  });
});
