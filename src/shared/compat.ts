// Cross-browser glue. Firefox exposes the promise-based `browser`
// namespace; its `chrome` alias historically used callbacks, while this
// codebase awaits chrome.* calls everywhere. Point the global `chrome`
// at `browser` when it exists — a no-op on Chromium.
type BrowserGlobal = typeof chrome & {
  sidebarAction?: { open: () => Promise<void>; close: () => Promise<void> };
};

const g = globalThis as { browser?: BrowserGlobal; chrome?: BrowserGlobal };

// Chrome 121+ also exposes a `browser` alias, so its mere presence no longer
// means Gecko. Detect Firefox by user agent, which is available in both the
// background (event page / service worker) and page contexts.
/** True when running inside a Gecko (Firefox) extension context. */
export const IS_GECKO =
  typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);

// On Firefox, point the global `chrome` at the promise-based `browser` so the
// codebase's awaited chrome.* calls work unchanged. No-op on Chromium.
if (IS_GECKO && g.browser?.runtime?.id) {
  g.chrome = g.browser;
}

/**
 * Open the Live Globe: the side panel on Chromium, the sidebar on Firefox.
 *
 * MUST be called synchronously from a click handler with no `await` before
 * it. Firefox rejects `sidebarAction.open()` unless it runs inside the user
 * input handler, and a preceding await loses that context. The Firefox
 * branch therefore opens first (the sidebar is window-global — no tab id
 * needed); the Chromium branch does its own async tab lookup, which Chrome
 * tolerates across awaits.
 */
export function openLiveGlobe(): void {
  const sidePanel = (
    chrome as { sidePanel?: { setOptions: (o: object) => Promise<void>; open: (o: object) => Promise<void> } }
  ).sidePanel;

  if (!sidePanel) {
    void g.browser?.sidebarAction?.open();
    return;
  }

  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    await sidePanel.setOptions({
      tabId: tab.id,
      path: 'src/sidepanel/index.html',
      enabled: true,
    });
    await sidePanel.open({ tabId: tab.id });
  })();
}

/**
 * chrome.notifications.create that survives Firefox, which rejects
 * options containing `buttons`. Every button also has an onClicked
 * fallback registered by its call site, so dropping them only loses
 * the shortcut, not the action.
 */
export function createNotificationSafe(
  id: string,
  options: chrome.notifications.NotificationOptions<true> & {
    buttons?: Array<{ title: string }>;
  },
): void {
  try {
    chrome.notifications.create(id, options, () => {
      if (chrome.runtime.lastError && options.buttons) {
        const { buttons: _dropped, ...rest } = options;
        chrome.notifications.create(id, rest);
      }
    });
  } catch {
    try {
      const { buttons: _dropped, ...rest } = options;
      chrome.notifications.create(id, rest);
    } catch {
      // notifications are best-effort
    }
  }
}

/** Store review page for the browser this build is actually running in. */
export function reviewPageUrl(): string {
  const ua = navigator.userAgent;
  if (ua.includes(' Edg/')) {
    return `https://microsoftedge.microsoft.com/addons/detail/${chrome.runtime.id}`;
  }
  if (ua.includes('Firefox/')) {
    return 'https://addons.mozilla.org/firefox/addon/zevr-guard/';
  }
  return `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`;
}
