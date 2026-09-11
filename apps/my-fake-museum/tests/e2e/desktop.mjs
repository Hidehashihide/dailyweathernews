/**
 * Launch the real Electron app and drive it.
 *
 * The desktop build is the one path that unit tests cannot reach at all: the
 * preload bridge, the save file on disk, the CSP header and the navigation
 * guards only exist in a running Electron process. This checks that a save
 * written through the bridge is still there after a full app restart, which is
 * the behaviour a desktop player actually depends on.
 *
 *   xvfb-run -a node tests/e2e/desktop.mjs   (expects `npm run build` first)
 */

import { _electron as electron } from 'playwright';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const failures = [];
const check = (name, condition, detail = '') => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : ` -- ${detail}`}`);
  if (!condition) failures.push(name);
};

// Isolated profile so the run cannot touch a real player's saves.
const userData = await mkdtemp(join(tmpdir(), 'mfm-desktop-'));
const launchArgs = ['.', `--user-data-dir=${userData}`, '--no-sandbox'];

async function launch() {
  const app = await electron.launch({ args: launchArgs, cwd: ROOT });
  const page = await app.firstWindow();
  await page.waitForSelector('.topbar', { timeout: 15_000 });
  return { app, page };
}

console.log('\n== first launch ==');
let { app, page } = await launch();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

check('window opens and renders', await page.isVisible('.topbar'));
check('title is set', (await page.title()) === 'MY FAKE MUSEUM');

console.log('\n== preload bridge ==');
const bridge = await page.evaluate(() => ({
  present: typeof window.mfmBridge === 'object' && window.mfmBridge !== null,
  methods: window.mfmBridge ? Object.keys(window.mfmBridge).sort() : [],
  nodeLeaked: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
}));
check('bridge is exposed', bridge.present);
check('bridge exposes exactly the save API', bridge.methods.join(',') === 'readSave,removeSave,writeSave', bridge.methods.join(','));
check('no Node globals leak into the renderer', bridge.nodeLeaked === false);

const backend = await page.textContent('.tab:has-text("記録")').then(async () => {
  await page.click('.tab:has-text("記録")');
  await page.waitForSelector('.totals');
  return page.textContent('.totals');
});
check('app reports the electron storage backend', backend?.includes('electron') === true, String(backend));

console.log('\n== path traversal is refused ==');
const traversal = await page.evaluate(async () => {
  try {
    await window.mfmBridge.writeSave('../../escaped', 'x');
    return 'accepted';
  } catch (error) {
    return String(error);
  }
});
check('a ../ save key is rejected', traversal !== 'accepted', String(traversal));

console.log('\n== play a day ==');
await page.click('.tab:has-text("博物館")');
await page.click('button:has-text("採集する")');
await page.waitForSelector('.toast');
await page.click('.tab:has-text("倉庫")');
await page.waitForSelector('.card');
await page.click('button:has-text("説明を書いて展示")');
await page.waitForSelector('.caption-input');
const CAPTION = '1650年、砂丘の遺跡より出土。副葬品の一部と推定される。';
await page.fill('.caption-input', CAPTION);
await page.click('button:has-text("展示する")');
await page.waitForSelector('.panel .card .caption');
await page.click('button:has-text("開館する")');
await page.waitForSelector('.report');
await page.click('button:has-text("夜を終える")');
await page.waitForFunction(() => document.querySelector('.day')?.textContent?.includes('2日目'));
check('a full day can be played', (await page.textContent('.day'))?.includes('2日目') === true);

// Give the async save a moment to land before killing the process.
await page.waitForTimeout(400);
const saved = await readdir(join(userData, 'saves')).catch(() => []);
check('a save file was written to disk', saved.includes('mfm.save.v1.json'), saved.join(','));
check('no leftover temp file from the atomic write', !saved.some((f) => f.endsWith('.tmp')), saved.join(','));

console.log('\n== restart ==');
await app.close();
({ app, page } = await launch());
check('save survives an app restart', (await page.textContent('.day'))?.includes('2日目') === true);
await page.click('.tab:has-text("博物館")');
check('the exhibit is still on display', (await page.textContent('.caption')) === CAPTION);

await page.screenshot({ path: 'tests/e2e/screenshot-desktop-app.png', fullPage: true });

console.log('\n== console ==');
check('no console errors', errors.length === 0, errors.join(' | '));

await app.close();
await rm(userData, { recursive: true, force: true });

console.log(`\n${failures.length === 0 ? 'DESKTOP PASSED' : `DESKTOP FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
