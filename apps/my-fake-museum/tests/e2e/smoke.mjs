/**
 * End-to-end smoke run against the real built bundle in a real browser.
 *
 * Covers what unit tests cannot: that the page boots, that a full day can be
 * played by clicking, that captions are escaped rather than injected, that the
 * save survives a reload, and that nothing overflows a 360px viewport.
 *
 * Usage: node tests/e2e/smoke.mjs   (expects `npm run build` to have run)
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../dist', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
    failures.push(name);
  }
};

function serve() {
  const server = createServer(async (req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const rel = normalize(url === '/' ? '/index.html' : url).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(ROOT, rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const { server, port } = await serve();
const base = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({
  viewport: { width: 360, height: 740 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  locale: 'ja-JP',
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

console.log('\n== boot ==');
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.topbar', { timeout: 5000 });
check('page boots and renders the top bar', await page.isVisible('.topbar'));
check('starts on day 1', (await page.textContent('.day'))?.includes('1日目') === true);

console.log('\n== responsive layout at 360px ==');
const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
check('no horizontal overflow', scrollWidth <= 360, `scrollWidth=${scrollWidth}`);

const smallTargets = await page.evaluate(() =>
  [...document.querySelectorAll('button')]
    .map((b) => ({ text: b.textContent?.slice(0, 16), h: Math.round(b.getBoundingClientRect().height) }))
    .filter((b) => b.h > 0 && b.h < 44),
);
check('every tap target is at least 44px tall', smallTargets.length === 0, JSON.stringify(smallTargets));

console.log('\n== play a day ==');
await page.click('button:has-text("採集する")');
await page.waitForSelector('.toast');
await page.click('.tab:has-text("倉庫")');
await page.waitForSelector('.card');
check('foraged item appears in the store', (await page.locator('.card').count()) >= 1);

await page.click('button:has-text("説明を書いて展示")');
await page.waitForSelector('.caption-input');
const CAPTION = '1847年、旧市街の遺構より出土。用途は不明であり、鑑定が継続中である。';
await page.fill('.caption-input', CAPTION);
check('grapheme counter updates', (await page.textContent('.counter'))?.includes('/') === true);
await page.click('button:has-text("展示する")');
await page.waitForSelector('.panel .card .caption');
check('exhibit shows the written caption', (await page.textContent('.caption')) === CAPTION);

console.log('\n== caption text is escaped, not injected ==');
await page.click('button:has-text("由来を書き換える")');
await page.waitForSelector('.caption-input');
const XSS = '<img src=x onerror="window.__pwned=1"> 古代の石板である。';
await page.fill('.caption-input', XSS);
await page.click('button:has-text("書き換える")');
await page.waitForTimeout(200);
check('no element was injected', (await page.locator('.caption img').count()) === 0);
check('no script executed', (await page.evaluate(() => window.__pwned)) === undefined);
check(
  'markup is rendered as literal text',
  (await page.textContent('.caption'))?.includes('<img src=x') === true,
);

console.log('\n== open, night, advance ==');
await page.click('.tab:has-text("博物館")');
await page.click('button:has-text("開館する")');
await page.waitForSelector('.report');
check('day report appears', await page.isVisible('.report'));
await page.click('.tab:has-text("街")');
await page.waitForSelector('.standings');
check('standings list every museum', (await page.locator('.standing').count()) === 5);
await page.click('.tab:has-text("博物館")');
await page.click('button:has-text("夜を終える")');
await page.waitForFunction(() => document.querySelector('.day')?.textContent?.includes('2日目'));
check('advanced to day 2', (await page.textContent('.day'))?.includes('2日目') === true);

console.log('\n== save survives a reload ==');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.topbar');
check('still on day 2 after reload', (await page.textContent('.day'))?.includes('2日目') === true);
await page.click('.tab:has-text("博物館")');
check('exhibit survived the reload', (await page.locator('.caption').count()) >= 1);

console.log('\n== light theme ==');
await page.emulateMedia({ colorScheme: 'light' });
await page.waitForTimeout(100);
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('body paints an explicit background in light mode', bg !== 'rgba(0, 0, 0, 0)', bg);

console.log('\n== desktop width ==');
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(100);
const wideOverflow = await page.evaluate(() => document.documentElement.scrollWidth);
check('no horizontal overflow at 1280px', wideOverflow <= 1280, `scrollWidth=${wideOverflow}`);

await page.screenshot({ path: 'tests/e2e/screenshot-desktop.png', fullPage: true });
await page.setViewportSize({ width: 360, height: 740 });
await page.screenshot({ path: 'tests/e2e/screenshot-mobile.png', fullPage: true });

console.log('\n== console ==');
check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
server.close();

console.log(`\n${failures.length === 0 ? 'E2E PASSED' : `E2E FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
