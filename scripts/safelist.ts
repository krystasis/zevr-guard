import { getDomain, getPublicSuffix } from 'tldts';
import manualList from './safelist.manual.json';

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
//
// The rank cut-off is deliberately shallow. Tranco ranks by DNS query volume,
// so live malware infrastructure earns a rank of its own: in the top 50k we
// measured okiloveyoupleasedonttouchme.net (#11,453), dontworry.su (#14,230)
// and dnsrecordsarepowerful.com (#27,967), all of them listed by ThreatFox at
// the same time. Protecting that far down would unblock working C2. Ranks
// past the cut-off are only *reported* for human review (reviewCandidates),
// and confirmed mistakes go in safelist.manual.json.
// ---------------------------------------------------------------------------

/**
 * Shared hosts on private-suffix providers, where the registrable domain
 * *is* the shared endpoint. Matched exactly or as a parent. Maintained by
 * hand in safelist.manual.json, fed by reviewed false-positive reports.
 */
export const SHARED_HOSTS: ReadonlySet<string> = new Set(manualList.shared_hosts);

/**
 * Registrable domains protected along with everything under them, for sites
 * that sit too far down the Tranco list for the rank check to catch.
 */
export const NEVER_BLOCK: ReadonlySet<string> = new Set(manualList.never_block);

export interface SafelistOptions {
  /** Ranked list of registrable domains (Tranco order). */
  popular: Iterable<string>;
  /** How far down `popular` counts as protected. Default: all of it. */
  limit?: number;
  /**
   * Ranks between `limit` and this are not protected — malware earns Tranco
   * ranks too — but are surfaced by reviewCandidates() so a human can spot a
   * genuine mistake and add it to safelist.manual.json.
   */
  reviewLimit?: number;
}

export interface Safelist {
  /** True when the host must not be blocked. */
  isProtected(host: string): boolean;
  /** Reason for the decision, for build logs. Null when blockable. */
  why(host: string): string | null;
  /**
   * Blockable hosts whose registrable domain still ranks somewhere in the
   * review band. Not dropped — just worth a human glance before a popular
   * site turns out to be blocked for everyone.
   */
  reviewCandidates(hosts: string[]): Array<{ host: string; rank: number }>;
}

export function createSafelist(opts: SafelistOptions): Safelist {
  const protectedLimit = opts.limit ?? Infinity;
  const reviewLimit = Math.max(opts.reviewLimit ?? 0, Number.isFinite(protectedLimit) ? protectedLimit : 0);
  const subtree = new Set<string>();
  const reviewRank = new Map<string, number>();
  let n = 0;
  for (const d of opts.popular) {
    if (n >= reviewLimit && n >= protectedLimit) break;
    const domain = d.toLowerCase();
    if (n < protectedLimit) subtree.add(domain);
    else reviewRank.set(domain, n + 1);
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

    if (NEVER_BLOCK.has(reg)) return `never-block:${reg}`;

    // 2. Walk host -> registrable domain (inclusive), stopping there so a
    //    private suffix (workers.dev) never protects its tenants.
    const labels = host.split('.');
    const regLabels = reg.split('.').length;
    for (let i = 0; i <= labels.length - regLabels; i++) {
      const candidate = labels.slice(i).join('.');
      if (subtree.has(candidate)) return `popular:${candidate}`;
    }

    // 3. Curated shared hosts, matched as host or parent.
    for (let i = 0; i < labels.length - 1; i++) {
      const candidate = labels.slice(i).join('.');
      if (SHARED_HOSTS.has(candidate)) return `shared-host:${candidate}`;
    }

    return null;
  }

  function reviewCandidates(hosts: string[]): Array<{ host: string; rank: number }> {
    const out: Array<{ host: string; rank: number }> = [];
    for (const raw of hosts) {
      const host = raw.toLowerCase().replace(/\.$/, '');
      const reg = getDomain(host, { allowPrivateDomains: true });
      const rank = reg ? reviewRank.get(reg) : undefined;
      if (rank !== undefined) out.push({ host, rank });
    }
    return out.sort((a, b) => a.rank - b.rank);
  }

  return {
    why,
    isProtected: (host) => why(host) !== null,
    reviewCandidates,
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
