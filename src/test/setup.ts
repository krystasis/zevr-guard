// Minimal chrome stub so background modules that touch chrome.* at import
// time (storage's onSuspend listener, etc.) load cleanly under vitest.
const noopListener = { addListener: () => {}, removeListener: () => {} };

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    onSuspend: noopListener,
    onMessage: noopListener,
    getURL: (p: string) => p,
    id: 'test',
  },
  storage: {
    local: { get: async () => ({}), set: async () => {} },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: noopListener,
  },
  i18n: { getUILanguage: () => 'en' },
  declarativeNetRequest: {
    getDynamicRules: async () => [],
    updateDynamicRules: async () => {},
  },
};
