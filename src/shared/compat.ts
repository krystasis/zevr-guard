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
 * Both browsers want the open call to happen inside the click handler, and on
 * Chromium the popup that hosts the button closes itself immediately after —
 * which tears the popup's JS context down. Anything awaited before the open
 * call is therefore racing that teardown: when the query loses, the panel
 * never opens and the click looks dead. So the async part (finding the tab and
 * registering the panel path) runs ahead of time via prepareLiveGlobe(), and
 * the click itself only dispatches the open.
 */
let globeTarget: { tabId: number } | null = null;

function sidePanelApi():
  | { setOptions: (o: object) => Promise<void>; open: (o: object) => Promise<void> }
  | undefined {
  return (
    chrome as {
      sidePanel?: { setOptions: (o: object) => Promise<void>; open: (o: object) => Promise<void> };
    }
  ).sidePanel;
}

/**
 * Resolve everything opening the globe needs, so the click handler can stay
 * synchronous. Call it when a page carrying the button mounts; it is safe to
 * call more than once and does nothing on Firefox, whose sidebar is
 * window-global and needs no tab id.
 */
export function prepareLiveGlobe(): void {
  const sidePanel = sidePanelApi();
  if (!sidePanel) return;
  void (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id == null) return;
      await sidePanel.setOptions({
        tabId: tab.id,
        path: 'src/sidepanel/index.html',
        enabled: true,
      });
      globeTarget = { tabId: tab.id };
    } catch {
      // leave globeTarget null; openLiveGlobe falls back to doing the work itself
    }
  })();
}

/**
 * Open the globe. Call it directly from the click handler, with no `await`
 * before it. The returned promise settles once the panel has been asked to
 * open, so a caller that wants to close its own window can wait for it
 * instead of racing it.
 */
export function openLiveGlobe(): Promise<void> {
  const sidePanel = sidePanelApi();

  if (!sidePanel) {
    // Firefox: window-global sidebar, no tab id, must be inside the gesture.
    return Promise.resolve(g.browser?.sidebarAction?.open?.()).then(() => undefined);
  }

  if (globeTarget) {
    return sidePanel.open({ tabId: globeTarget.tabId }).catch(() => undefined);
  }

  // prepareLiveGlobe() was never called or had not finished. Do its work now
  // and accept the race we were trying to avoid — still better than nothing.
  return (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id == null) return;
      await sidePanel.setOptions({
        tabId: tab.id,
        path: 'src/sidepanel/index.html',
        enabled: true,
      });
      await sidePanel.open({ tabId: tab.id });
    } catch {
      // nothing more to try
    }
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
