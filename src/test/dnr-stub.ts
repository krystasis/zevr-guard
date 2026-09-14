/**
 * A chrome.declarativeNetRequest session-rule stub with real behaviour, shared
 * by the tests that exercise rule bookkeeping. Both pause.test.ts and
 * blocking.test.ts were hand-rolling the same thing, and a mock that quietly
 * ignores part of the API (per-tab badge writes, say) hides exactly the bugs
 * these tests exist to catch.
 */
export interface StubRule {
  id: number;
  priority?: number;
  action: { type: string };
  condition: { urlFilter?: string; resourceTypes?: string[] };
}

export interface SessionRuleStub {
  /** The rules as they stand right now. */
  read(): StubRule[];
  /** The declarativeNetRequest surface to hang on the chrome global. */
  api: {
    getSessionRules: () => Promise<StubRule[]>;
    updateSessionRules: (o: {
      removeRuleIds?: number[];
      addRules?: StubRule[];
    }) => Promise<void>;
  };
}

export function sessionRuleStub(initial: StubRule[] = []): SessionRuleStub {
  let rules = [...initial];
  return {
    read: () => rules,
    api: {
      getSessionRules: async () => rules,
      updateSessionRules: async (o) => {
        const remove = new Set(o.removeRuleIds ?? []);
        rules = rules.filter((r) => !remove.has(r.id)).concat(o.addRules ?? []);
      },
    },
  };
}
