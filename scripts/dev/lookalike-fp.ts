// False-positive survey for the lookalike detector.
//
// Runs detectLookalike() over the Tranco snapshot (top 50k registrable
// domains) and prints every hit, split into the protected band (top 10k) and
// the review band (10k–50k — a human reads it; see docs/sources/tranco.md
// for why that band is not automatically trusted).
//
// Gate (exit code): no protected-band hit outside the tracker DB. Hits the
// tracker DB attributes to a company are skipped at runtime
// (checkNavigation → lookupTracker), so they cost nothing in practice; the
// lookup here walks the same way (exact key, then parent domains).
//
// Run it before changing a rule and after adding brands:
//   npx vite-node scripts/dev/lookalike-fp.ts
import '../../src/test/setup';
import brandList from '../../src/data/brands.json';
import tranco from '../../src/data/tranco.snapshot.json';
import trackers from '../../src/data/trackers.json';
import { detectLookalike } from '../../src/background/lookalike';

const PROTECTED = 10_000;

const TRACKER_KEYS = trackers as Record<string, unknown>;
/** Mirrors lookupTracker(): the host itself or any parent domain is a key. */
function trackerKnows(domain: string): boolean {
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts.slice(i).join('.') in TRACKER_KEYS) return true;
  }
  return false;
}

interface Row {
  rank: number;
  domain: string;
  reason: string;
  brand: string;
  tracker: boolean;
}

const rows: Row[] = [];
(tranco as string[]).forEach((domain, i) => {
  const hit = detectLookalike(domain);
  if (hit) {
    rows.push({
      rank: i + 1,
      domain,
      reason: hit.reason,
      brand: hit.brand,
      tracker: trackerKnows(domain),
    });
  }
});

function print(title: string, list: Row[]): void {
  console.log(`\n== ${title} (${list.length}) ==`);
  for (const r of list) {
    console.log(
      `${String(r.rank).padStart(6)}  ${r.domain.padEnd(32)} ${r.reason.padEnd(10)} ${r.brand.padEnd(22)} ${r.tracker ? 'tracker' : ''}`,
    );
  }
}

const protectedBand = rows.filter((r) => r.rank <= PROTECTED);
const reviewBand = rows.filter((r) => r.rank > PROTECTED);
print(`top ${PROTECTED} — every hit must be tracker-DB covered`, protectedBand);
print(`review band ${PROTECTED + 1}–${(tranco as string[]).length}`, reviewBand);

const brandSelfHits = (brandList as string[]).filter((d) => detectLookalike(d));
console.log(`\nbrand domains flagged: ${brandSelfHits.length}`, brandSelfHits);

const byRule = (list: Row[]) =>
  Object.entries(
    list.reduce<Record<string, number>>((acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1;
      return acc;
    }, {}),
  );
console.log('protected band by rule:', byRule(protectedBand));
console.log('review band by rule:', byRule(reviewBand));
console.log(`protected band not covered by the tracker DB: ${protectedBand.filter((r) => !r.tracker).length}`);

process.exitCode = protectedBand.filter((r) => !r.tracker).length === 0 ? 0 : 1;
