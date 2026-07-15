// Produce a Firefox (Gecko) package from an existing Chromium build.
//
// The runtime code is already cross-browser (src/shared/compat.ts); only
// the manifest needs translating:
//   - Firefox runs MV3 backgrounds as event pages, not service workers
//   - the side panel becomes a sidebar_action
//   - AMO requires a gecko id and a data-collection declaration
//
// Usage: node scripts/build-firefox.mjs   (expects dist/ to exist)

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'dist-firefox');

if (!existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('dist/ not found — run `npm run build` (or build:app) first.');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
cpSync(DIST, OUT, { recursive: true });
// Chrome keeps .vite/ metadata in the build output; AMO flags hidden dirs.
rmSync(path.join(OUT, '.vite'), { recursive: true, force: true });

const manifest = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));

// Strip Chrome-only manifest keys Firefox does not recognize. They are
// harmless (Firefox ignores them) but each one prints a load-time warning
// and clutters the AMO review. default_badge_text is empty anyway — the
// badge is set at runtime via setBadgeText — and use_dynamic_url has no
// Firefox equivalent (web-accessible resources already get static URLs).
if (manifest.action) delete manifest.action.default_badge_text;
for (const entry of manifest.web_accessible_resources ?? []) {
  delete entry.use_dynamic_url;
}

// Event page instead of a service worker. The crx loader is a plain ES
// module import, which Firefox accepts as a module background script.
manifest.background = {
  scripts: [manifest.background.service_worker],
  type: 'module',
};

// chrome.sidePanel does not exist on Gecko; the sidebar covers it and
// compat.ts falls back to sidebarAction.open() at runtime.
manifest.permissions = manifest.permissions.filter((p) => p !== 'sidePanel');
manifest.sidebar_action = {
  default_panel: 'src/sidepanel/index.html',
  default_title: '__MSG_extName__',
  default_icon: manifest.icons,
  open_at_install: false,
};

manifest.browser_specific_settings = {
  gecko: {
    id: 'zevr-guard@zevrhq.com',
    // declarativeNetRequest landed in 113; getUserSettings and friends
    // are all optional at runtime. 115 is the current ESR floor.
    strict_min_version: '115.0',
    // AMO requires new submissions to declare data collection.
    data_collection_permissions: {
      required: ['none'],
    },
  },
};

writeFileSync(
  path.join(OUT, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

// addons-linter refuses to parse .json files above its size cap and turns
// that into a validation error, which blocks the AMO upload. The bundled
// tracker DB (~8MB) is only ever read via fetch().json(), so the extension
// does not care about its filename: ship it as .dat on Firefox and patch
// the single hashed reference in the built JS.
const assetsDir = path.join(OUT, 'assets');
const bigJson = readdirSync(assetsDir).filter(
  (f) => f.startsWith('trackers-') && f.endsWith('.json'),
);
for (const name of bigJson) {
  const renamed = `${name.slice(0, -'.json'.length)}.dat`;
  renameSync(path.join(assetsDir, name), path.join(assetsDir, renamed));
  for (const js of readdirSync(assetsDir).filter((f) => f.endsWith('.js'))) {
    const jsPath = path.join(assetsDir, js);
    const src = readFileSync(jsPath, 'utf8');
    if (src.includes(name)) {
      writeFileSync(jsPath, src.replaceAll(name, renamed));
    }
  }
  const war = JSON.stringify(manifest.web_accessible_resources ?? []);
  if (war.includes(name)) {
    manifest.web_accessible_resources = JSON.parse(war.replaceAll(name, renamed));
    writeFileSync(
      path.join(OUT, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
  }
}

const version = manifest.version;
const zip = path.join(ROOT, 'release', `zevr-guard-firefox-v${version}.zip`);
mkdirSync(path.join(ROOT, 'release'), { recursive: true });
rmSync(zip, { force: true });
execFileSync('zip', ['-rq', zip, '.'], { cwd: OUT });
console.log(`firefox package: ${path.relative(ROOT, zip)}`);
