import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chrome stub with real session-rule, alarm and session-storage behaviour,
// so the tests exercise the bookkeeping rather than a mock's return values.
interface Rule {
  id: number;
  priority: number;
  action: { type: string };
  condition: { urlFilter?: string; resourceTypes?: string[] };
}

let rules: Rule[];
let alarms: Record<string, number>;
let session: Record<string, unknown>;
let badge: { text: string | null };
let alarmHandler: ((a: { name: string }) => void) | null;

beforeEach(() => {
  rules = [];
  alarms = {};
  session = {};
  badge = { text: null };
  alarmHandler = null;
  vi.resetModules();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'test', getURL: (p: string) => p },
    declarativeNetRequest: {
      getSessionRules: async () => rules,
      updateSessionRules: async (o: { removeRuleIds?: number[]; addRules?: Rule[] }) => {
        const remove = new Set(o.removeRuleIds ?? []);
        rules = rules.filter((r) => !remove.has(r.id)).concat(o.addRules ?? []);
      },
    },
    storage: {
      session: {
        get: async (k: string) => ({ [k]: session[k] }),
        set: async (o: Record<string, unknown>) => Object.assign(session, o),
        remove: async (k: string) => {
          delete session[k];
        },
      },
    },
    alarms: {
      create: async (name: string, o: { when: number }) => {
        alarms[name] = o.when;
      },
      clear: async (name: string) => {
        delete alarms[name];
      },
      onAlarm: {
        addListener: (fn: (a: { name: string }) => void) => {
          alarmHandler = fn;
        },
      },
    },
    action: {
      setBadgeBackgroundColor: () => {},
      setBadgeTextColor: () => {},
      setBadgeText: (o: { text: string; tabId?: number }) => {
        if (o.tabId === undefined) badge.text = o.text;
      },
    },
    tabs: { query: async () => [] },
  };
});

async function load() {
  return import('./pause');
}

describe('global pause', () => {
  it('installs exactly one allow-everything rule, above the per-domain band', async () => {
    const { pauseAll, GLOBAL_PAUSE_RULE_ID, isPaused } = await load();
    const { SESSION_ALLOW_ID_BASE } = await import('./blocking');

    await pauseAll(null);
    expect(rules).toHaveLength(1);
    const [r] = rules;
    expect(r.id).toBe(GLOBAL_PAUSE_RULE_ID);
    expect(r.id).toBeGreaterThan(SESSION_ALLOW_ID_BASE);
    expect(r.action.type).toBe('allow');
    expect(r.condition.urlFilter).toBe('*');
    expect(r.condition.resourceTypes).toContain('main_frame');
    // Must outrank the feed's redirect (2) and block (1).
    expect(r.priority).toBeGreaterThan(2);
    expect(isPaused()).toBe(true);
  });

  it('is idempotent and lets a later choice replace an earlier deadline', async () => {
    const { pauseAll } = await load();
    await pauseAll(5);
    const firstDeadline = alarms['zg-pause-expiry'];
    expect(firstDeadline).toBeGreaterThan(Date.now());

    await pauseAll(60);
    expect(rules).toHaveLength(1);
    // The 5-minute alarm must not survive to cut the hour short.
    expect(Object.keys(alarms)).toHaveLength(1);
    expect(alarms['zg-pause-expiry']).toBeGreaterThan(firstDeadline);
  });

  it('"until the browser closes" sets no deadline at all', async () => {
    const { pauseAll, getPauseState } = await load();
    await pauseAll(null);
    expect(alarms['zg-pause-expiry']).toBeUndefined();
    expect((await getPauseState()).until).toBeNull();
  });

  it('resuming clears the rule, the alarm, the badge and the stored state', async () => {
    const { pauseAll, resumeAll, isPaused } = await load();
    await pauseAll(5);
    expect(badge.text).toBeTruthy();

    await resumeAll();
    expect(rules).toHaveLength(0);
    expect(alarms).toEqual({});
    expect(session).toEqual({});
    expect(badge.text).toBe('');
    expect(isPaused()).toBe(false);
  });

  it('expires on its own when the alarm fires', async () => {
    const { pauseAll, isPaused } = await load();
    await pauseAll(5);
    expect(alarmHandler).not.toBeNull();

    alarmHandler!({ name: 'zg-pause-expiry' });
    await new Promise((r) => setTimeout(r, 0));
    expect(isPaused()).toBe(false);
    expect(rules).toHaveLength(0);
  });

  it('expires even if the alarm never fired', async () => {
    // The worker can sleep straight past its own deadline; the hot path must
    // not keep reporting "paused" because of it.
    const { pauseAll, isPaused } = await load();
    await pauseAll(5);
    session['zg.pause'] = { since: Date.now() - 600_000, until: Date.now() - 1 };
    const { reconcilePause } = await load();
    void reconcilePause();
    await new Promise((r) => setTimeout(r, 0));
    expect(isPaused()).toBe(false);
  });

  it('does not answer "not paused" before the state is restored', async () => {
    // A worker woken by the first navigation of a paused session used to say
    // protection was on, and fire the interstitials the pause exists to stop.
    const first = await load();
    await first.pauseAll(null);
    const keptRules = rules;
    const keptSession = session;

    vi.resetModules();
    rules = keptRules;
    session = keptSession;
    const second = await load();
    let ready = false;
    void second.pauseReady().then(() => {
      ready = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(ready).toBe(false); // nothing known yet, so callers must wait
    await second.reconcilePause();
    await second.pauseReady();
    expect(second.isPaused()).toBe(true);
  });

  it('stays paused when the rule cannot be removed', async () => {
    const { pauseAll, resumeAll, isPaused } = await load();
    await pauseAll(60);
    const chromeObj = (globalThis as unknown as { chrome: { declarativeNetRequest: Record<string, unknown> } }).chrome;
    chromeObj.declarativeNetRequest.updateSessionRules = async () => {
      throw new Error('quota');
    };
    const ok = await resumeAll();
    expect(ok).toBe(false);
    // Reporting "protection active" with an allow-everything rule still
    // installed is the one outcome that must not happen.
    expect(isPaused()).toBe(true);
  });

  it('restores state from the rule after a worker restart', async () => {
    const first = await load();
    await first.pauseAll(null);
    const keptRules = rules;
    const keptSession = session;

    // Fresh module instance = the worker came back with empty memory.
    vi.resetModules();
    rules = keptRules;
    session = keptSession;
    const second = await load();
    expect(second.isPaused()).toBe(false); // nothing known yet
    await second.reconcilePause();
    expect(second.isPaused()).toBe(true);
    expect((await second.getPauseState()).until).toBeNull();
  });

  it('treats a missing rule as not paused, whatever the stored state says', async () => {
    session['zg.pause'] = { since: Date.now(), until: null };
    const { reconcilePause, isPaused } = await load();
    await reconcilePause();
    expect(isPaused()).toBe(false);
    expect(session['zg.pause']).toBeUndefined();
  });
});
