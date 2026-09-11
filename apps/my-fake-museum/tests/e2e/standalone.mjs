/**
 * Verify the single-file build actually works when opened from disk.
 *
 * This is the path a player takes when they double-click the .html, so it has
 * to be checked the same way: a real browser, a real file:// URL, no server.
 * The interesting question is whether localStorage survives a reload, because
 * a file:// document has a null origin and browsers treat its storage
 * differently from an http one.
 *
 *   node tests/e2e/standalone.mjs   (expects build-standalone to have run)
 */

import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../../dist-standalone/MY-FAKE-MUSEUM.html', import.meta.url));
const url = pathToFileURL(FILE).href;

const failures = [];
const check = (name, condition, detail = '') => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : ` -- ${detail}`}`);
  if (!condition) failures.push(name);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const context = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1100, height: 860 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

console.log(`\n== opening ${url} ==`);
await page.goto(url);
await page.waitForSelector('.topbar', { timeout: 5000 });
check('boots from a file:// URL with no server', await page.isVisible('.topbar'));
check('starts on day 1', (await page.textContent('.day'))?.includes('1日目') === true);

console.log('\n== storage backend ==');
const backendWorks = await page.evaluate(() => {
  try {
    window.localStorage.setItem('__probe', '1');
    const ok = window.localStorage.getItem('__probe') === '1';
    window.localStorage.removeItem('__probe');
    return ok;
  } catch (error) {
    return String(error);
  }
});
check('localStorage is usable over file://', backendWorks === true, String(backendWorks));

console.log('\n== play a day ==');
await page.click('button:has-text("採集する")');
await page.waitForSelector('.toast');
await page.click('.tab:has-text("倉庫")');
await page.waitForSelector('.card');
await page.click('button:has-text("説明を書いて展示")');
await page.waitForSelector('.caption-input');
const CAPTION = '1902年、河口の旧家より寄贈。来歴は不明であり、考証が継続している。';
await page.fill('.caption-input', CAPTION);
await page.click('button:has-text("展示する")');
await page.waitForSelector('.panel .card .caption');
check('caption is stored and displayed', (await page.textContent('.caption')) === CAPTION);

await page.click('button:has-text("開館する")');
await page.waitForSelector('.report');
await page.click('button:has-text("夜を終える")');
await page.waitForFunction(() => document.querySelector('.day')?.textContent?.includes('2日目'));
check('a full day can be played', (await page.textContent('.day'))?.includes('2日目') === true);

console.log('\n== save survives a reload ==');
await page.reload();
await page.waitForSelector('.topbar');
const dayAfterReload = await page.textContent('.day');
check('still on day 2 after reload', dayAfterReload?.includes('2日目') === true, String(dayAfterReload));
check('the exhibit is still there', (await page.locator('.caption').count()) >= 1);

console.log('\n== console ==');
check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await page.screenshot({ path: 'tests/e2e/screenshot-standalone.png', fullPage: true });

await browser.close();
console.log(`\n${failures.length === 0 ? 'STANDALONE PASSED' : `STANDALONE FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
