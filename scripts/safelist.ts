import { getDomain, getPublicSuffix } from 'tldts';

// ---------------------------------------------------------------------------
// Feed safelist.
//
// URLhaus / ThreatFox list *hosts*, but Zevr Guard blocks by domain
// (`||host` also matches every subdomain, and the redirect fires on the
// main frame). A shared host that once served one malicious file —
// steamcommunity.com, t.me, cdn.jsdelivr.net — therefore turns into a
// whole-site block for every user. This module drops such entries before
// they reach the feed or the bundled rules.
//
// A host is dropped when:
//   1. it is itself a public suffix (s3.amazonaws.com) — blocking it would
//      block every tenant;
//   2. it, or any parent label up to its registrable domain, ranks in the
//      Tranco top list. Private PSL suffixes (workers.dev, duckdns.org,
//      pages.dev …) bound the walk: `evil.workers.dev` is its own
//      registrable domain and stays blockable even though workers.dev
//      ranks high;
//   3. it sits on a curated list of shared hosts that Tranco cannot see
//      (Tranco ranks registrable domains, so raw.githubusercontent.com or
//      cdn.discordapp.com never appear even though each is a shared CDN
//      endpoint for millions of unrelated files).
//
// Losing a genuine C2 host that happens to live under a popular apex is an
// acceptable cost: the user never notices a missing block, but a blocked
// steamcommunity.com is an uninstall.
// ---------------------------------------------------------------------------

/**
 * Shared hosts on private-suffix providers, where the registrable domain
 * *is* the shared endpoint. Matched exactly or as a parent.
 */
export const SHARED_HOSTS: ReadonlySet<string> = new Set([
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'user-images.githubusercontent.com',
  'avatars.githubusercontent.com',
  'gist.githubusercontent.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
  'dl.dropboxusercontent.com',
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
  'drive.usercontent.google.com',
  'lh3.googleusercontent.com',
  'i.imgur.com',
  'pbs.twimg.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
]);

export interface SafelistOptions {
  /** Ranked list of registrable domains (Tranco order). */
  popular: Iterable<string>;
  /** Only the first `limit` entries of `popular` count. Default: all. */
  limit?: number;
}

export interface Safelist {
  /** True when the host must not be blocked. */
  isProtected(host: string): boolean;
  /** Reason for the decision, for build logs. Null when blockable. */
  why(host: string): string | null;
}

export function createSafelist(opts: SafelistOptions): Safelist {
  const popular = new Set<string>();
  let n = 0;
  for (const d of opts.popular) {
    if (opts.limit !== undefined && n >= opts.limit) break;
    popular.add(d.toLowerCase());
    n += 1;
  }

  function why(raw: string): string | null {
    const host = raw.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.')) return null;

    // 1. Public suffix itself.
    const suffix = getPublicSuffix(host, { allowPrivateDomains: true });
    if (suffix === host) return 'public-suffix';

    // Registrable domain honouring private suffixes; null for garbage.
    const reg = getDomain(host, { allowPrivateDomains: true });
    if (!reg) return 'unparseable';

    // 2. Walk host -> registrable domain (inclusive), stopping there so a
    //    private suffix (workers.dev) never protects its tenants.
    const labels = host.split('.');
    const regLabels = reg.split('.').length;
    for (let i = 0; i <= labels.length - regLabels; i++) {
      const candidate = labels.slice(i).join('.');
      if (popular.has(candidate)) return `popular:${candidate}`;
    }

    // 3. Curated shared hosts, matched as host or parent.
    for (let i = 0; i < labels.length - 1; i++) {
      const candidate = labels.slice(i).join('.');
      if (SHARED_HOSTS.has(candidate)) return `shared-host:${candidate}`;
    }

    return null;
  }

  return {
    why,
    isProtected: (host) => why(host) !== null,
  };
}

/** Split a candidate list into blockable entries and dropped ones. */
export function applySafelist(
  hosts: string[],
  safelist: Safelist,
): { kept: string[]; dropped: Array<{ host: string; reason: string }> } {
  const kept: string[] = [];
  const dropped: Array<{ host: string; reason: string }> = [];
  for (const host of hosts) {
    const reason = safelist.why(host);
    if (reason) dropped.push({ host, reason });
    else kept.push(host);
  }
  return { kept, dropped };
}
