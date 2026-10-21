// Generates src/shared/public-suffixes.json: the two-label public suffixes
// (co.jp, com.au, com.eg ...) that registrableDomain() must know about.
//
// Source is the Public Suffix List as bundled in the tldts package (already a
// devDependency of the rules build), ICANN section only. Private-section
// suffixes such as com.ru, com.de or co.cc are resale namespaces where anyone
// can register a name for a few dollars, so paypal.com.ru must keep reading
// as "paypal.com" embedded in a stranger's domain, not as PayPal's Russian
// site. tldts has no way to enumerate the list, so this probes every
// <generic>.<cc> pair instead.
//
// Re-run after `npm update tldts`:  npx tsx scripts/gen-public-suffixes.ts
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPublicSuffix } from 'tldts';

const here = dirname(fileURLToPath(import.meta.url));

// Second-level labels that country registries commonly hand out. Anything
// not in here is unknowable to this probe; the hand-written history of
// MULTI_SUFFIXES never needed more than these.
const GENERIC = [
  'com', 'net', 'org', 'gov', 'edu', 'mil', 'co', 'ac', 'or', 'ne', 'go', 'gob', 'gouv',
  'info', 'biz', 'name', 'nom', 'sch', 'web', 'ltd', 'plc', 'firm', 'press', 'id', 'in',
  'me', 'tv', 'art', 'rec', 'store', 'pro', 'law', 'med', 'nic', 'int', 'ind', 'res',
];

const out = new Set<string>();
for (let a = 97; a <= 122; a++) {
  for (let b = 97; b <= 122; b++) {
    const cc = String.fromCharCode(a) + String.fromCharCode(b);
    for (const g of GENERIC) {
      const pair = `${g}.${cc}`;
      if (getPublicSuffix(`probe.${pair}`, { allowPrivateDomains: false }) === pair) out.add(pair);
    }
  }
}

const list = [...out].sort();
const target = resolve(here, '../src/shared/public-suffixes.json');
writeFileSync(target, `${JSON.stringify(list, null, 0).replace(/,/g, ',\n')}\n`);
console.log(`${list.length} suffixes -> ${target}`);
