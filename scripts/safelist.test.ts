import { describe, expect, it } from 'vitest';
import { applySafelist, createSafelist } from './safelist';

// Small stand-in for the Tranco snapshot: rank order matters only for
// `limit`.
const POPULAR = [
  'google.com',
  'amazonaws.com',
  'azure.com',
  'workers.dev',
  't.me',
  'telegram.org',
  'jsdelivr.net',
  'duckdns.org',
  'steamcommunity.com',
  'pinterest.com',
  'epicgames.com',
  'it.com',
  'hopto.org',
  'tw1.ru',
];

const safelist = createSafelist({ popular: POPULAR });

describe('safelist', () => {
  const protectedHosts: Array<[string, string]> = [
    ['steamcommunity.com', 'popular:steamcommunity.com'],
    ['www.steamcommunity.com', 'popular:steamcommunity.com'],
    ['t.me', 'popular:t.me'],
    ['sites.google.com', 'popular:google.com'],
    ['api.telegram.org', 'popular:telegram.org'],
    ['cdn.jsdelivr.net', 'popular:jsdelivr.net'],
    ['www.pinterest.com', 'popular:pinterest.com'],
    ['dev.epicgames.com', 'popular:epicgames.com'],
    // Not a private suffix, so the popular apex protects the whole tree.
    ['downloadupdate.centralus.cloudapp.azure.com', 'popular:azure.com'],
    ['xxx.tw1.ru', 'popular:tw1.ru'],
    // Public suffixes can never be blocked wholesale.
    ['s3.amazonaws.com', 'public-suffix'],
    ['workers.dev', 'public-suffix'],
    // Shared CDN endpoints Tranco cannot see.
    ['raw.githubusercontent.com', 'shared-host:raw.githubusercontent.com'],
    ['cdn.discordapp.com', 'shared-host:cdn.discordapp.com'],
    ['storage.googleapis.com', 'shared-host:storage.googleapis.com'],
  ];

  it.each(protectedHosts)('protects %s (%s)', (host, reason) => {
    expect(safelist.why(host)).toBe(reason);
    expect(safelist.isProtected(host)).toBe(true);
  });

  const blockable = [
    // Tenants on private suffixes are their own registrable domains.
    'evil.workers.dev',
    '1hvnc.duckdns.org',
    'aotools.hopto.org',
    '8kbetcc.it.com',
    'tbpvaoy.8kbetcc.it.com',
    // EC2 hostnames sit on a private suffix too.
    'ec2-3-22-66-152.us-east-2.compute.amazonaws.com',
    // Ordinary malware domains.
    'globalsteamclub.com',
    'steam66.cn',
    'www.steamrub.com',
    'paypal-verify-login.xyz',
    'xn--pple-43d.com',
  ];

  it.each(blockable)('leaves %s blockable', (host) => {
    expect(safelist.why(host)).toBeNull();
  });

  it('honours the rank limit', () => {
    const top3 = createSafelist({ popular: POPULAR, limit: 3 });
    expect(top3.isProtected('sites.google.com')).toBe(true);
    expect(top3.isProtected('steamcommunity.com')).toBe(false);
  });

  it('is case- and trailing-dot-insensitive', () => {
    expect(safelist.isProtected('SteamCommunity.COM.')).toBe(true);
  });

  it('splits a list into kept and dropped', () => {
    const { kept, dropped } = applySafelist(
      ['steamcommunity.com', 'evil.workers.dev', 't.me'],
      safelist,
    );
    expect(kept).toEqual(['evil.workers.dev']);
    expect(dropped.map((d) => d.host)).toEqual(['steamcommunity.com', 't.me']);
  });
});
