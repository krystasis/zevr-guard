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
