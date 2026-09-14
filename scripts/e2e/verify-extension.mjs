// On-device verification of dist/ in Playwright Chromium with the extension
// loaded unpacked (see docs/design/2026-09-feed-quality-and-warning-ux.md §7).
// Run: npm run build:app && node scripts/e2e/verify-extension.mjs
// Needs: npm i -D playwright && npx playwright install chromium
//
// Design notes that matter when editing this file:
//  - Never drive a check through a live malware host. They hang on connect,
//    the navigation never commits, and the check fails for the wrong reason.
//    example.com resolves instantly and is blocked here on purpose instead.
//  - The service worker's own onMessage does not fire for messages the SW
//    sends to itself, so extension messages are sent from an extension PAGE.
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
await sleep(4000); // let initFeed apply session rules + retire the static ruleset

const swEval = (fn) => sw.evaluate(fn);

// An extension page we can send runtime messages from.
const extPage = await ctx.newPage();
await extPage.goto(`chrome-extension://${extId}/src/warning/index.html?blocked=probe.invalid`);
const send = (msg) =>
  extPage.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), msg);

// --- 1. static ruleset retired, feed session rules live -------------------
{
  const st = await swEval(async () => ({
    enabled: await chrome.declarativeNetRequest.getEnabledRulesets(),
    session: (await chrome.declarativeNetRequest.getSessionRules()).length,
  }));
  check('feed session rules applied', st.session > 100, `${st.session} rules`);
  check('static block_rules retired after sync', !st.enabled.includes('block_rules'), `enabled=[${st.enabled.join(',')}]`);
}

