// Registrable-domain (eTLD+1) approximation shared by the background
// heuristics and the UI grouping code.

// Compact set of multi-label public suffixes covering the brand list and the
// markets the extension ships in. Not a full PSL — unknown suffixes simply
// fall back to the last two labels, which is fine for these heuristics.
const MULTI_SUFFIXES = new Set([
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'co.kr', 'or.kr', 'go.kr',
  'com.au', 'net.au', 'org.au', 'gov.au',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.tw', 'org.tw', 'com.hk', 'com.sg', 'com.my',
  'co.id', 'or.id', 'co.th', 'or.th', 'com.vn',
  'com.tr', 'gov.tr', 'com.ua', 'gov.ua',
  'co.in', 'net.in', 'org.in', 'gov.in',
  'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.cl',
  'com.ph', 'com.pk', 'co.za', 'com.sa', 'com.ng',
  'co.nz', 'net.nz', 'org.nz', 'co.il', 'com.pl',
]);

export function registrableDomain(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

// RFC-1123-ish hostname check: no scheme, path or port. Used wherever a
// domain arrives from somewhere untrusted — the warning page's query string,
// the settings panel's text field, a message from another context.
const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)+$/;

export function isValidHostname(host: string): boolean {
  return host.length <= 253 && HOSTNAME_RE.test(host);
}

/**
 * Walk a hostname's parent labels, stopping before the bare TLD, and return
 * the first one `hit` accepts. Blocking, allowing and provenance lookups all
 * need the same walk: a rule on `example.com` covers `a.b.example.com`, but a
 * rule on `ads.example.com` must not cover `example.com`, and nothing may
 * match on `com` alone.
 */
export function findSelfOrParent<T>(
  host: string,
  hit: (candidate: string) => T | undefined,
): T | undefined {
  const exact = hit(host);
  if (exact !== undefined) return exact;
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const found = hit(parts.slice(i).join('.'));
    if (found !== undefined) return found;
  }
  return undefined;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Whether two hosts belong to the same registrable domain. IP literals
 * (where label-based grouping is meaningless) only match exactly.
 */
export function isSameSite(a: string, b: string): boolean {
  if (a === b) return true;
  if (IPV4.test(a) || IPV4.test(b) || a.includes(':') || b.includes(':')) {
    return false;
  }
  return registrableDomain(a) === registrableDomain(b);
}
