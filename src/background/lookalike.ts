import brandList from '../data/brands.json';
import { ensureTrackerDB, lookupTracker } from './risk';
import { getSettings, getTodayStats, markTodayDirty } from './storage';
import { matchesDomainOrParent } from './blocking';

// ---------------------------------------------------------------------------
// Lookalike phishing detection.
//
// Blocklists only cover domains that are already known. This module catches
// the freshly-registered kind: domains crafted to *look like* a well-known
// brand. Everything runs on-device against a bundled brand list — no URL
// ever leaves the browser.
//
// Three signals, all deliberately conservative (a false positive costs the
// user a one-click interstitial, but too many of them costs trust):
//
//  1. brand embedding   paypal.com.secure-login.xyz
//  2. homoglyph         аpple.com (Cyrillic а), paypa1.com (digit swap)
//  3. typosquat         amazom.com, boooking.com (edit distance 1)
// ---------------------------------------------------------------------------

export type LookalikeReason = 'embedding' | 'homoglyph' | 'typosquat';

export interface LookalikeHit {
  brand: string;
  reason: LookalikeReason;
}

// --- registrable-domain approximation --------------------------------------

// Shared with the UI grouping code; re-exported so existing call sites keep
// importing it from here.
export { registrableDomain } from '../shared/domain';
import { registrableDomain } from '../shared/domain';

// --- punycode (RFC 3492 decode only) ----------------------------------------

const PC_BASE = 36;
const PC_TMIN = 1;
const PC_TMAX = 26;
const PC_SKEW = 38;
const PC_DAMP = 700;

function pcAdapt(delta: number, numPoints: number, firstTime: boolean): number {
  delta = firstTime ? Math.floor(delta / PC_DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((PC_BASE - PC_TMIN) * PC_TMAX) >> 1) {
    delta = Math.floor(delta / (PC_BASE - PC_TMIN));
    k += PC_BASE;
  }
  return k + Math.floor(((PC_BASE - PC_TMIN + 1) * delta) / (delta + PC_SKEW));
}

/** Decode one punycode label (without the "xn--" prefix). Null on garbage. */
function punycodeDecode(input: string): string | null {
  const output: number[] = [];
  const lastDelim = input.lastIndexOf('-');
  if (lastDelim > 0) {
    for (const ch of input.slice(0, lastDelim)) {
      const cp = ch.codePointAt(0)!;
      if (cp >= 0x80) return null;
      output.push(cp);
    }
  }

  let n = 128;
  let i = 0;
  let bias = 72;
  let idx = lastDelim > 0 ? lastDelim + 1 : 0;

  while (idx < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = PC_BASE; ; k += PC_BASE) {
      if (idx >= input.length) return null;
      const c = input.charCodeAt(idx++);
      const digit =
        c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : PC_BASE;
      if (digit >= PC_BASE) return null;
      i += digit * w;
      const t = k <= bias ? PC_TMIN : k >= bias + PC_TMAX ? PC_TMAX : k - bias;
      if (digit < t) break;
      w *= PC_BASE - t;
    }
    const numPoints = output.length + 1;
    bias = pcAdapt(i - oldi, numPoints, oldi === 0);
    n += Math.floor(i / numPoints);
    i %= numPoints;
    if (n > 0x10ffff) return null;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

function decodeLabel(label: string): string {
  if (!label.startsWith('xn--')) return label;
  return punycodeDecode(label.slice(4)) ?? label;
}

// --- confusable folding ------------------------------------------------------

// Non-Latin characters that render (near-)identically to a Latin letter in
// common UI fonts. Only high-confidence pairs — folding is what turns a
// visual trick back into the brand name it imitates.
const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
  'і': 'i', 'ѕ': 's', 'ј': 'j', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'к': 'k',
  'м': 'm', 'т': 't', 'г': 'r', 'һ': 'h', 'ӏ': 'l',
  // Greek
  'ο': 'o', 'α': 'a', 'ν': 'v', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'ι': 'i',
  'κ': 'k', 'χ': 'x', 'ε': 'e', 'η': 'n', 'ω': 'w', 'ϲ': 'c',
  // Latin-ish
  'ø': 'o', 'ł': 'l', 'đ': 'd', 'ħ': 'h', 'ı': 'i',
};