// --- 2. steamcommunity.com no longer blocked ------------------------------
{
  const inList = await swEval(async () =>
    (await chrome.declarativeNetRequest.getSessionRules()).some(
      (r) => r.condition.urlFilter === '||steamcommunity.com',
    ));
  check('steamcommunity.com absent from session rules', !inList);
  const page = await ctx.newPage();
  await page.goto('https://steamcommunity.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(1000);
  check('steamcommunity.com loads (not the warning page)', !page.url().startsWith('chrome-extension://'), page.url());
  await page.close();
}

// --- 3. block context reports the right source (R5) -----------------------
{
  const feedDomain = await swEval(async () =>
    (await chrome.declarativeNetRequest.getSessionRules())
      .map((r) => r.condition.urlFilter)
      .filter((u) => u?.startsWith('||'))
      .map((u) => u.slice(2))
      .find((d) => d !== 'steamcommunity.com'));
  const feedCtx = (await send({ type: 'GET_BLOCK_CONTEXT', domain: feedDomain })).context;
  check('feed-listed domain reports source "feed"', feedCtx.blockedByUs && feedCtx.source === 'feed', JSON.stringify(feedCtx));

  const strangerCtx = (await send({ type: 'GET_BLOCK_CONTEXT', domain: 'not-blocked-by-us.example' })).context;
  check('domain we do not block reports blockedByUs=false', strangerCtx.blockedByUs === false, JSON.stringify(strangerCtx));

  const bogusCtx = (await send({ type: 'GET_BLOCK_CONTEXT', domain: 'not a hostname' })).context;
  check('invalid hostname is rejected', bogusCtx.blockedByUs === false);

  // R5: the background refuses to whitelist a domain it never blocked, even
  // though the message can be sent from the web-accessible warning page.
  const refused = await send({ type: 'ALLOW_AND_OPEN', domain: 'not-blocked-by-us.example' });
  check('ALLOW_AND_OPEN refused for a domain we do not block', refused?.success === false, JSON.stringify(refused));
  const wl = await swEval(async () => {
    const s = await chrome.storage.local.get(null);
    const v = Object.values(s).find((x) => x && typeof x === 'object' && Array.isArray(x.customWhiteList));
    return v?.customWhiteList ?? [];
  });
  check('refused domain did not reach customWhiteList', !wl.includes('not-blocked-by-us.example'), JSON.stringify(wl));
}

// --- 4. R5 in the UI: deep-linked warning page offers no way out ----------
{
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/src/warning/index.html?blocked=not-blocked-by-us.example`);
  await sleep(1200);
  const hasSummary = (await page.locator('summary').count()) > 0;
  const notice = await page.getByText(/not currently blocking this address/i).count();
  check('deep-linked warning page hides the allow control', !hasSummary, `summary=${hasSummary}`);
  check('deep-linked warning page explains why', notice > 0);
  await page.close();
}

// --- 5. real block -> warning -> allow & continue -------------------------
{
  await send({ type: 'BLOCK_DOMAIN', domain: 'example.com' });
  await sleep(500);

  const page = await ctx.newPage();
  await page.goto('https://example.com/some/path?x=1', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
  await sleep(1000);
  const onWarning = page.url().startsWith(`chrome-extension://${extId}/src/warning/index.html`);
  check('blocked domain redirects to the warning page', onWarning, page.url());
  check('warning page carries the blocked domain', new URL(page.url()).searchParams.get('blocked') === 'example.com');

  await page.locator('summary').first().click().catch(() => {});
  const btn = page.getByRole('button', { name: /Allow .* and continue/i });
  const hasBtn = (await btn.count()) > 0;
  check('warning page offers "Allow <domain> and continue"', hasBtn);

  if (hasBtn) {
    const nav = page
      .waitForURL((u) => u.href.startsWith('https://example.com/'), { timeout: 20000, waitUntil: 'domcontentloaded' })
      .then(() => page.url())
      .catch(() => null);
    await btn.click();
    check('allow & continue resumes the original URL', (await nav) === 'https://example.com/some/path?x=1', `${await nav}`);
  }

  const state = await swEval(async () => {
    const s = await chrome.storage.local.get(null);
    const v = Object.values(s).find((x) => x && typeof x === 'object' && Array.isArray(x.customWhiteList));
    const dyn = await chrome.declarativeNetRequest.getDynamicRules();
    return {
      wl: v?.customWhiteList ?? [],
      bl: v?.customBlockList ?? [],
      allow: dyn.filter((r) => r.action.type === 'allow' && r.condition.urlFilter === '||example.com').map((r) => r.priority),
    };
  });
  check('domain moved to customWhiteList', state.wl.includes('example.com'), JSON.stringify(state.wl));
  check('stale manual block was lifted', !state.bl.includes('example.com'), JSON.stringify(state.bl));
  check('allow rule created at allow priority', state.allow.includes(1000), JSON.stringify(state.allow));

  await page.goto('https://example.com/again', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await sleep(400);
  check('allowed domain no longer redirected', page.url() === 'https://example.com/again', page.url());

  await send({ type: 'DISALLOW_DOMAIN', domain: 'example.com' });
  await page.close();
}

// --- 6. framed warning page refuses to act --------------------------------
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

// --- 7. session allow rules survive a feed refresh (R6) -------------------
{
  const r = await swEval(async () => {
    // Stand in for allowDomainForSession: same id range, same shape.
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [900001],
      addRules: [{
        id: 900001, priority: 1000, action: { type: 'allow' },
        condition: { urlFilter: '||session-allow-probe.example', resourceTypes: ['main_frame'] },
      }],
    });
    const before = (await chrome.declarativeNetRequest.getSessionRules()).some((x) => x.id === 900001);
    // Force the feed mirror to rewrite its own range.
    await chrome.storage.session.remove('zg.sessionRules.applied');
    return { before };
  });
  const settings = await swEval(async () => {
    const s = await chrome.storage.local.get(null);
    const k = Object.keys(s).find((x) => s[x] && typeof s[x] === 'object' && s[x].blockCategories);
    return s[k];
  });
  await send({ type: 'UPDATE_SETTINGS', settings });
  await sleep(1500);
  const after = await swEval(async () => {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    return { survived: rules.some((x) => x.id === 900001), feed: rules.filter((x) => x.id < 900000).length };
  });
  check('session allow rule survives a feed resync', r.before && after.survived, JSON.stringify(after));
  check('feed rules were rewritten alongside it', after.feed > 100, `${after.feed}`);
  await swEval(async () => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [900001] }));
}

// --- 8. malware toggle off clears feed rules, static stays retired --------
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
  check('malware off → feed session rules cleared', off.session === 0, `${off.session}`);
  check('malware off → static stays retired', !off.enabled.includes('block_rules'), `enabled=[${off.enabled.join(',')}]`);

  settings.blockCategories.malware = true;
  await send({ type: 'UPDATE_SETTINGS', settings });
  await sleep(1200);
  const on = await swEval(async () => (await chrome.declarativeNetRequest.getSessionRules()).length);
  check('malware on → feed session rules restored', on > 100, `${on}`);
}

await ctx.close();
try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
