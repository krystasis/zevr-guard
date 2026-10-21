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
    ['amazon.co.jp-login.com', 'embedding', 'amazon.co.jp'], // brand domain glued with a hyphen
    ['www.paypal.com-verify.net', 'embedding', 'paypal.com'],
    // brand + lure words
    ['apple-id.com', 'embedding', 'apple.com'],
    ['appleid-jp.com', 'embedding', 'apple.com'], // glued token next to a hyphen
    ['amazon-co-jp.com', 'embedding', 'amazon.com'],
    ['amazon-jp.net', 'embedding', 'amazon.com'],
    ['smbc-card-login.com', 'embedding', 'smbc-card.com'],
    ['rakuten-card-jp.com', 'embedding', 'rakuten-card.co.jp'],
    ['secure-paypal.com', 'embedding', 'paypal.com'],
    ['mufg-bank.jp', 'embedding', 'mufg.jp'],
    ['xn--mazon-3ve.co.jp', 'homoglyph', 'amazon.co.jp'], // Cyrillic а; names the brand on the visited suffix
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
    // the brand's own country sites (com.<cc> is a public suffix)
    'google.com.eg',
    'www.google.com.bd',
    'mercadolibre.com.uy',
    'vodafone.com.eg',
    // hyphen in or out is the brand's own alternate spelling
    'tmobile.com',
    'wal-mart.com',
    // brand + word glued into one label is how brands name their properties
    'microsoftonline.com',
    'myshopify.com',
    'adobelogin.com',
    'amazonjp.com', // given up on purpose: indistinguishable from the above
    // brand next to non-lure words
    'apple-pie-recipes.com',
    'amazon-affiliate-blog.net',
    'google-fonts.io',
    'microsoft-teams-tips.com',
    'line-art.com',
    'my-apple-tree.org',
    'paypal-community.com',
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
    // generic second level under a ccTLD that the hand-written table lacks
    ['google.com.eg', 'google.com.eg'],
    ['www.google.com.eg', 'google.com.eg'],
    ['foo.co.ke', 'foo.co.ke'],
    ['sub.gov.tr.example', 'tr.example'], // only two-letter TLDs qualify
    ['com.eg', 'com.eg'],
  ])('%s -> %s', (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });
});
