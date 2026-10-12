import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageRequest, PageStats } from '../types';

// GET_PAGE_STATS is answered from the live write-behind page cache, so these
// tests drive the real worker: requests come in through the webRequest
// listener and the block list through the BLOCK_DOMAIN / UNBLOCK_DOMAIN
// messages, exactly as the popup and settings panel send them.

interface Rule {
  id: number;
  priority: number;
  action: { type: string; redirect?: { url: string } };
  condition: { urlFilter?: string; resourceTypes?: string[] };
}

type Listener = (...args: never[]) => unknown;

const TAB = 7;
const PAGE_HOST = 'example.com';

let dynamicRules: Rule[];
let local: Record<string, unknown>;
let session: Record<string, unknown>;
let onCompleted: ((details: Record<string, unknown>) => void) | null;
let onMessage:
  | ((
      message: MessageRequest,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => void)
  | null;

function collect(assign?: (fn: Listener) => void) {
  return {
    addListener: (fn: Listener) => assign?.(fn),
    removeListener: () => {},
    hasListener: () => false,
  };
}

function keysOf(
  keys: string | string[] | Record<string, unknown> | null | undefined,
): string[] | null {
  if (keys === null || keys === undefined) return null;
  if (typeof keys === 'string') return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

function area(store: Record<string, unknown>) {
  return {
    get: async (keys?: string | string[] | Record<string, unknown> | null) => {
      const list = keysOf(keys);
      if (!list) return { ...store };
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in store) out[k] = store[k];
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    },
    remove: async (keys: string | string[]) => {
      for (const k of keysOf(keys) ?? []) delete store[k];
    },
  };
}

beforeEach(() => {
  dynamicRules = [];
  local = {};
  session = {};
  onCompleted = null;
  onMessage = null;
  vi.resetModules();
  // No feed fetch, no bundled-DB fetch: the tracker DB is injected below.
  vi.stubGlobal('fetch', async () => new Response(null, { status: 304 }));
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test',
      getURL: (p: string) => `chrome-extension://test/${p}`,
      getManifest: () => ({ version: '0.0.0' }),
      setUninstallURL: () => {},
      onSuspend: collect(),
      onInstalled: collect(),
      onStartup: collect(),
      onMessage: collect((fn) => {
        onMessage = fn as unknown as typeof onMessage;
      }),
    },
    storage: {
      local: area(local),
      session: area(session),
      onChanged: collect(),
    },
    webRequest: {
      onBeforeRequest: collect(),
      onCompleted: collect((fn) => {
        onCompleted = fn as unknown as typeof onCompleted;
      }),
      onErrorOccurred: collect(),
    },
    tabs: {
      get: async (tabId: number) => ({ id: tabId, url: `https://${PAGE_HOST}/` }),
      query: async () => [],
      create: async () => ({}),
      sendMessage: async () => {},
      onActivated: collect(),
      onUpdated: collect(),
      onRemoved: collect(),
    },
    notifications: {
      create: () => {},
      onButtonClicked: collect(),
      onClicked: collect(),
    },
    action: {
      setBadgeBackgroundColor: () => {},
      setBadgeText: () => {},
      setBadgeTextColor: () => {},
      setTitle: () => {},
    },
    alarms: {
      create: async () => {},
      clear: async () => {},
      get: async () => undefined,
      onAlarm: collect(),
    },
    declarativeNetRequest: {
      getDynamicRules: async () => dynamicRules,
      updateDynamicRules: async (o: { addRules?: Rule[]; removeRuleIds?: number[] }) => {
        const remove = new Set(o.removeRuleIds ?? []);
        dynamicRules = dynamicRules
          .filter((r) => !remove.has(r.id))
          .concat(o.addRules ?? []);
      },
      getSessionRules: async () => [],
      updateSessionRules: async () => {},
      getEnabledRulesets: async () => [],
      updateEnabledRulesets: async () => {},
    },
    i18n: { getUILanguage: () => 'en' },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Boot the worker with a two-entry tracker DB standing in for the feed. */
async function boot() {
  await import('./index');
  const risk = await import('./risk');
  risk.setTrackerOverride({
    'ads.example.net': { company: 'Ads Inc', category: 'advertising' },
    'track.example.org': { company: 'Track Inc', category: 'tracking' },
  });
  const storage = await import('./storage');
  expect(onCompleted).not.toBeNull();
  expect(onMessage).not.toBeNull();
  return storage;
}

function send<T>(message: MessageRequest): Promise<T> {
  return new Promise<T>((resolve) => {
    onMessage!(message, {}, resolve as (response: unknown) => void);
  });
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('GET_PAGE_STATS', () => {
  it('does not latch the block flag into the cached page', async () => {
    const storage = await boot();
    const pages = await storage.getPagesCached();

    const request = async (domain: string, count: number) => {
      onCompleted!({
        tabId: TAB,
        url: `https://${domain}/pixel.gif`,
        type: 'xmlhttprequest',
        timeStamp: Date.now(),
      });
      await until(
        () => pages[TAB]?.connections[domain]?.count === count,
        `request ${count} to ${domain}`,
      );
    };

    await request('ads.example.net', 1);
    await request('track.example.org', 1);
    const exposed = pages[TAB].riskScore;
    expect(exposed).toBeGreaterThan(0);

    // The user blocks one of the two after the page already loaded, so the
    // cached connection still carries isBlocked: false.
    expect(await send({ type: 'BLOCK_DOMAIN', domain: 'ads.example.net' })).toEqual({
      success: true,
    });

    // Opening the popup: the answer reflects the new block...
    const read = await send<{ stats: PageStats }>({
      type: 'GET_PAGE_STATS',
      tabId: TAB,
    });
    expect(read.stats.connections['ads.example.net'].isBlocked).toBe(true);
    expect(read.stats.connections['track.example.org'].isBlocked).toBe(false);
    // ...and the read leaves the cache alone.
    expect(pages[TAB].connections['ads.example.net'].isBlocked).toBe(false);
    expect(read.stats).not.toBe(pages[TAB]);
    expect(read.stats.connections['ads.example.net']).not.toBe(
      pages[TAB].connections['ads.example.net'],
    );

    // The user changes their mind in Settings, then the page makes one more
    // request: the score has to count the no-longer-blocked connection again.
    expect(await send({ type: 'UNBLOCK_DOMAIN', domain: 'ads.example.net' })).toEqual({
      success: true,
    });
    await request('track.example.org', 2);
    expect(pages[TAB].connections['ads.example.net'].isBlocked).toBe(false);
    expect(pages[TAB].riskScore).toBe(exposed);
  });

  it('reports no stats for a tab it has never seen', async () => {
    await boot();
    expect(await send({ type: 'GET_PAGE_STATS', tabId: 999 })).toEqual({ stats: null });
  });
});
