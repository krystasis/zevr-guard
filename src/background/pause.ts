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

// Until reconcilePause() has looked at the rules, memory says "not paused"
// simply because it knows nothing yet. A worker woken by the first navigation
// of a paused session would answer isPaused() === false and fire the very
// interruptions the pause exists to stop. Callers that can afford to wait
// await this first.
let resolveReady: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;

// Bumped by every deliberate change. The restore runs across several awaits,
// so it has to know whether a pause or resume overtook it: an expiry alarm
// waking a dead worker starts both at once, every time.
let generation = 0;

// Every request goes through this before it is handled, so a readiness signal
// that never arrives would stop the extension dead — no stats, no badges, no
// blocking attribution. The restore marks readiness in a finally block, and
// this timeout is the second belt: after it, the worst case is the old
// behaviour of assuming "not paused".
const READY_TIMEOUT_MS = 3000;

/** Resolves once the pause state has been restored from the live rules. */
export function pauseReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = new Promise<void>((res) => {
      resolveReady = res;
      setTimeout(res, READY_TIMEOUT_MS);
    });
  }
  return readyPromise;
}

function markReady(): void {
  pauseReady();
  resolveReady?.();
  resolveReady = null;
}

/** True while all interruptions are suspended. Safe to call on a hot path. */
export function isPaused(): boolean {
  if (!pausedNow) return false;
  // A missed alarm (the worker was asleep past the deadline) must not leave
  // protection off: treat an elapsed deadline as resumed and tidy up.
  if (pausedUntil !== null && Date.now() >= pausedUntil) {
    // Drop the flag before the async cleanup, or every isPaused() call until
    // resumeAll() lands starts another one — dozens per page load.
    pausedNow = false;
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
  const until = minutes === null ? null : now + minutes * 60_000;

  // Install the rule first. Claiming "paused" before it exists would leave the
  // popup saying protection is off while every block is still live.
  try {
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
  } catch (err) {
    console.warn('[Zevr Guard] could not pause:', (err as Error).message);
    markReady();
    return snapshot();
  }

  generation += 1;
  pausedNow = true;
  pausedSince = now;
  pausedUntil = until;

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
  markReady();
  return snapshot();
}

export async function resumeAll(): Promise<boolean> {
  // Removing an id that is not there does not reject, so a rejection here is a
  // real failure — and dropping the flags anyway would report "protection
  // active" with an allow-everything rule still installed.
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [GLOBAL_PAUSE_RULE_ID],
      addRules: [],
    });
  } catch (err) {
    console.warn('[Zevr Guard] could not resume:', (err as Error).message);
    let stillThere = true;
    try {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      stillThere = rules.some((r) => r.id === GLOBAL_PAUSE_RULE_ID);
    } catch {
      // cannot tell; assume the worst and stay paused
    }
    if (stillThere) {
      markReady();
      return false;
    }
  }

  generation += 1;
  pausedNow = false;
  pausedUntil = null;
  pausedSince = null;

  try {
    await chrome.alarms.clear(EXPIRY_ALARM);
  } catch {
    // ignore
  }
  await writeState();
  clearPausedBadge();
  markReady();
  return true;
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
  try {
    await restoreFromRules();
  } catch (err) {
    // Whatever went wrong, the request path must not be left waiting.
    console.warn('[Zevr Guard] pause restore failed:', (err as Error).message);
  } finally {
    markReady();
  }
}

async function restoreFromRules(): Promise<void> {
  if (!chrome.declarativeNetRequest?.getSessionRules) return;
  const started = generation;

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

  // A pause or resume landed while we were reading. Its view is current and
  // ours is not; writing ours would resurrect a pause the user just ended, or
  // undo one they just started.
  if (generation !== started) return;

  if (!hasRule) {
    // No rule: nothing is paused, whatever the stored state claims.
    if (stored) await resumeAll();
    return;
  }

  if (!stored) {
    // A rule with no recorded deadline. The rule itself carries no expiry, so
    // treating it as "until the browser closes" would turn a five-minute pause
    // whose bookkeeping failed into an indefinite one. Resolve toward
    // protection instead and let the user pause again if they meant to.
    await resumeAll();
    return;
  }

  pausedNow = true;
  pausedSince = stored.since ?? Date.now();
  pausedUntil = stored.until ?? null;

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
