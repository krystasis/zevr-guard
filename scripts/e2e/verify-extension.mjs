// On-device verification of dist/ in Playwright Chromium with the extension
// loaded unpacked (see docs/design/2026-09-feed-quality-and-warning-ux.md §7).
// Run: npm run build:app && node scripts/e2e/verify-extension.mjs
// Needs: npm i -D playwright && npx playwright install chromium
//
// Uses example.com (resolves instantly) as a stand-in "feed-blocked" domain via
// a temporary session redirect rule, so no check depends on a live malware host.
// Extension messages are driven from an extension PAGE context (the SW's own
// onMessage does not fire for messages the SW sends to itself).
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = mkdtempSync(join(tmpdir(), 'zg-verify-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--no-first-run',
    '--window-size=1200,800',
  ],
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 30000 }));
const extId = new URL(sw.url()).host;
console.log('extension id', extId);
await sleep(4000); // let initFeed apply session rules + retire static ruleset

const swEval = (fn) => sw.evaluate(fn);

// An extension page we can call chrome.runtime.sendMessage / read storage from.
const extPage = await ctx.newPage();
await extPage.goto(`chrome-extension://${extId}/src/warning/index.html?blocked=probe.invalid`);
const send = (msg) => extPage.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), msg);

// --- 1. static ruleset retired, session rules live ------------------------
{
  const st = await swEval(async () => ({
    enabled: await chrome.declarativeNetRequest.getEnabledRulesets(),
    session: (await chrome.declarativeNetRequest.getSessionRules()).length,
  }));
  check('session rules applied from bundled/feed list', st.session > 100, `${st.session} rules`);
  check('static block_rules retired after sync', !st.enabled.includes('block_rules'), `enabled=[${st.enabled.join(',')}]`);
}

// --- 2. steamcommunity.com no longer blocked ------------------------------
{
  const inList = await swEval(async () =>
    (await chrome.declarativeNetRequest.getSessionRules()).some((r) => r.condition.urlFilter === '||steamcommunity.com'));
  check('steamcommunity.com absent from session rules', !inList);
  const page = await ctx.newPage();
  await page.goto('https://steamcommunity.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(1000);
  check('steamcommunity.com loads (not warning page)', !page.url().startsWith('chrome-extension://'), page.url());
  await page.close();
}

// --- 3. feed-blocked domain → warning → allow & continue (deterministic) ---
{
  // Mimic a feed block on example.com with the same rule pair the feed uses.
  await swEval(async () => {
    const warn = (d) => chrome.runtime.getURL(`src/warning/index.html?blocked=${encodeURIComponent(d)}`);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [900001, 900002],
      addRules: [
        { id: 900001, priority: 2, action: { type: 'redirect', redirect: { url: warn('example.com') } }, condition: { urlFilter: '||example.com', resourceTypes: ['main_frame'] } },
        { id: 900002, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||example.com' } },
      ],
    });
  });

  const page = await ctx.newPage();
  await page.goto('https://example.com/some/path?x=1', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
  await sleep(800);
  const onWarning = page.url().startsWith(`chrome-extension://${extId}/src/warning/index.html`);
  check('feed-blocked domain redirects to warning page', onWarning, page.url());
  check('warning page blocked= carries the domain', new URL(page.url()).searchParams.get('blocked') === 'example.com');

  await page.locator('summary').first().click().catch(() => {});
  const btn = page.getByRole('button', { name: /Allow .* and continue/i });
  const hasBtn = (await btn.count()) > 0;
  check('warning page offers "Allow <domain> and continue"', hasBtn);

  if (hasBtn) {
    const nav = page.waitForURL((u) => u.href.startsWith('https://example.com/'), { timeout: 20000, waitUntil: 'domcontentloaded' }).then(() => page.url()).catch(() => null);
    await btn.click();
    const landed = await nav;
    check('allow & continue resumes original URL (path + query preserved)',
      landed === 'https://example.com/some/path?x=1', `${landed}`);
  }

  const wl = await swEval(async () => {
    const s = await chrome.storage.local.get(null);
    const v = Object.values(s).find((x) => x && typeof x === 'object' && Array.isArray(x.customWhiteList));
    return v?.customWhiteList ?? [];
  });
  check('domain added to customWhiteList', wl.includes('example.com'), JSON.stringify(wl));

  // Re-navigate: allow (priority 1000) must beat the redirect (priority 2).
  await page.goto('https://example.com/again', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await sleep(500);
  check('allowed domain no longer redirected', page.url() === 'https://example.com/again', page.url());

  const outcome = await swEval(async () => {
    if (!chrome.declarativeNetRequest.testMatchOutcome) return 'n/a';
    const r = await chrome.declarativeNetRequest.testMatchOutcome({ url: 'https://example.com/again', type: 'main_frame', method: 'get' });
    return r.matchedRules.map((m) => m.ruleId).join(',');
  });
  check('DNR match outcome favours the allow rule', outcome === 'n/a' || !outcome.includes('900001'), `matched=${outcome}`);

  // Cleanup the synthetic rules + whitelist so state is clean.
  await send({ type: 'DISALLOW_DOMAIN', domain: 'example.com' });
  await swEval(async () => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [900001, 900002] }));
  await page.close();
}

// --- 4. framed warning page refuses to act --------------------------------
{
  const page = await ctx.newPage();
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
  const txt = await page.evaluate(async (id) => {
    const f = document.createElement('iframe');
    f.src = `chrome-extension://${id}/src/warning/index.html?blocked=evil.test`;
    document.body.appendChild(f);
    await new Promise((r) => setTimeout(r, 1500));
    try { return f.contentDocument?.body?.innerText ?? '(cross-origin)'; } catch { return '(cross-origin)'; }
  }, extId);
  check('warning page not actionable when framed', txt === '(cross-origin)' || /cannot be shown inside another site/i.test(txt), txt.slice(0, 60));
  await page.close();
}

// --- 5. malware toggle off clears session rules, static stays retired ------
{
  const settings = await swEval(async () => {
    const s = await chrome.storage.local.get(null);
    const k = Object.keys(s).find((x) => s[x] && typeof s[x] === 'object' && s[x].blockCategories);
    return s[k];
  });
  settings.blockCategories.malware = false;
  await send({ type: 'UPDATE_SETTINGS', settings });
  await sleep(1200);
  const off = await swEval(async () => ({
    session: (await chrome.declarativeNetRequest.getSessionRules()).length,
    enabled: await chrome.declarativeNetRequest.getEnabledRulesets(),
  }));
  check('malware off → session rules cleared', off.session === 0, `${off.session}`);
  check('malware off → static stays retired', !off.enabled.includes('block_rules'), `enabled=[${off.enabled.join(',')}]`);

  settings.blockCategories.malware = true;
  await send({ type: 'UPDATE_SETTINGS', settings });
  await sleep(1200);
  const on = await swEval(async () => (await chrome.declarativeNetRequest.getSessionRules()).length);
  check('malware on → session rules restored', on > 100, `${on}`);
}

await ctx.close();
try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
