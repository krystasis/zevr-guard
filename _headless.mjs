import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const DIST='/Users/kazuki/Documents/business/release/zevr-guard/dist';
for (const mode of [true, 'shell']) {
  try {
    const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'zg-hl-')), {
      headless: mode,
      args:[`--disable-extensions-except=${DIST}`,`--load-extension=${DIST}`,'--no-first-run'] });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker',{timeout:20000});
    await new Promise(r=>setTimeout(r,4000));
    const info = await sw.evaluate(async () => ({
      rules: (await chrome.declarativeNetRequest.getSessionRules()).length,
      id: chrome.runtime.id,
    }));
    const p = await ctx.newPage();
    await p.goto('https://example.com/', {waitUntil:'domcontentloaded', timeout:20000}).catch(()=>{});
    console.log('headless='+JSON.stringify(mode), 'OK sw rules=', info.rules, 'nav=', p.url().slice(0,40));
    await ctx.close();
  } catch (e) {
    console.log('headless='+JSON.stringify(mode), 'FAILED:', e.message.split('\n')[0].slice(0,90));
  }
}
