// Data-exfiltration watch. The user registers their own values (email, phone,
// or a free string); we watch outbound requests and warn when one of those
// values — in cleartext, url-encoded, or hashed the way ad-tech usually sends
// it (sha256 / sha1 / md5) or base64-encoded — is sent to a *third-party*
// domain. Everything is computed and matched on-device; the registered values
// and the page contents never leave the browser.

import { registrableDomain } from './lookalike';

export type WatchKind = 'email' | 'phone' | 'custom';

export interface WatchInput {
  id: string;
  kind: WatchKind;
  value: string;
}

export interface WatchEntry {
  id: string;
  kind: WatchKind;
  /** Masked form for display in settings; the raw value is never shown back. */
  display: string;
  /** Tokens matched against a lowercased haystack (cleartext + hex digests). */
  tokensLower: string[];
  /** Tokens matched case-sensitively (base64). */
  tokensRaw: string[];
}

// Short values (e.g. a 4-digit PIN) would match far too much unrelated
// traffic, so we refuse to watch anything below this normalized length.
export const MIN_WATCH_LEN = 5;

function normalize(kind: WatchKind, value: string): string {
  const v = value.trim();
  if (kind === 'phone') return v.replace(/[^\d]/g, '');
  // Ad-tech hashes the lowercased, trimmed email; mirror that for all kinds.
  return v.toLowerCase();
}

export function maskValue(kind: WatchKind, value: string): string {
  const v = value.trim();
  if (kind === 'email') {
    const at = v.indexOf('@');
    if (at > 0) {
      const name = v.slice(0, at);
      const head = name.slice(0, Math.min(2, name.length));
      return `${head}${'*'.repeat(Math.max(1, name.length - head.length))}${v.slice(at)}`;
    }
  }
  if (v.length <= 4) return '*'.repeat(v.length);
  return `${v.slice(0, 2)}${'*'.repeat(v.length - 4)}${v.slice(-2)}`;
}

async function digestHex(algo: 'SHA-256' | 'SHA-1', s: string): Promise<string> {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function base64Of(s: string): string {
  // Handle non-ASCII (e.g. Japanese names) via UTF-8 bytes.
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Compute match tokens for one watched value. Null if it is too short. */
export async function computeEntry(input: WatchInput): Promise<WatchEntry | null> {
  const norm = normalize(input.kind, input.value);
  if (norm.length < MIN_WATCH_LEN) return null;
  const [sha256, sha1] = await Promise.all([
    digestHex('SHA-256', norm),
    digestHex('SHA-1', norm),
  ]);
  const md5 = md5Hex(norm);
  return {
    id: input.id,
    kind: input.kind,
    display: maskValue(input.kind, input.value),
    tokensLower: [norm, sha256, sha1, md5],
    tokensRaw: [base64Of(norm)],
  };
}

export interface Haystack {
  lower: string;
  raw: string;
}

/** Build searchable haystacks from a request URL and decoded body. */
export function buildHaystack(url: string, body: string): Haystack {
  const raw = `${url}\n${body}`;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    // malformed percent-encoding — keep the raw form only
  }
  const combined = decoded === raw ? raw : `${raw}\n${decoded}`;
  return { lower: combined.toLowerCase(), raw: combined };
}

/** Return the watched entries whose value appears in the haystack. */
export function scan(hay: Haystack, entries: WatchEntry[]): WatchEntry[] {
  const hits: WatchEntry[] = [];
  for (const e of entries) {
    const lowerHit = e.tokensLower.some((t) => t.length > 0 && hay.lower.includes(t));
    const rawHit = e.tokensRaw.some((t) => t.length > 0 && hay.raw.includes(t));
    if (lowerHit || rawHit) hits.push(e);
  }
  return hits;
}

/**
 * True when the request leaves the page's own site. A first-party send (you
 * typing your email into the site you're on) is expected and must not warn.
 */
export function isThirdPartySend(
  initiator: string | undefined,
  requestUrl: string,
): boolean {
  if (!initiator) return false; // no page context — don't guess, stay quiet
  try {
    const initHost = registrableDomain(new URL(initiator).hostname);
    const reqHost = registrableDomain(new URL(requestUrl).hostname);
    if (!initHost || !reqHost) return false;
    return initHost !== reqHost;
  } catch {
    return false;
  }
}

const MAX_BODY = 64 * 1024;

/** Flatten a webRequest requestBody into a searchable string. */
export function extractBody(
  rb: chrome.webRequest.WebRequestBody | undefined,
): string {
  if (!rb) return '';
  if (rb.formData) {
    return Object.entries(rb.formData)
      .map(([k, vs]) => `${k}=${(vs ?? []).join(',')}`)
      .join('&');
  }
  const raw = (rb as { raw?: { bytes?: ArrayBuffer }[] }).raw;
  if (raw) {
    let out = '';
    for (const el of raw) {
      if (el.bytes) {
        try {
          out += new TextDecoder().decode(el.bytes);
        } catch {
          // binary chunk — skip
        }
      }
      if (out.length >= MAX_BODY) break;
    }
    return out.slice(0, MAX_BODY);
  }
  return '';
}

// --- Compact MD5 (public-domain algorithm) --------------------------------
// crypto.subtle has no MD5, but a lot of ad-tech still sends md5(email), so we
// implement it directly. Operates on the UTF-8 bytes of the input.
function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return md5Bytes(bytes);
}

function md5Bytes(msg: Uint8Array): string {
  const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));
  const add = (a: number, b: number) => (a + b) | 0;

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
    9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21,
  ];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  }

  const origLen = msg.length;
  const bitLen = origLen * 8;
  const withOne = origLen + 1;
  const padded = ((withOne + 8 + 63) & ~63) >>> 0;
  const buf = new Uint8Array(padded);
  buf.set(msg);
  buf[origLen] = 0x80;
  // 64-bit little-endian length (high 32 bits assumed 0 for our short inputs).
  buf[padded - 8] = bitLen & 0xff;
  buf[padded - 7] = (bitLen >>> 8) & 0xff;
  buf[padded - 6] = (bitLen >>> 16) & 0xff;
  buf[padded - 5] = (bitLen >>> 24) & 0xff;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;

  const M = new Int32Array(16);
  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      M[i] = buf[j] | (buf[j + 1] << 8) | (buf[j + 2] << 16) | (buf[j + 3] << 24);
    }
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = add(add(add(F, A), K[i]), M[g]);
      A = D;
      D = C;
      C = B;
      B = add(B, rotl(F, S[i]));
    }
    a0 = add(a0, A);
    b0 = add(b0, B);
    c0 = add(c0, C);
    d0 = add(d0, D);
  }

  const toHex = (n: number) => {
    let h = '';
    for (let i = 0; i < 4; i++) {
      h += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    }
    return h;
  };
  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}