// ASCII substitutions typosquatters lean on.
const LEET: Record<string, string> = {
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't',
};

/**
 * Collapse a label to its visual skeleton: strip diacritics, map confusable
 * and leet characters to their Latin base, merge multi-char tricks (rn→m,
 * vv→w). Applied symmetrically to brand labels and visited labels.
 */
function fold(label: string): string {
  let s = label.toLowerCase().normalize('NFKC').normalize('NFD');
  s = s.replace(/[\u0300-\u036f]/g, '');
  let out = '';
  for (const ch of s) {
    out += CONFUSABLES[ch] ?? LEET[ch] ?? ch;
  }
  return out.replace(/rn/g, 'm').replace(/vv/g, 'w');
}

// --- edit distance 1 ---------------------------------------------------------

// Substitutions only count when the two characters are visually confusable in
// ASCII; otherwise ordinary words collide with brands (kodak↔kotak,
// strive↔stripe). Insert/delete/transpose are the classic fat-finger squats
// and stay allowed — except at position 0, where a different first letter is
// how *legitimate* words differ (booking↔cooking).
const SUB_CLASSES = ['il1j', 'o0', 'mn', 'uv', 'gq'];

function confusableSub(a: string, b: string): boolean {
  return SUB_CLASSES.some((cls) => cls.includes(a) && cls.includes(b));
}

/** True when `candidate` is one risky edit away from `brand`. */
function isTyposquatOf(candidate: string, brand: string): boolean {
  if (candidate === brand) return false;
  if (candidate === `${brand}s`) return false; // plural — usually a real word

  const la = candidate.length;
  const lb = brand.length;

  if (la === lb) {
    let first = -1;
    let count = 0;
    for (let i = 0; i < la; i++) {
      if (candidate[i] !== brand[i]) {
        if (count === 0) first = i;
        count++;
        if (count > 2) return false;
      }
    }
    if (count === 1) {
      return first > 0 && confusableSub(candidate[first], brand[first]);
    }
    // adjacent transposition
    return (
      count === 2 &&
      first > 0 &&
      candidate[first] === brand[first + 1] &&
      candidate[first + 1] === brand[first] &&
      candidate.slice(first + 2) === brand.slice(first + 2)
    );
  }

  if (Math.abs(la - lb) !== 1) return false;
  const long = la > lb ? candidate : brand;
  const short = la > lb ? brand : candidate;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  if (i === 0) return false; // edit at position 0
  return short.slice(i) === long.slice(i + 1);
}

// --- brand index -------------------------------------------------------------

interface Brand {
  domain: string;
  label: string;
  suffix: string;
}

const BRANDS: Brand[] = (brandList as string[]).map((domain) => {
  const label = domain.split('.')[0];
  return { domain, label, suffix: domain.slice(label.length + 1) };
});

const BRAND_DOMAINS = new Set(BRANDS.map((b) => b.domain));
const BRAND_LABELS = new Set(BRANDS.map((b) => b.label));
const FOLDED_BRANDS = new Map<string, Brand>();
const BRANDS_BY_SUFFIX = new Map<string, Brand[]>();
for (const b of BRANDS) {
  if (!FOLDED_BRANDS.has(fold(b.label))) FOLDED_BRANDS.set(fold(b.label), b);
  const arr = BRANDS_BY_SUFFIX.get(b.suffix) ?? [];
  arr.push(b);
  BRANDS_BY_SUFFIX.set(b.suffix, arr);
}

