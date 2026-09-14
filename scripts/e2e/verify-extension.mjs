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

// Open the warning page for a domain directly. The page asks the background
// for its own context, so this renders exactly what a real redirect would.
async function ctx2Page(domain) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/src/warning/index.html?blocked=${domain}`);
  await sleep(1200);
  return p;
}

// A feed-listed domain the user will look like a regular of. visits.ts caches
// the seen-map in module scope the first time anything reads it, so this has to
// be seeded before the first navigation below triggers that read.
const establishedDomain = await swEval(async () =>
  (await chrome.declarativeNetRequest.getSessionRules())
    .map((r) => r.condition.urlFilter)
    .filter((u) => u?.startsWith('||'))
    .map((u) => u.slice(2))
    .find((d) => d.split('.').length === 2));
await sw.evaluate(async (domain) => {
  const DAY = 86400000;
  await chrome.storage.local.set({
    // The established check reads the exact-hostname map, so that one tenant
    // of a shared host cannot vouch for its neighbours.
    'zg.seenExactHosts': { [domain]: { first: Date.now() - 30 * DAY, last: Date.now(), n: 9 } },
    'zg.installedAt': Date.now() - 30 * DAY,
  });
}, establishedDomain);

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

  // Free-text input reaches these handlers now; garbage must be refused
  // rather than turned into a DNR rule (or thrown past the response).
  const badAllow = await send({ type: 'ALLOW_DOMAIN', domain: 'not a hostname' });
  const badBlock = await send({ type: 'BLOCK_DOMAIN', domain: 'http://evil.example/path' });
  check('ALLOW_DOMAIN rejects a malformed domain', badAllow?.success === false, JSON.stringify(badAllow));
  check('BLOCK_DOMAIN rejects a malformed domain', badBlock?.success === false, JSON.stringify(badBlock));

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

// --- 5b. established site -> softer variant + continue this time ----------
{
  const feedDomain = establishedDomain;
  const blockCtx = (await send({ type: 'GET_BLOCK_CONTEXT', domain: feedDomain })).context;
  check('established feed domain reports a visit history', blockCtx.established?.n === 9, JSON.stringify(blockCtx.established));

  // A neighbour on a shared host must not inherit that history.
  const neighbour = await swEval(async () =>
    (await chrome.declarativeNetRequest.getSessionRules())
      .map((r) => r.condition.urlFilter)
      .filter((u) => u?.startsWith('||'))
      .map((u) => u.slice(2))
      .find((d) => d.endsWith('.workers.dev')));
  if (neighbour) {
    const nCtx = (await send({ type: 'GET_BLOCK_CONTEXT', domain: neighbour })).context;
    check('a shared-host neighbour inherits no history', nCtx.established === null, `${neighbour} ${JSON.stringify(nCtx.established)}`);
  }

  const page = await ctx2Page(feedDomain);
  const softTitle = await page.getByText(/on today's threat list/i).count();
  check('warning page names the list the domain came from',
    (await page.getByText(/Zevr Guard's threat list|URLhaus|ThreatFox/i).count()) > 0);
  const onceBtn = page.getByRole('button', { name: /Continue this time/i });
  check('warning page shows the softer variant', softTitle > 0);
  check('warning page offers "Continue this time"', (await onceBtn.count()) > 0);

  if ((await onceBtn.count()) > 0) {
    await onceBtn.click();
    await sleep(1500);
    const st = await swEval(async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const s = await chrome.storage.local.get(null);
      const v = Object.values(s).find((x) => x && typeof x === 'object' && Array.isArray(x.customWhiteList));
      return {
        allow: rules.filter((r) => r.id >= 900000).map((r) => r.condition.urlFilter),
        wl: v?.customWhiteList ?? [],
      };
    });
    check('continue this time creates a session allow', st.allow.includes(`||${feedDomain}`), JSON.stringify(st.allow));
    check('continue this time leaves no permanent allow', st.wl.length === 0, JSON.stringify(st.wl));
  }
  // "This is a safe site" reports the block and, on request, allows it. The
  // upstream call is stubbed: the point is the extension's own behaviour.
  await page.route('https://feedback.zevrhq.com/v1/false-positive', (r) =>
    r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } }));
  const page2 = await ctx2Page(feedDomain);
  await page2.locator('summary').first().click().catch(() => {});
  const reportLink = page2.getByRole('button', { name: /safe site/i });
  check('warning page offers a false-positive report', (await reportLink.count()) > 0);
  if ((await reportLink.count()) > 0) {
    await reportLink.click();
    await page2.getByRole('button', { name: /Send report/i }).click();
    await sleep(1500);
    const wl = await swEval(async () => {
      const st = await chrome.storage.local.get(null);
      const v = Object.values(st).find((x) => x && typeof x === 'object' && Array.isArray(x.customWhiteList));
      return v?.customWhiteList ?? [];
    });
    check('reporting with "also allow" whitelists the domain', wl.includes(feedDomain), JSON.stringify(wl));
    await send({ type: 'DISALLOW_DOMAIN', domain: feedDomain });
  }
  await page2.close();

  await page.close();
  await swEval(async () => {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: rules.filter((r) => r.id >= 900000).map((r) => r.id),
    });
    await chrome.storage.local.remove(['zg.seenHosts', 'zg.seenExactHosts', 'zg.installedAt']);
  });
}

// --- 5c. every extension page renders without errors ----------------------
{
  const pages = [
    ['popup', 'src/popup/index.html'],
    ['side panel', 'src/sidepanel/index.html'],
    ['report', 'src/report/index.html'],
    ['welcome', 'src/welcome/index.html'],
  ];
  for (const [label, path] of pages) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`chrome-extension://${extId}/${path}`);
    await sleep(2500);
    const bodyLength = (await page.evaluate(() => document.body.innerText.length)) ?? 0;
    check(`${label} renders`, bodyLength > 0, `${bodyLength} chars`);
    check(`${label} logs no errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
  }
}

// --- 5d. the globe button actually asks the side panel to open -------------
{
  // The click handler used to await a tab lookup and then close the popup,
  // so the open call raced the popup's own teardown and often never ran.
  const site = await ctx.newPage();
  await site.goto('https://example.com/', { waitUntil: 'domcontentloaded' });

  const page = await ctx.newPage();
  // Report out to node: the popup closes itself once the panel has been asked
  // to open, so anything read from the page afterwards is gone.
  const opened = [];
  let closed = false;
  page.on('close', () => { closed = true; });
  await page.exposeFunction('__reportOpen', (o) => { opened.push(o); });
  await page.goto(`chrome-extension://${extId}/src/popup/index.html`);
  await sleep(2500); // let prepareLiveGlobe() resolve the tab

  await page.evaluate(() => {
    const real = chrome.sidePanel.open.bind(chrome.sidePanel);
    chrome.sidePanel.open = (opts) => {
      void window.__reportOpen({ ...opts });
      return real(opts);
    };
  });

  const globe = page.locator('button[title*="globe" i]');
  check('popup has the globe button', (await globe.count()) > 0);
  if ((await globe.count()) > 0) {
    await globe.first().click().catch(() => {});
    await sleep(1500);
    check('globe click opens the side panel', opened.length === 1, JSON.stringify(opened));
    check('globe click targets a tab', typeof opened[0]?.tabId === 'number', JSON.stringify(opened[0]));
    check('popup closes only after the open call', closed && opened.length === 1, `closed=${closed}`);
  }
  if (!closed) await page.close();
  await site.close();
}

