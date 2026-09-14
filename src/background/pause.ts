import type { PauseState } from '../types';
import {
  ALLOW_ACTION,
  ALLOW_PRIORITY,
  ALL_RESOURCES,
  SESSION_GLOBAL_ID_BASE,
} from './blocking';
import { clearPausedBadge, showPausedBadge } from './badge';

// ---------------------------------------------------------------------------
// Global pause.
//
// The escape hatch for "something is broken and I cannot tell which domain did
// it". One allow-everything session rule outranks every block we have, which
// is the same trick pauseSite() uses per site, minus the initiator condition.
//
// Deliberately time-boxed and session-scoped: protection comes back on its own.
// A permanent off switch is the one thing not on offer, because the failure
// mode is a user who forgets and browses unprotected for months. Session rules
// die with the browser, so even "until the browser closes" needs no cleanup,
// and an early browser exit only ever restores protection sooner.
// ---------------------------------------------------------------------------

export const GLOBAL_PAUSE_RULE_ID = SESSION_GLOBAL_ID_BASE;
const STATE_KEY = 'zg.pause';
const EXPIRY_ALARM = 'zg-pause-expiry';

// Hot-path mirror of the rule's existence. Checked on every main-frame
// navigation, so it must not await storage; reconcilePause() restores it after
// a service-worker restart.
let pausedUntil: number | null = null;
let pausedSince: number | null = null;
let pausedNow = false;

/** True while all interruptions are suspended. Safe to call on a hot path. */
export function isPaused(): boolean {
  if (!pausedNow) return false;
  // A missed alarm (the worker was asleep past the deadline) must not leave
  // protection off: treat an elapsed deadline as resumed and tidy up.
  if (pausedUntil !== null && Date.now() >= pausedUntil) {
    void resumeAll();
    return false;
  }
  return true;
}

function snapshot(): PauseState {
  return { paused: pausedNow, until: pausedUntil, since: pausedSince };
}

async function writeState(): Promise<void> {
  try {
    if (pausedNow) {
      await chrome.storage.session.set({
        [STATE_KEY]: { since: pausedSince, until: pausedUntil },
      });
    } else {
      await chrome.storage.session.remove(STATE_KEY);
    }
  } catch {
    // session storage unavailable — the rule itself remains the source of truth
  }
}

/**
 * Suspend every block, interstitial and warning. `minutes` of null means
 * "until the browser closes", which the session rule gives us for free.
 */
export async function pauseAll(minutes: number | null): Promise<PauseState> {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return snapshot();

  const now = Date.now();
  pausedNow = true;
  pausedSince = now;
  pausedUntil = minutes === null ? null : now + minutes * 60_000;

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [GLOBAL_PAUSE_RULE_ID],
    addRules: [
      {
        id: GLOBAL_PAUSE_RULE_ID,
        priority: ALLOW_PRIORITY,
        action: { type: ALLOW_ACTION },
        condition: {
          urlFilter: '*',
          resourceTypes: ALL_RESOURCES,
        },
      },
    ],
  });

  // Replace any earlier deadline: switching 5 minutes -> 1 hour must not leave
  // the first alarm behind to cut the second short.
  try {
    await chrome.alarms.clear(EXPIRY_ALARM);
    if (pausedUntil !== null) {
      await chrome.alarms.create(EXPIRY_ALARM, { when: pausedUntil });
    }
  } catch {
    // alarms unavailable — isPaused() still expires the state lazily
  }

  await writeState();
  await showPausedBadge();
  return snapshot();
}

export async function resumeAll(): Promise<void> {
  pausedNow = false;
  pausedUntil = null;
  pausedSince = null;

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [GLOBAL_PAUSE_RULE_ID],
      addRules: [],
    });
  } catch {
    // nothing to remove
  }
  try {
    await chrome.alarms.clear(EXPIRY_ALARM);
  } catch {
    // ignore
  }
  await writeState();
  clearPausedBadge();
}

export async function getPauseState(): Promise<PauseState> {
  if (pausedNow && pausedUntil !== null && Date.now() >= pausedUntil) {
    await resumeAll();
  }
  return snapshot();
}

/**
 * Rebuild the in-memory state after a service-worker restart. The rule is the
 * authority: it and the stored deadline can only disagree if one of the two
 * writes failed, and an orphaned rule would silently leave protection off.
 */
export async function reconcilePause(): Promise<void> {
  if (!chrome.declarativeNetRequest?.getSessionRules) return;

  let hasRule = false;
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    hasRule = rules.some((r) => r.id === GLOBAL_PAUSE_RULE_ID);
  } catch {
    return;
  }

  let stored: { since?: number; until?: number | null } | undefined;
  try {
    const s = await chrome.storage.session.get(STATE_KEY);
    stored = s[STATE_KEY] as typeof stored;
  } catch {
    stored = undefined;
  }

  if (!hasRule) {
    // No rule: nothing is paused, whatever the stored state claims.
    if (stored) await resumeAll();
    return;
  }

  pausedNow = true;
  pausedSince = stored?.since ?? Date.now();
  pausedUntil = stored?.until ?? null;

  if (pausedUntil !== null && Date.now() >= pausedUntil) {
    await resumeAll();
    return;
  }
  try {
    await chrome.alarms.clear(EXPIRY_ALARM);
    if (pausedUntil !== null) {
      await chrome.alarms.create(EXPIRY_ALARM, { when: pausedUntil });
    }
  } catch {
    // ignore
  }
  await writeState();
  await showPausedBadge();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === EXPIRY_ALARM) void resumeAll();
});