function isIpHost(host: string): boolean {
  return host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

// --- detection ---------------------------------------------------------------

export function detectLookalike(rawHost: string): LookalikeHit | null {
  let host = rawHost.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host.includes('.') || isIpHost(host)) return null;

  const reg = registrableDomain(host);
  if (BRAND_DOMAINS.has(reg)) return null;

  const asciiLabel = reg.split('.')[0];
  const label = decodeLabel(asciiLabel);
  // Same label on another TLD (amazon.de, paypal.co) is either the brand's
  // own property or beyond what a heuristic can judge — leave it alone.
  if (BRAND_LABELS.has(label)) return null;

  // 1. Brand domain embedded as a leading subdomain chain.
  for (const b of BRANDS) {
    if (host.startsWith(`${b.domain}.`) || host.includes(`.${b.domain}.`)) {
      return { brand: b.domain, reason: 'embedding' };
    }
  }

  // 2. Visual skeleton collides with a brand label.
  const folded = FOLDED_BRANDS.get(fold(label));
  if (folded && label !== folded.label) {
    return { brand: folded.domain, reason: 'homoglyph' };
  }

  // 3. One risky edit away from a brand on the same suffix.
  if (label === asciiLabel && label.length >= 5) {
    const suffix = reg.slice(asciiLabel.length + 1);
    for (const b of BRANDS_BY_SUFFIX.get(suffix) ?? []) {
      if (b.label.length >= 6 && isTyposquatOf(label, b.label)) {
        return { brand: b.domain, reason: 'typosquat' };
      }
    }
  }

  return null;
}

// --- session bypass ("proceed anyway") ---------------------------------------

const BYPASS_KEY = 'zg.lookalike.bypass';
// Fallback for profiles where chrome.storage.session is unavailable; lives
// as long as the service worker, which is still better than nothing.
const memoryBypass = new Set<string>();

async function getBypassed(): Promise<Set<string>> {
  try {
    const s = await chrome.storage.session.get(BYPASS_KEY);
    return new Set([...((s[BYPASS_KEY] as string[] | undefined) ?? []), ...memoryBypass]);
  } catch {
    return memoryBypass;
  }
}

/** True when the user chose "proceed anyway" for this host this session. */
export async function isLookalikeBypassed(host: string): Promise<boolean> {
  return matchesDomainOrParent(host.toLowerCase(), await getBypassed());
}

export async function addLookalikeBypass(host: string): Promise<void> {
  memoryBypass.add(host);
  try {
    const current = await getBypassed();
    current.add(host);
    await chrome.storage.session.set({ [BYPASS_KEY]: [...current] });
  } catch {
    // memory fallback already updated
  }
}

// --- navigation hook -----------------------------------------------------------

/**
 * Called on every main-frame request. When the destination looks like a brand
 * imitation, swap the tab over to the warning interstitial. The original URL
 * rides along so "proceed anyway" can resume the navigation.
 */
export async function checkNavigation(tabId: number, rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (!/^https?:$/.test(url.protocol)) return;

  const host = url.hostname.toLowerCase();
  if (!host || isIpHost(host)) return;

  const hit = detectLookalike(host);
  if (!hit) return;

  // A domain the tracker DB can attribute to a company is an established
  // property, not a fresh phishing registration.
  await ensureTrackerDB();
  if (lookupTracker(host)) return;

  const bypassed = await getBypassed();
  if (matchesDomainOrParent(host, bypassed)) return;

  const settings = await getSettings();
  if (matchesDomainOrParent(host, new Set(settings.customWhiteList))) return;
  if (settings.pausedSites.includes(host)) return;

  const warningUrl = chrome.runtime.getURL(
    `src/warning/index.html?blocked=${encodeURIComponent(host)}` +
      `&reason=lookalike&brand=${encodeURIComponent(hit.brand)}` +
      `&url=${encodeURIComponent(rawUrl)}`,
  );
  try {
    await chrome.tabs.update(tabId, { url: warningUrl });
  } catch {
    return; // tab is gone
  }

  const today = await getTodayStats();
  today.dangerousDetected += 1;
  markTodayDirty();
}
