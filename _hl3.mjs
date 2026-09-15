import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const DIST='/Users/kazuki/Documents/business/release/zevr-guard/dist';
try {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'zg-hl3-')), {
    headless: true,
    args:[`--disable-extensions-except=${DIST}`,`--load-extension=${DIST}`,'--no-first-run'] });
  console.log('launched; serviceWorkers at start =', ctx.serviceWorkers().length);
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker',{timeout:20000});
  console.log('sw url =', sw.url().slice(0,60));
  await ctx.close();
} catch (e) {
  console.log('ERROR:', e.constructor.name, '|', String(e.message).split('\n')[0].slice(0,120));
}
