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

const DAY = 1000 * 60 * 60 * 24;

describe('visits: established sites', () => {
  const installedLongAgo = () => {
    store['zg.installedAt'] = Date.now() - 30 * DAY;
  };

  it('counts visits to the domain and everything under it', async () => {
    installedLongAgo();
    const { recordVisit, getVisitRecord } = await load();
    await recordVisit('shop.example.com');
    await recordVisit('www.example.com');
    await recordVisit('example.com');
    expect((await getVisitRecord('example.com'))?.n).toBe(3);
    // Asking about one subdomain counts only that subdomain.
    expect((await getVisitRecord('shop.example.com'))?.n).toBe(1);
  });

  it('needs both enough visits and enough history', async () => {
    installedLongAgo();
    store['zg.seenExactHosts'] = {
      'few.com': { first: Date.now() - 30 * DAY, last: Date.now(), n: 2 },
      'enough.com': { first: Date.now() - 30 * DAY, last: Date.now(), n: 3 },
      'recent.com': { first: Date.now() - 6 * DAY, last: Date.now(), n: 20 },
      'old-enough.com': { first: Date.now() - 7 * DAY, last: Date.now(), n: 3 },
    };
    const { isEstablishedSite } = await load();
    expect(await isEstablishedSite('few.com')).toBe(false); // 2 visits
    expect(await isEstablishedSite('enough.com')).toBe(true);
    expect(await isEstablishedSite('recent.com')).toBe(false); // 6 days old
    expect(await isEstablishedSite('old-enough.com')).toBe(true);
  });

  it('lets visits to a subdomain vouch for the site itself', async () => {
    installedLongAgo();
    store['zg.seenExactHosts'] = {
      'www.example.com': { first: Date.now() - 30 * DAY, last: Date.now(), n: 5 },
    };
    const { isEstablishedSite } = await load();
    expect(await isEstablishedSite('example.com')).toBe(true);
  });

  it('never lets one tenant vouch for another on a shared host', async () => {
    // The whole reason the exact-host map exists: registrableDomain() would
    // fold every workers.dev tenant onto "workers.dev".
    installedLongAgo();
    store['zg.seenExactHosts'] = {
      'my-own-app.workers.dev': { first: Date.now() - 60 * DAY, last: Date.now(), n: 40 },
    };
    const { isEstablishedSite } = await load();
    expect(await isEstablishedSite('my-own-app.workers.dev')).toBe(true);
    expect(await isEstablishedSite('phishing-kit.workers.dev')).toBe(false);
    // Asking about the bare suffix does aggregate its children, because for a
    // real site that is exactly what we want (www.x.com vouches for x.com).
    // It is moot here: the feed safelist drops public suffixes, so a bare
    // suffix is never a blocked domain in the first place.
    expect(await isEstablishedSite('workers.dev')).toBe(true);
  });

  it('does not let a subdomain vouch for an unrelated sibling', async () => {
    installedLongAgo();
    store['zg.seenExactHosts'] = {
      'good.example.com': { first: Date.now() - 30 * DAY, last: Date.now(), n: 9 },
    };
    const { isEstablishedSite } = await load();
    expect(await isEstablishedSite('evil.example.com')).toBe(false);
    // A suffix that merely ends with the same text is not a subdomain.
    expect(await isEstablishedSite('notexample.com')).toBe(false);
  });

  it('stays quiet during the post-install learning window', async () => {
    store['zg.installedAt'] = Date.now() - 1000 * 60;
    store['zg.seenExactHosts'] = {
      'example.com': { first: Date.now() - 30 * DAY, last: Date.now(), n: 9 },
    };
    const { isEstablishedSite } = await load();
    expect(await isEstablishedSite('example.com')).toBe(false);
  });

  it('never promotes an unknown site', async () => {
    installedLongAgo();
    const { isEstablishedSite } = await load();
    expect(await isEstablishedSite('never-seen.com')).toBe(false);
  });

  it('ignores the legacy registrable-domain map for this check', async () => {
    installedLongAgo();
    store['zg.seenHosts'] = {
      'legacy.com': { first: Date.now() - 30 * DAY, last: Date.now(), n: 50 },
    };
    const { isEstablishedSite } = await load();
    // Upgrading users start over here rather than inheriting a coarse count.
    expect(await isEstablishedSite('legacy.com')).toBe(false);
  });
});
