import { beforeEach, describe, expect, it, vi } from 'vitest';

// The warning page's "Unblock <country>" button renders only when the
// background says a country rule is what blocks this domain. Country rules are
// dynamic rules like any other, so classifyBlock has to ask the country
// bookkeeping before its generic dynamic-rule sweep — otherwise the sweep
// claims them as the user's own block and the button disappears, which is
// exactly what happened once.
const store: Record<string, unknown> = {};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.resetModules();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'test', getURL: (p: string) => p, onSuspend: { addListener: () => {} } },
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (o: Record<string, unknown>) => Object.assign(store, o),
      },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener: () => {} },
    },
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {},
    },
  };
});

describe('getBlockingCountry', () => {
  it('names the country holding a rule over the domain', async () => {
    store['zg.countryRules'] = {
      'evil.example': { ids: [1000001, 1000002], country: 'RU', ts: Date.now() },
    };
    const { getBlockingCountry } = await import('./country');
    expect(await getBlockingCountry('evil.example')).toBe('RU');
  });

  it('covers subdomains of a blocked domain', async () => {
    store['zg.countryRules'] = {
      'evil.example': { ids: [1000001, 1000002], country: 'RU', ts: Date.now() },
    };
    const { getBlockingCountry } = await import('./country');
    expect(await getBlockingCountry('cdn.evil.example')).toBe('RU');
  });

  it('returns null for anything it does not hold', async () => {
    store['zg.countryRules'] = {
      'evil.example': { ids: [1000001, 1000002], country: 'RU', ts: Date.now() },
    };
    const { getBlockingCountry } = await import('./country');
    expect(await getBlockingCountry('example.com')).toBeNull();
    // A name that merely ends with the same text is not a subdomain.
    expect(await getBlockingCountry('notevil.example')).toBeNull();
  });

  it('returns null when nothing has been learned yet', async () => {
    const { getBlockingCountry } = await import('./country');
    expect(await getBlockingCountry('evil.example')).toBeNull();
  });
});
