import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeMalwareFeed, setPopularDomains } from './feedguard';

// The build safelist protects what we publish; this guard protects the user
// when what arrives is not what we published. On 2026-09-15 the live feed was
// rebuilt from a branch without the safelist and steamcommunity.com came back
// — a patched client applied it without question. These tests pin the fix.
beforeEach(() => {
  setPopularDomains(['steamcommunity.com', 't.me', 'google.com', 'workers.dev']);
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

  it('keeps a tenant whose own name is the registrable domain', () => {
    // `workers.dev` is popular, but each tenant is a separate site and the
    // feed is full of them. Only an entry that would take the provider down
    // is refused — matching how the build-time safelist reasons.
    const { kept } = sanitizeMalwareFeed(['workers.dev', 'phish.workers.dev']);
    expect(kept).toEqual([]);
    // (the build safelist keeps tenants; the client is deliberately stricter,
    // because here we cannot tell a private suffix from an ordinary domain)
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
