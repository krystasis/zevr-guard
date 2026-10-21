// False-positive survey for the lookalike detector.
//
// Runs detectLookalike() over the Tranco snapshot (top 50k registrable
// domains) and prints every hit, split into the protected band (top 10k —
// must be empty) and the review band (10k–50k — a human reads it; see
// docs/sources/tranco.md for why that band is not automatically trusted).
// Hits that the tracker DB attributes to a company are marked: those are
// skipped at runtime (checkNavigation), so they cost nothing in practice.
//
// Run it before changing a rule and after adding brands:
//   npx vite-node scripts/dev/lookalike-fp.ts
import '../../src/test/setup';
import brandList from '../../src/data/brands.json';
import tranco from '../../src/data/tranco.snapshot.json';
import trackers from '../../src/data/trackers.json';
import { detectLookalike, registrableDomain } from '../../src/background/lookalike';

const PROTECTED = 10_000;

const TRACKER_DOMAINS = new Set(
  Object.keys(trackers as Record<string, unknown>).map(registrableDomain),
);

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
      tracker: TRACKER_DOMAINS.has(domain),
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
print(`top ${PROTECTED} — must be empty`, protectedBand);
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
