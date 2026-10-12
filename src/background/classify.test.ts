import { beforeEach, describe, expect, it, vi } from 'vitest';

// The packaged list is gitignored (CI ships an empty stand-in), so pin it here.
vi.mock('../data/malware.json', () => ({ default: ['bad.example'] }));

// classifyBlock gates ALLOW_AND_OPEN, ALLOW_FOR_SESSION_AND_OPEN and
// REPORT_FALSE_POSITIVE. The warning page that sends them is web-accessible,
// so a hostile site can open it with ?blocked=<any domain>. The packaged
// ruleset being armed must not make every domain look blocked by us.
const store: Record<string, unknown> = {};
let enabledRulesets: string[] = [];

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  enabledRulesets = [];
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
      getSessionRules: async () => [],
      updateSessionRules: async () => {},
      getEnabledRulesets: async () => enabledRulesets,
      updateEnabledRulesets: async () => {},
    },
  };
});

// The live feed has replaced the packaged list and no longer carries bad.example.
async function load() {
  const risk = await import('./risk');
  risk.setMalwareOverride(['other.example']);
  return import('./classify');
}

describe('classifyBlock with the packaged ruleset armed', () => {
  beforeEach(() => {
    enabledRulesets = ['block_rules'];
  });

  it('does not claim a domain the packaged list never carried', async () => {
    const { classifyBlock } = await load();
    expect(await classifyBlock('accounts.google.com')).toEqual({
      blockedByUs: false,
      source: null,
      country: null,
    });
  });

  it('still owns a packaged domain the live feed has dropped', async () => {
    const { classifyBlock } = await load();
    expect(await classifyBlock('bad.example')).toEqual({
      blockedByUs: true,
      source: 'feed',
      country: null,
    });
  });

  it('covers subdomains, as the packaged ||domain rule does', async () => {
    const { classifyBlock } = await load();
    expect((await classifyBlock('www.bad.example')).blockedByUs).toBe(true);
    // A name that merely ends with the same text is not a subdomain.
    expect((await classifyBlock('notbad.example')).blockedByUs).toBe(false);
  });
});

describe('classifyBlock with the packaged ruleset retired', () => {
  it('does not claim a packaged domain the live feed has dropped', async () => {
    const { classifyBlock } = await load();
    expect((await classifyBlock('bad.example')).blockedByUs).toBe(false);
  });

  it('still reports the live feed', async () => {
    const { classifyBlock } = await load();
    expect(await classifyBlock('other.example')).toEqual({
      blockedByUs: true,
      source: 'feed',
      country: null,
    });
  });
});