// --- 5e. global pause suspends everything, then restores it ---------------
{
  await send({ type: 'BLOCK_DOMAIN', domain: 'example.com' });
  await sleep(400);

  const page = await ctx.newPage();
  await page.goto('https://example.com/', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
  await sleep(800);
  check('precondition: the domain is blocked', page.url().startsWith('chrome-extension://'), page.url());

  const paused = (await send({ type: 'PAUSE_ALL', minutes: 5 })).state;
  check('pause reports a deadline about 5 minutes out',
    paused.paused === true && paused.until !== null && Math.abs(paused.until - Date.now() - 300_000) < 10_000,
    JSON.stringify(paused));

  const ruleIds = await swEval(async () =>
    (await chrome.declarativeNetRequest.getSessionRules())
      .filter((r) => r.id >= 950_000)
      .map((r) => `${r.id}:${r.action.type}:${r.condition.urlFilter}`));
  check('pause installs one allow-everything rule', ruleIds.length === 1 && ruleIds[0].endsWith(':allow:*'), JSON.stringify(ruleIds));

  await page.goto('https://example.com/paused', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await sleep(400);
  check('paused: a blocked domain loads', page.url() === 'https://example.com/paused', page.url());

  // The lookalike interstitial is a tabs.update, not a DNR rule, so it has to
  // stand down separately or "pause" would only half work. It fires before DNS,
  // so a typosquat that does not resolve still proves the point — as long as
  // the control below shows the interception is live once protection is back.
  await page.goto('https://amazom.com/', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
  await sleep(1200);
  const pausedLookalikeUrl = page.url();
  check('paused: the lookalike interstitial stands down', !pausedLookalikeUrl.startsWith('chrome-extension://'), pausedLookalikeUrl);

  // A feed refresh rewrites the session rules; it must not sweep the pause away.
  const settings = await swEval(async () => {
    const st = await chrome.storage.local.get(null);
    const k = Object.keys(st).find((x) => st[x] && typeof st[x] === 'object' && st[x].blockCategories);
    return st[k];
  });
  await send({ type: 'UPDATE_SETTINGS', settings });
  await sleep(1200);
  const survived = await swEval(async () =>
    (await chrome.declarativeNetRequest.getSessionRules()).some((r) => r.id >= 950_000));
  check('pause survives a feed resync', survived);

  check('an unsupported duration is refused',
    (await send({ type: 'PAUSE_ALL', minutes: 999 })).state.until === paused.until);

  await send({ type: 'RESUME_ALL' });
  await sleep(600);
  const after = (await send({ type: 'GET_PAUSE_STATE' })).state;
  check('resume clears the pause state', after.paused === false && after.until === null, JSON.stringify(after));
  const gone = await swEval(async () =>
    (await chrome.declarativeNetRequest.getSessionRules()).every((r) => r.id < 950_000));
  check('resume removes the pause rule', gone);

  await page.goto('https://example.com/after', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
  await sleep(800);
  check('resumed: the domain is blocked again', page.url().startsWith('chrome-extension://'), page.url());

  // Control for the check above: with protection back, the same navigation is
  // intercepted. Without this, "not on the warning page" could just mean the
  // navigation never went anywhere.
  await page.goto('https://amazom.com/', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
  await sleep(1200);
  check('resumed: the lookalike interstitial fires again',
    page.url().includes('reason=lookalike'), page.url());

  await send({ type: 'UNBLOCK_DOMAIN', domain: 'example.com' });
  await page.close();
}

// --- 5f. the pause bar drives it from the popup ---------------------------
{
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/src/popup/index.html`);
  await sleep(2500);

  const pauseBtn = page.getByRole('button', { name: /^Pause all$/i });
  check('popup shows the pause control', (await pauseBtn.count()) > 0);
  if ((await pauseBtn.count()) > 0) {
    await pauseBtn.first().click();
    await sleep(400);
    const fiveMin = page.getByRole('button', { name: /5 minutes/i });
    check('pause offers a choice of durations', (await fiveMin.count()) > 0);
    await fiveMin.first().click();
    await sleep(1200);
    const state = (await send({ type: 'GET_PAUSE_STATE' })).state;
    check('choosing 5 minutes pauses protection', state.paused === true, JSON.stringify(state));
    const resumeBtn = page.getByRole('button', { name: /^Resume$/i });
    check('the bar switches to a resume control', (await resumeBtn.count()) > 0);
    check('the header stops claiming protection is live',
      (await page.getByText(/protection paused/i).count()) > 0 &&
        (await page.getByText(/protection live/i).count()) === 0);
    if ((await resumeBtn.count()) > 0) {
      await resumeBtn.first().click();
      await sleep(1200);
      check('resuming from the popup restores protection',
        (await send({ type: 'GET_PAUSE_STATE' })).state.paused === false);
    }
  }
  await page.close();
}

// --- 5g. settings reach what only the welcome page used to offer ----------
// The language round-trip runs last on purpose: every label below is
// localised, so asserting on English wording has to happen before it.
{
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/src/popup/index.html`);
  await sleep(2500);
  await page.getByRole('button', { name: /settings/i }).first().click().catch(() => {});
  const welcomeLink = page.getByRole('button', { name: /getting started/i });
  await welcomeLink.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  check('settings link back to the welcome page', (await welcomeLink.count()) > 0);

  // Allowlist by hand: the review's dead end was having no way to add one.
  const input = page.locator('input[placeholder="example.com"]');
  check('settings offer an allowlist input', (await input.count()) > 0);
  if ((await input.count()) > 0) {
    // A pasted URL should reduce to its hostname.
    await input.first().fill('https://Manually-Added.example/some/path?q=1');
    await page.getByRole('button', { name: /^Allow$/i }).first().click();
    await sleep(1200);
    const wl = await swEval(async () => {
      const st = await chrome.storage.local.get(null);
      const v = Object.values(st).find((x) => x && typeof x === 'object' && Array.isArray(x.customWhiteList));
      return v?.customWhiteList ?? [];
    });
    check('a hand-typed domain reaches the allowlist', wl.includes('manually-added.example'), JSON.stringify(wl));

    await input.first().fill('not a domain');
    await page.getByRole('button', { name: /^Allow$/i }).first().click();
    await sleep(600);
    check('nonsense input is refused with a message',
      (await page.getByText(/Enter a domain like/i).count()) > 0);
    await send({ type: 'DISALLOW_DOMAIN', domain: 'manually-added.example' });
  }

  // Language: the picker lived only on the welcome page, which opens once on
  // install. Identify it by its option values — its aria-label is localised
  // too, so it stops matching the moment the language changes.
  const langSelect = page.locator('select:has(option[value="ja"])');
  const pick = async (value) => {
    await langSelect.first().selectOption(value, { timeout: 8000 }).catch(async () => {
      // selectOption's actionability wait gets flaky against this popup once
      // the run has several pages open; the change event is what the control
      // actually reacts to.
      await page.evaluate((v) => {
        const el = document.querySelector('select option[value="ja"]')?.parentElement;
        if (!el) return;
        el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    });
    await sleep(1500);
  };

  check('settings offer a language picker', (await langSelect.count()) > 0);
  if ((await langSelect.count()) > 0) {
    await pick('ja');
    const stored = await swEval(async () => {
      const st = await chrome.storage.local.get(null);
      return Object.entries(st).find(([k]) => k.toLowerCase().includes('locale'))?.[1] ?? null;
    });
    check('choosing a language persists it', stored === 'ja', String(stored));
    check('the popup redraws in the chosen language', (await page.getByText('言語').count()) > 0);

    await pick('en');
    check('switching back restores English',
      (await page.getByText(/^Language$/).count()) > 0 && (await page.getByText('言語').count()) === 0);
  }
  await page.close();
}

// --- 5h. the re-review findings, each with its own probe ------------------
{
  // A1: every listed domain has rules behind it. The tail used to be reported
  // as dangerous with nothing blocking it.
  const budget = await swEval(async () => {
    const session = await chrome.declarativeNetRequest.getSessionRules();
    const feed = session.filter((r) => r.id < 900_000);
    const domains = new Set(feed.map((r) => r.condition.urlFilter));
    return { rules: feed.length, domains: domains.size };
  });
  const listed = await swEval(async () => {
    const res = await fetch(chrome.runtime.getURL('src/data/malware.json')).catch(() => null);
    return res ? (await res.json()).length : null;
  });
  check('every listed malware domain has rules behind it',
    listed === null || budget.domains === listed, `${budget.domains} covered / ${listed} listed`);

  // A2: the country unblock is gated on our own rules, not the page's params.
  const spoof = (await send({ type: 'GET_BLOCK_CONTEXT', domain: 'not-blocked-by-us.example' })).context;
  check('a domain we do not block reports no blocking country', spoof.country === null, JSON.stringify(spoof));
  const cpage = await ctx.newPage();
  await cpage.goto(
    `chrome-extension://${extId}/src/warning/index.html?blocked=not-blocked-by-us.example&reason=country&country=JP`,
  );
  await sleep(1500);
  check('a deep-linked country warning offers no unblock',
    (await cpage.getByRole('button', { name: /unblock/i }).count()) === 0);
  await cpage.close();

  // A4: a site the user allowed is recorded, so the first-password notice and
  // the softer variant can still reach it. Start from a clean history so the
  // assertions are about this navigation and not an earlier section's.
  await swEval(async () => chrome.storage.local.remove('zg.seenExactHosts'));
  await send({ type: 'BLOCK_DOMAIN', domain: 'example.com' });
  const probe = await ctx.newPage();
  await probe.goto('https://example.com/', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
  // visits.ts batches its writes on a 2s timer, so read after that lands.
  await sleep(3000);
  const afterBlocked = await swEval(async () =>
    Object.keys((await chrome.storage.local.get('zg.seenExactHosts'))['zg.seenExactHosts'] ?? {}));
  check('a blocked navigation is not recorded as a visit',
    !afterBlocked.includes('example.com'), JSON.stringify(afterBlocked));

  await send({ type: 'ALLOW_DOMAIN', domain: 'example.com' });
  await sleep(400);
  await probe.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await sleep(3000);
  const afterAllowed = await swEval(async () =>
    Object.keys((await chrome.storage.local.get('zg.seenExactHosts'))['zg.seenExactHosts'] ?? {}));
  check('an allowed site is recorded as a visit',
    afterAllowed.includes('example.com'), JSON.stringify(afterAllowed));
  check('the extension\'s own pages are never recorded as visits',
    !afterAllowed.some((h) => h === extId), JSON.stringify(afterAllowed));

  // A5: allowing lifts the manual block rather than listing it twice.
  const lists = await swEval(async () => {
    const st = await chrome.storage.local.get(null);
    const v = Object.values(st).find((x) => x && typeof x === 'object' && Array.isArray(x.customWhiteList));
    return { wl: v?.customWhiteList ?? [], bl: v?.customBlockList ?? [] };
  });
  check('allowing removes the manual block', lists.wl.includes('example.com') && !lists.bl.includes('example.com'), JSON.stringify(lists));
  await send({ type: 'DISALLOW_DOMAIN', domain: 'example.com' });
  await probe.close();

  // A6: the paused indicator survives on tabs that were already open.
  const open1 = await ctx.newPage();
  await open1.goto('https://example.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(500);
  await send({ type: 'PAUSE_ALL', minutes: 5 });
  await sleep(800);
  const badge = await swEval(async () => {
    const tabs = await chrome.tabs.query({});
    const texts = [];
    for (const tb of tabs) {
      if (tb.id !== undefined) texts.push(await chrome.action.getBadgeText({ tabId: tb.id }));
    }
    return texts;
  });
  check('the paused badge shows on already-open tabs',
    badge.length > 0 && badge.every((x) => x === '||'), JSON.stringify(badge));

  // ...and survives the navigations that used to wipe it.
  await open1.goto('https://example.com/elsewhere', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(1200);
  const afterNav = await swEval(async () => {
    const [tb] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tb?.id === undefined ? null : chrome.action.getBadgeText({ tabId: tb.id });
  });
  check('the paused badge survives a navigation', afterNav === '||', String(afterNav));
  await send({ type: 'RESUME_ALL' });
  await sleep(600);
  await open1.close();

  // A7: the packaged ruleset is armed again at startup and retired after sync.
  const armed = await swEval(async () => {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ['block_rules'] });
    const before = await chrome.declarativeNetRequest.getEnabledRulesets();
    await chrome.storage.session.remove('zg.sessionRules.applied');
    return before;
  });
  check('the packaged ruleset can be re-armed', armed.includes('block_rules'), JSON.stringify(armed));
  const settingsForSync = await swEval(async () => {
    const st = await chrome.storage.local.get(null);
    const k = Object.keys(st).find((x) => st[x] && typeof st[x] === 'object' && st[x].blockCategories);
    return st[k];
  });
  await send({ type: 'UPDATE_SETTINGS', settings: settingsForSync });
  await sleep(1500);
  const retired = await swEval(async () => chrome.declarativeNetRequest.getEnabledRulesets());
  check('a sync retires it again', !retired.includes('block_rules'), JSON.stringify(retired));
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
