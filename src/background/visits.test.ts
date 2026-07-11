import { describe, expect, it, vi, beforeEach } from 'vitest';

// In-memory chrome.storage.local so the module's write-behind cache persists
// within a test.
const store: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.resetModules();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (o: Record<string, unknown>) => {
          Object.assign(store, o);
        },
      },
    },
    runtime: { onSuspend: { addListener: () => {} } },
  };
});

async function load() {
  return import('./visits');
}

describe('visits: first-visit freshness', () => {
  it('reports a brand-new site as a fresh visit after the learning window', async () => {
    // Installed long ago so the learning window has passed.
    store['zg.installedAt'] = Date.now() - 1000 * 60 * 60 * 24 * 10;
    const { recordVisit, isFreshVisit } = await load();
    await recordVisit('login.newbank.com');
    expect(await isFreshVisit('login.newbank.com')).toBe(true);
    // A subdomain of the same registrable domain is the same site.
    expect(await isFreshVisit('www.newbank.com')).toBe(true);
  });

  it('does not report a site first seen long ago as fresh', async () => {
    store['zg.installedAt'] = Date.now() - 1000 * 60 * 60 * 24 * 10;
    store['zg.seenHosts'] = {
      'routine.com': {
        first: Date.now() - 1000 * 60 * 60, // first seen an hour ago
        last: Date.now(),
      },
    };
    const { recordVisit, isFreshVisit } = await load();
    await recordVisit('routine.com'); // a fresh visit today
    // Still not "fresh": first-seen is an hour old, touching last must not change that.
    expect(await isFreshVisit('routine.com')).toBe(false);
  });

  it('stays silent during the post-install learning window', async () => {
    store['zg.installedAt'] = Date.now() - 1000 * 60; // installed a minute ago
    const { recordVisit, isFreshVisit } = await load();
    await recordVisit('newbank.com');
    expect(await isFreshVisit('newbank.com')).toBe(false);
  });

  it('migrates the old number-only stored shape', async () => {
    store['zg.installedAt'] = Date.now() - 1000 * 60 * 60 * 24 * 10;
    store['zg.seenHosts'] = { 'old.com': Date.now() - 1000 * 60 * 60 };
    const { isFreshVisit } = await load();
    // first-seen an hour ago -> not fresh, and no crash on the legacy shape.
    expect(await isFreshVisit('old.com')).toBe(false);
  });
});
