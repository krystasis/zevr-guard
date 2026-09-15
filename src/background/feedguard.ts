import { findSelfOrParent, isValidHostname } from '../shared/domain';
// Tranco's most-visited registrable domains, emitted by the feed build. Loaded
// lazily: it is only consulted when a downloaded feed arrives, once a day.
import popularUrl from '../data/popular.json?url';

// ---------------------------------------------------------------------------
// Client-side guard on the downloaded threat feed.
//
// scripts/safelist.ts protects what we publish. This protects the user when
// what arrives is not what we published — a feed built before the safelist
// existed, an origin someone else is answering for, or a mistake upstream.
// It is not theoretical: on 2026-09-15 the published feed was regenerated
// from a branch without the safelist and steamcommunity.com came back, which
// a fully-patched client would have applied without question.
//
// Deliberately narrow. It drops entries that are malformed, or that would
// take a popular site down with them. It does not try to judge whether a
// domain is really malicious; that is what the feed is for.
// ---------------------------------------------------------------------------

let popular: Set<string> | null = null;
let loading: Promise<void> | null = null;

/** Load the popular-domain list. Safe to call repeatedly. */
export function ensurePopularDomains(): Promise<void> {
  if (popular) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      const res = await fetch(popularUrl);
      popular = new Set((await res.json()) as string[]);
    })().catch((err) => {
      console.warn('[Zevr Guard] popular list load failed:', (err as Error).message);
      loading = null;
    });
  }
  return loading;
}

/** For tests. */
export function setPopularDomains(list: string[] | null): void {
  popular = list ? new Set(list) : null;
}

export interface FeedGuardResult {
  kept: string[];
  dropped: Array<{ host: string; reason: string }>;
}

/**
 * Filter a downloaded malware list. Call `ensurePopularDomains()` first; with
 * no list loaded this still removes malformed entries, which alone matters —
 * one bad string makes the whole 4,800-rule write fail, leaving the user with
 * whatever the packaged snapshot happened to contain.
 */
export function sanitizeMalwareFeed(list: unknown): FeedGuardResult {
  const kept: string[] = [];
  const dropped: Array<{ host: string; reason: string }> = [];
  if (!Array.isArray(list)) return { kept, dropped };

  for (const raw of list) {
    if (typeof raw !== 'string') {
      dropped.push({ host: String(raw).slice(0, 60), reason: 'not-a-string' });
      continue;
    }
    const host = raw.trim().toLowerCase().replace(/\.$/, '');
    if (!isValidHostname(host)) {
      dropped.push({ host: host.slice(0, 60), reason: 'malformed' });
      continue;
    }
    // A popular site, or anything under one. Blocking `||steamcommunity.com`
    // takes the whole site with it, which is an uninstall; losing one genuine
    // threat hosted under a popular domain is not.
    const hit = popular
      ? findSelfOrParent(host, (c) => (popular!.has(c) ? c : undefined))
      : undefined;
    if (hit) {
      dropped.push({ host, reason: `popular:${hit}` });
      continue;
    }
    kept.push(host);
  }
  return { kept, dropped };
}
