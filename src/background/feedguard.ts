import { findSelfOrParent, isValidHostname } from '../shared/domain';
import { FEED_MAX_DOMAINS } from '../shared/limits';
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

/**
 * The guard the build hands us. The extension has no public suffix list of
 * its own, so the distinction between "a popular site" and "a popular place
 * that hosts other people's sites" is decided at build time and shipped.
 */
interface PopularGuard {
  /** Ordinary sites: the apex and everything under it are one site. */
  subtree: string[];
  /** Shared hosting: every tenant is a different site. */
  apexOnly: string[];
  /** Ours, and kept whatever the lists say. */
  pinned: string[];
}

let subtree: Set<string> | null = null;
let apexOnly = new Set<string>();
let pinned = new Set<string>();
let loading: Promise<void> | null = null;

/** Load the popular-domain guard. Safe to call repeatedly. */
export function ensurePopularDomains(): Promise<void> {
  if (subtree) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      const res = await fetch(popularUrl);
      const data = (await res.json()) as PopularGuard;
      subtree = new Set(data.subtree ?? []);
      apexOnly = new Set(data.apexOnly ?? []);
      pinned = new Set(data.pinned ?? []);
    })().catch((err) => {
      console.warn('[Zevr Guard] popular list load failed:', (err as Error).message);
      loading = null;
    });
  }
  return loading;
}

/** For tests. */
export function setPopularDomains(guard: Partial<PopularGuard> | null): void {
  subtree = guard ? new Set(guard.subtree ?? []) : null;
  apexOnly = new Set(guard?.apexOnly ?? []);
  pinned = new Set(guard?.pinned ?? []);
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
    if (pinned.has(host)) {
      kept.push(host);
      continue;
    }
    // A popular site, or anything under one. Blocking `||steamcommunity.com`
    // takes the whole site with it, which is an uninstall; losing one genuine
    // threat hosted under a popular domain is not.
    const hit = subtree
      ? findSelfOrParent(host, (c) => (subtree!.has(c) ? c : undefined))
      : undefined;
    if (hit) {
      dropped.push({ host, reason: `popular:${hit}` });
      continue;
    }
    // Shared hosting is the opposite case: `evil.workers.dev` is its own site
    // and the feed is full of them, so only a rule naming the provider itself
    // is refused. Walking parents here would throw away most of the feed —
    // including the tour's own demo domain.
    if (apexOnly.has(host)) {
      dropped.push({ host, reason: `shared-suffix:${host}` });
      continue;
    }
    kept.push(host);
  }

  // Only as many as become rules. The server decides how long its list is,
  // and if it sends more than the mirror can carry, the surplus would be
  // called dangerous by isMalware() with nothing blocking it — the same hole
  // the build-time cap closed, arriving from the other direction.
  if (kept.length > FEED_MAX_DOMAINS) {
    for (const host of kept.slice(FEED_MAX_DOMAINS)) {
      dropped.push({ host, reason: 'over-budget' });
    }
    kept.length = FEED_MAX_DOMAINS;
  }
  return { kept, dropped };
}
