import type { RiskLevel } from '../types';

const BADGE_COLORS: Record<RiskLevel, string> = {
  safe: '#22c55e',
  tracker: '#3b82f6',
  suspicious: '#f59e0b',
  dangerous: '#ef4444',
};

export function updateBadge(tabId: number, riskLevel: RiskLevel, score: number): void {
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[riskLevel], tabId });
  chrome.action.setBadgeText({
    text: score > 0 ? String(score) : '',
    tabId,
  });
  if (chrome.action.setBadgeTextColor) {
    chrome.action.setBadgeTextColor({ color: '#ffffff', tabId });
  }
}

export function flashBlockedBadge(tabId: number, restore: () => void): void {
  chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId });
  chrome.action.setBadgeText({ text: '✕', tabId });
  setTimeout(restore, 3000);
}

export function flashDangerBadge(tabId: number): void {
  chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId });
  chrome.action.setBadgeText({ text: '!', tabId });
}

export function clearBadge(tabId: number): void {
  chrome.action.setBadgeText({ text: '', tabId });
}

// --- global pause -----------------------------------------------------------
// The paused badge is set as the *default* (no tabId), which Chrome shows on
// every tab that has no per-tab text of its own. Per-tab values win, so the
// ones already painted have to be cleared for the default to become visible.

const PAUSED_BADGE_TEXT = '||';
const PAUSED_BADGE_COLOR = '#f59e0b';

export async function showPausedBadge(): Promise<void> {
  chrome.action.setBadgeBackgroundColor({ color: PAUSED_BADGE_COLOR });
  chrome.action.setBadgeText({ text: PAUSED_BADGE_TEXT });
  if (chrome.action.setBadgeTextColor) {
    chrome.action.setBadgeTextColor({ color: '#000000' });
  }
  try {
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id !== undefined) chrome.action.setBadgeText({ text: '', tabId: tab.id });
    }
  } catch {
    // tabs unavailable — the default still shows on tabs without their own text
  }
}

export function clearPausedBadge(): void {
  chrome.action.setBadgeText({ text: '' });
  if (chrome.action.setBadgeTextColor) {
    chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }
}
