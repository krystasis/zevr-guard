#!/usr/bin/env bash
# Build any commit into its own loadable folder, stamped with a label, so
# several versions of the extension can sit side by side in chrome://extensions
# and be told apart at a glance.
#
#   scripts/dev/build-variant.sh <git-ref> [label]
#   scripts/dev/build-variant.sh HEAD            # -> dist-variants/HEAD
#   scripts/dev/build-variant.sh b02722a baseline
#
# Each build lands in dist-variants/<label>/ with a distinct extension id (a
# different folder means a different id), its own storage, and a version_name
# shown in chrome://extensions. version_name is stamped into the BUILT manifest
# only — the committed manifest.json is never touched, because bumping the
# real version is a release step a human does.
#
# CAVEAT, and it matters: this rebuilds the CODE of that commit against
# TODAY'S threat data. The rule files and the malware list are gitignored
# build outputs, so they are copied from the current checkout rather than
# reconstructed. An old commit built this way therefore will NOT reproduce a
# data-level bug — e.g. steamcommunity.com sitting in the 1.5.12 package —
# because the data it gets is already fixed. To see that, enable the real
# store build in chrome://extensions; its own frozen copy is at
#   ~/Library/Application Support/Google/Chrome/<profile>/Extensions/<id>/<ver>/
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"

REF="${1:?usage: build-variant.sh <git-ref> [label]}"
LABEL="${2:-$(echo "$REF" | tr '/:' '__')}"
OUT="$ROOT/dist-variants/$LABEL"
SHA="$(git rev-parse --short "$REF")"
SUBJECT="$(git log -1 --format=%s "$REF")"

# Build outputs that `npm run build:data` produces are gitignored, so a fresh
# checkout of an old commit does not have them. Reuse the current ones rather
# than re-downloading several hundred MB of upstream feeds per variant.
REUSE=(
  src/data/malware.json src/data/trackers.json
  public/rules/block_rules.json public/rules/ads_rules.json public/rules/tracking_rules.json
  assets/GeoLite2-Country.mmdb assets/GeoLite2-ASN.mmdb assets/flags
)
for f in "${REUSE[@]}"; do
  [ -e "$ROOT/$f" ] || { echo "missing build input: $f — run 'npm run build:data' once first" >&2; exit 1; }
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/zg-variant-XXXXXX")"
cleanup() { git worktree remove --force "$WORK" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> $LABEL: $SHA $SUBJECT"
git worktree add --detach --quiet "$WORK" "$REF"
ln -s "$ROOT/node_modules" "$WORK/node_modules"
for f in "${REUSE[@]}"; do
  mkdir -p "$WORK/$(dirname "$f")"
  cp -R "$ROOT/$f" "$WORK/$f"
done

( cd "$WORK" && npx vite build >/dev/null )

rm -rf "$OUT"; mkdir -p "$(dirname "$OUT")"
cp -R "$WORK/dist" "$OUT"

# Stamp the label so chrome://extensions shows which build this is.
node -e '
const fs = require("fs");
const [p, label, sha, subject] = process.argv.slice(1);
const m = JSON.parse(fs.readFileSync(p, "utf8"));
m.version_name = `${m.version} · ${label} · ${sha}`;
m.name = `[${label}] ${m.name}`;
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
console.log(`    ${m.version_name}\n    ${subject}`);
' "$OUT/manifest.json" "$LABEL" "$SHA" "$SUBJECT"

echo "    load unpacked: $OUT"
