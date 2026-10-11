import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageStats, TodayStats } from '../types';

function samplePage(): PageStats {
  return {
    tabId: 1,
    url: 'https://example.com/',
    host: 'example.com',
    connections: {},
    totalCount: 0,
    blockedCount: 0,
    riskScore: 0,
    riskLevel: 'safe',
    lastUpdated: 0,
  };
}

// In-memory chrome.storage.local so the module's write-behind cache persists
// within a test. Keys listed in `failing` reject the way the real API does
// once QUOTA_BYTES is reached. `setAttempts` counts tries per key, including
// the ones that reject, so a test can tell a backoff from a retry spin.
const store: Record<string, unknown> = {};
const failing = new Set<string>();
const setAttempts: Record<string, number> = {};
let suspendListener: (() => void) | null = null;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(setAttempts)) delete setAttempts[k];
  failing.clear();
  suspendListener = null;
  vi.resetModules();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (o: Record<string, unknown>) => {
          for (const k of Object.keys(o)) {
            setAttempts[k] = (setAttempts[k] ?? 0) + 1;
            if (failing.has(k)) {
              throw new Error('QUOTA_BYTES quota exceeded');
            }
          }
          Object.assign(store, JSON.parse(JSON.stringify(o)));
        },
      },
    },
    runtime: {
      onSuspend: {
        addListener: (fn: () => void) => {
          suspendListener = fn;
        },
      },
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

async function load() {
  return import('./storage');
}

function storedToday(): TodayStats {
  return store.todayStats as TodayStats;
}

describe('storage: write-behind flush under a failing storage quota', () => {
  it('keeps the dirty data, runs the later writes, and rejects nothing', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      vi.useFakeTimers();
      const {
        getPagesCached,
        getTodayStats,
        incrementLifetimeBlocked,
        markPagesDirty,
        markTodayDirty,
      } = await load();

      const pages = await getPagesCached();
      pages[1] = samplePage();
      const today = await getTodayStats();
      today.totalConnections = 7;
      delete store.pages;
      delete store.todayStats;

      // `pages` is the first write of the pass: its failure must not take the
      // two writes behind it down with it.
      failing.add('pages');
      markPagesDirty();
      markTodayDirty();
      await incrementLifetimeBlocked();

      await vi.advanceTimersByTimeAsync(600);

      expect(store.pages).toBeUndefined();
      expect(storedToday().totalConnections).toBe(7);
      expect(store['zg.lifetime']).toEqual({ blocked: 1 });

      // The flag survived, so the retry persists what the failed write held.
      failing.clear();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(store.pages).toEqual({ 1: samplePage() });

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('retries a failed write after the backoff', async () => {
    vi.useFakeTimers();
    const { getTodayStats, markTodayDirty } = await load();

    const today = await getTodayStats();
    delete store.todayStats;
    failing.add('todayStats');
    today.totalConnections = 1;
    markTodayDirty();
    await vi.advanceTimersByTimeAsync(600);
    expect(store.todayStats).toBeUndefined();

    failing.clear();
    today.totalConnections = 2;
    markTodayDirty();
    await vi.advanceTimersByTimeAsync(30_600);
    expect(storedToday().totalConnections).toBe(2);
  });

  it('backs the failing key off while traffic keeps the flush running', async () => {
    vi.useFakeTimers();
    const { getPagesCached, getTodayStats, markPagesDirty, markTodayDirty } =
      await load();

    const pages = await getPagesCached();
    pages[1] = samplePage();
    const today = await getTodayStats();
    delete store.pages;

    failing.add('pages');
    markPagesDirty();
    await vi.advanceTimersByTimeAsync(600);
    expect(setAttempts.pages).toBe(1);

    // Browsing continues, so every mark arms a fresh 500ms timer. The
    // over-quota key must not be re-serialized on each of those passes.
    for (let i = 1; i <= 6; i += 1) {
      today.totalConnections = i;
      markTodayDirty();
      markPagesDirty();
      await vi.advanceTimersByTimeAsync(600);
      expect(storedToday().totalConnections).toBe(i);
    }
    expect(setAttempts.pages).toBe(1);

    // The backoff still ends on time once it is up.
    failing.clear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.pages).toEqual({ 1: samplePage() });
  });

  it('does not make a healthy key wait out another key’s backoff', async () => {
    vi.useFakeTimers();
    const { getPagesCached, getTodayStats, markPagesDirty, markTodayDirty } =
      await load();

    await getPagesCached();
    const today = await getTodayStats();
    delete store.pages;
    delete store.todayStats;

    failing.add('pages');
    markPagesDirty();
    await vi.advanceTimersByTimeAsync(600);
    expect(store.pages).toBeUndefined();

    // `todayStats` is writable, so it flushes on the usual cadence rather than
    // sitting in the 30s retry the failing key asked for — the worker can be
    // torn down at any point in that window.
    today.totalConnections = 42;
    markTodayDirty();
    await vi.advanceTimersByTimeAsync(600);
    expect(store.todayStats).toMatchObject({ totalConnections: 42 });
  });

  it('still tries a backed-off key when the worker is suspending', async () => {
    vi.useFakeTimers();
    const { getTodayStats, markTodayDirty } = await load();
    const today = await getTodayStats();
    delete store.todayStats;

    failing.add('todayStats');
    today.totalConnections = 3;
    markTodayDirty();
    await vi.advanceTimersByTimeAsync(600);
    expect(store.todayStats).toBeUndefined();

    // There is no "30s from now" for a worker that is going away, so the
    // backoff is skipped and the data gets its last chance.
    failing.clear();
    suspendListener?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(store.todayStats).toMatchObject({ totalConnections: 3 });
  });

  it('does not let a failing write escape the onSuspend flush', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      vi.useFakeTimers();
      const { getTodayStats, markTodayDirty } = await load();
      await getTodayStats();
      failing.add('todayStats');
      markTodayDirty();

      expect(suspendListener).toBeTypeOf('function');
      // onSuspend calls `void flush()`, so a rejection here has no catcher.
      suspendListener?.();
      await vi.advanceTimersByTimeAsync(600);

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('storage: per-day caps', () => {
  it('keeps the busiest domains and companies when a day overflows', async () => {
    const {
      capTodayStats,
      getDefaultTodayStats,
      MAX_BLOCKED_DOMAINS,
      MAX_COMPANIES,
      MAX_TRACKER_DOMAINS,
    } = await load();

    const stats = getDefaultTodayStats();
    const overflow = 50;
    for (let i = 0; i < MAX_TRACKER_DOMAINS + overflow; i += 1) {
      stats.trackerDomains[`t${i}.example`] = {
        count: i,
        company: null,
        category: null,
        country: null,
        countryName: null,
        riskLevel: 'tracker',
      };
    }
    for (let i = 0; i < MAX_BLOCKED_DOMAINS + overflow; i += 1) {
      stats.blockedDomains[`b${i}.example`] = i;
    }
    for (let i = 0; i < MAX_COMPANIES + overflow; i += 1) {
      stats.companyCounts[`Company ${i}`] = i;
      stats.companiesDetected.push(`Company ${i}`);
    }

    capTodayStats(stats);

    expect(Object.keys(stats.trackerDomains)).toHaveLength(MAX_TRACKER_DOMAINS);
    expect(stats.trackerDomains['t0.example']).toBeUndefined();
    expect(
      stats.trackerDomains[`t${MAX_TRACKER_DOMAINS + overflow - 1}.example`],
    ).toBeDefined();
    expect(Object.keys(stats.blockedDomains)).toHaveLength(MAX_BLOCKED_DOMAINS);
    expect(stats.blockedDomains['b0.example']).toBeUndefined();
    expect(Object.keys(stats.companyCounts)).toHaveLength(MAX_COMPANIES);
    // The list of companies never names one the counts dropped.
    expect(stats.companiesDetected).toHaveLength(MAX_COMPANIES);
    for (const company of stats.companiesDetected) {
      expect(stats.companyCounts[company]).toBeDefined();
    }
  });

  it('leaves a day below the caps untouched', async () => {
    const { capTodayStats, getDefaultTodayStats } = await load();
    const stats = getDefaultTodayStats();
    stats.blockedDomains = { 'ads.example': 3 };
    stats.companyCounts = { Acme: 2 };
    stats.companiesDetected = ['Acme'];
    const before = JSON.parse(JSON.stringify(stats));
    expect(capTodayStats(stats)).toEqual(before);
  });

  it('caps what it persists for a day over the caps', async () => {
    vi.useFakeTimers();
    const { getTodayStats, markTodayDirty, MAX_BLOCKED_DOMAINS } = await load();
    const today = await getTodayStats();
    for (let i = 0; i < MAX_BLOCKED_DOMAINS + 10; i += 1) {
      today.blockedDomains[`b${i}.example`] = i + 1;
    }
    markTodayDirty();
    await vi.advanceTimersByTimeAsync(600);
    expect(Object.keys(storedToday().blockedDomains)).toHaveLength(
      MAX_BLOCKED_DOMAINS,
    );
    // The in-memory copy shrinks with the stored one.
    expect(Object.keys(today.blockedDomains)).toHaveLength(MAX_BLOCKED_DOMAINS);
  });
});
