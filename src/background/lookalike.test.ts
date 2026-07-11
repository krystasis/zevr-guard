import { describe, expect, it } from 'vitest';
import { detectLookalike, registrableDomain } from './lookalike';

describe('detectLookalike', () => {
  const hits: Array<[string, string, string]> = [
    // host, expected reason, expected brand
    ['paypa1.com', 'homoglyph', 'paypal.com'],
    ['xn--pple-43d.com', 'homoglyph', 'apple.com'], // Cyrillic а
    ['arnazon.com', 'homoglyph', 'amazon.com'], // rn -> m
    ['g00gle.com', 'homoglyph', 'google.com'],
    ['micr0soft.com', 'homoglyph', 'microsoft.com'],
    ['faceb00k.com', 'homoglyph', 'facebook.com'],
    ['xn--paypl-6qa.com', 'homoglyph', 'paypal.com'], // paypàl -> diacritic strip
    ['amazom.com', 'typosquat', 'amazon.com'],
    ['boooking.com', 'typosquat', 'booking.com'],
    ['gooogle.com', 'typosquat', 'google.com'],
    ['bookng.com', 'typosquat', 'booking.com'],
    ['bokoing.com', 'typosquat', 'booking.com'],
    ['paypal.com.secure-login.xyz', 'embedding', 'paypal.com'],
    ['www.paypal.com.verify-account.net', 'embedding', 'paypal.com'],
    ['rakuten.co.jp.campaign.top', 'embedding', 'rakuten.co.jp'],
    ['login.smbc.co.jp.evil.cc', 'embedding', 'smbc.co.jp'],
  ];

  it.each(hits)('flags %s as %s of %s', (host, reason, brand) => {
    const hit = detectLookalike(host);
    expect(hit).not.toBeNull();
    expect(hit?.reason).toBe(reason);
    expect(hit?.brand).toBe(brand);
  });

  const clean = [
    'paypal.com',
    'www.paypal.com',
    'amazon.de',
    'amazon.co.jp',
    'aws.amazon.com',
    'ccb.com.cn', // same label on its own suffix
    'paypal.co', // same label, other TLD
    'cooking.com', // position-0 substitution vs booking
    'looking.com',
    'strive.com', // non-confusable sub vs stripe
    'kodak.com', // non-confusable sub vs kotak
    'delia.com', // label < 6 chars
    'targets.com', // plural
    'monday.com',
    'sunday.com',
    'example.com',
    'localhost',
    '192.168.1.1',
    'xn--bcher-kva.de', // bücher — legitimate IDN
    'docs.google.com',
    'drive.google.com',
    'accounts.google.com',
    'modern.com',
    'shoppe.com',
  ];

  it.each(clean)('leaves %s alone', (host) => {
    expect(detectLookalike(host)).toBeNull();
  });
});

describe('registrableDomain', () => {
  it.each([
    ['www.paypal.com', 'paypal.com'],
    ['a.b.rakuten.co.jp', 'rakuten.co.jp'],
    ['sub.example.com.au', 'example.com.au'],
    ['example.com', 'example.com'],
    ['localhost', 'localhost'],
  ])('%s -> %s', (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });
});
