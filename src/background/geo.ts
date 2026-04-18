import { Reader, type CountryResponse, type AsnResponse } from 'mmdb-lib';
import { Buffer } from 'buffer';
import countryCentroids from '../data/country_centroids.json';

export interface GeoData {
  country: string;
  countryCode: string;
  flag: string;
  lat: number;
  lon: number;
  org: string | null;
  isp: string | null;
  asn: string | null;
}

const CENTROIDS = countryCentroids as unknown as Record<string, [number, number]>;
const GEO_CACHE_TTL = 1000 * 60 * 60;
const geoCache = new Map<string, { data: GeoData | null; timestamp: number }>();

let countryReader: Reader<CountryResponse> | null = null;
let asnReader: Reader<AsnResponse> | null = null;
let initPromise: Promise<void> | null = null;

function getPreferredLang(): string {
  try {
    const ui = chrome.i18n.getUILanguage();
    const base = ui.split('-')[0];
    const supported = ['de', 'en', 'es', 'fr', 'ja', 'pt-BR', 'ru', 'zh-CN'];
    if (supported.includes(ui)) return ui;
    if (supported.includes(base)) return base;
  } catch {
    // ignore
  }
  return 'en';
}

async function initMMDB(): Promise<void> {
  if (countryReader && asnReader) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const [cRes, aRes] = await Promise.all([
      fetch(chrome.runtime.getURL('assets/GeoLite2-Country.mmdb')),
      fetch(chrome.runtime.getURL('assets/GeoLite2-ASN.mmdb')),
    ]);
    const [cBuf, aBuf] = await Promise.all([
      cRes.arrayBuffer(),
      aRes.arrayBuffer(),
    ]);
    countryReader = new Reader<CountryResponse>(Buffer.from(cBuf));
    asnReader = new Reader<AsnResponse>(Buffer.from(aBuf));
  })();
  try {
    await initPromise;
  } catch (err) {
    console.warn('[Zevr Guard] GeoLite2 load failed:', err);
    initPromise = null;
  }
}

function countryCodeToFlag(code: string): string {
  if (!code || code.length !== 2) return '🌐';
  return code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(0x1f1e0 + c.charCodeAt(0) - 65))
    .join('');
}

function isPrivateIP(ip: string): boolean {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return false;
}

export async function getGeoData(ip: string | undefined): Promise<GeoData | null> {
  if (!ip || isPrivateIP(ip)) return null;

  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.timestamp < GEO_CACHE_TTL) {
    return cached.data;
  }

  try {
    await initMMDB();
    if (!countryReader || !asnReader) {
      geoCache.set(ip, { data: null, timestamp: Date.now() });
      return null;
    }

    const cRec = countryReader.get(ip);
    const aRec = asnReader.get(ip);

    const code = cRec?.country?.iso_code?.toUpperCase();
    if (!code) {
      geoCache.set(ip, { data: null, timestamp: Date.now() });
      return null;
    }

    const lang = getPreferredLang();
    const names = cRec?.country?.names as Record<string, string> | undefined;
    const countryName = names?.[lang] ?? names?.en ?? code;
    const centroid = CENTROIDS[code];
    const asnOrg = aRec?.autonomous_system_organization?.trim() || null;
    const asnNum = aRec?.autonomous_system_number;

    const data: GeoData = {
      country: countryName,
      countryCode: code,
      flag: countryCodeToFlag(code),
      lat: centroid ? centroid[0] : 0,
      lon: centroid ? centroid[1] : 0,
      org: asnOrg,
      isp: asnOrg,
      asn: asnNum && asnOrg ? `AS${asnNum} ${asnOrg}` : null,
    };
    geoCache.set(ip, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    console.warn('[Zevr Guard] geo lookup failed:', err);
    geoCache.set(ip, { data: null, timestamp: Date.now() });
    return null;
  }
}

export function resolveCountryCentroid(code: string | null | undefined):
  | [number, number]
  | null {
  if (!code) return null;
  return CENTROIDS[code.toUpperCase()] ?? null;
}
