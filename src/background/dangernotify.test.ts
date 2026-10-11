import { beforeEach, describe, expect, it, vi } from 'vitest';

// The dangerous-connection toast lives in the service-worker module, so these
// tests load it for real and drive its webRequest.onCompleted listener. The
// chrome stub below is only as wide as index.ts needs to boot offline: every
// call resolves, nothing reaches the network.

type Details = {
  tabId: number;
  url: string;
  type?: string;
  timeStamp?: number;
};

const noopListener = { addListener: () => {}, removeListener: () => {} };

let created: string[];
let local: Record<string, unknown>;
let tabUrl: string;
let onCompleted: ((d: Details) => void) | null;
let onUpdated:
  | ((tabId: number, info: { status?: string; url?: string }) => unknown)
  | null;

/** Let every pending promise chain in the request path settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  created = [];
  local = {};
  tabUrl = 'https://news.example/';
  onCompleted = null;
  onUpdated = null;
  vi.resetModules();
  // No feed fetch, no bundled tracker DB fetch: both are allowed to fail.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test',
      getURL: (p: string) => p,
      getManifest: () => ({ version: '0.0.0' }),
      setUninstallURL: () => {},
      onSuspend: noopListener,
      onMessage: noopListener,
      onInstalled: noopListener,
      onStartup: noopListener,
    },
    storage: {
      local: {
        get: async (keys: unknown) => {
          const names =
            typeof keys === 'string'
              ? [keys]
              : Array.isArray(keys)
                ? (keys as string[])
                : Object.keys((keys ?? {}) as object);
          const out: Record<string, unknown> = {};
          for (const n of names) if (n in local) out[n] = local[n];
          return out;
        },
        set: async (o: Record<string, unknown>) => {
          Object.assign(local, o);
        },
        remove: async (keys: string | string[]) => {
          for (const n of Array.isArray(keys) ? keys : [keys]) delete local[n];
        },
      },
      session: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      onChanged: noopListener,
    },
    i18n: { getUILanguage: () => 'en' },
    action: {
      setBadgeBackgroundColor: () => {},
      setBadgeText: () => {},
      setBadgeTextColor: () => {},
    },
    tabs: {
      get: async (tabId: number) => ({ id: tabId, url: tabUrl }),
      query: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      onActivated: noopListener,
      onRemoved: noopListener,
      onUpdated: {
        addListener: (fn: (tabId: number, info: { status?: string }) => unknown) => {
          onUpdated = fn;
        },
      },
    },
    alarms: {
      create: async () => {},
      clear: async () => {},
      get: async () => undefined,
      onAlarm: noopListener,
    },
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {},
      getSessionRules: async () => [],
      updateSessionRules: async () => {},
      getEnabledRulesets: async () => [],
      updateEnabledRulesets: async () => {},
    },
    webRequest: {
      onBeforeRequest: noopListener,
      onCompleted: {
        addListener: (fn: (d: Details) => void) => {
          onCompleted = fn;
        },
      },
      onErrorOccurred: noopListener,
    },
    notifications: {
      create: (id: string) => {
        created.push(id);
      },
      onButtonClicked: noopListener,
      onClicked: noopListener,
    },
  };
});

const DANGEROUS = 'bad.example';

async function bootWorker(): Promise<void> {
  const risk = await import('./risk');
  risk.setMalwareOverride([DANGEROUS]);
  await import('./index');
  await flush();
  expect(onCompleted).not.toBeNull();
}

/** One completed third-party request to `host` in `tabId`. */
async function complete(tabId: number, host: string, n: number): Promise<void> {
  onCompleted!({
    tabId,
    url: `https://${host}/beacon-${n}.gif`,
    type: 'image',
    timeStamp: Date.now(),
  });
  await flush();
}

async function navigate(tabId: number): Promise<void> {
  expect(onUpdated).not.toBeNull();
  await onUpdated!(tabId, { status: 'loading' });
  await flush();
}

describe('dangerous-connection notification', () => {
  it('fires once per tab however many requests reach the domain', async () => {
    // An allowed false positive is still malware to the threat DB, so a page
    // embedding it completes request after request to a "dangerous" host.
    await bootWorker();
    for (let i = 0; i < 5; i++) await complete(1, DANGEROUS, i);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/^danger-bad\.example-\d+$/);
  });

  it('warns once more on the next navigation', async () => {
    await bootWorker();
    for (let i = 0; i < 3; i++) await complete(1, DANGEROUS, i);
    expect(created).toHaveLength(1);

    await navigate(1);
    for (let i = 0; i < 3; i++) await complete(1, DANGEROUS, 10 + i);
    expect(created).toHaveLength(2);
  });

  it('is per tab, not global', async () => {
    await bootWorker();
    await complete(1, DANGEROUS, 0);
    await complete(2, DANGEROUS, 0);
    await complete(2, DANGEROUS, 1);

    expect(created).toHaveLength(2);
  });

  it('says nothing about a domain that is not dangerous', async () => {
    await bootWorker();
    await complete(1, 'cdn.other.example', 0);

    expect(created).toHaveLength(0);
  });
});
