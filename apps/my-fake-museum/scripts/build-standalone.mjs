/**
 * Build a single self-contained .html file.
 *
 * The normal `vite build` emits an ES module, which browsers refuse to load
 * over `file://` (module scripts are subject to CORS, and a file URL has a
 * null origin). So this build emits an IIFE instead and inlines the script,
 * the stylesheet and the favicon into one document that can simply be
 * double-clicked.
 *
 *   node scripts/build-standalone.mjs
 *   -> dist-standalone/MY-FAKE-MUSEUM.html
 */

import { build } from 'vite';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TMP = join(ROOT, 'dist-standalone', '.tmp');
const OUT_DIR = join(ROOT, 'dist-standalone');
const OUT_FILE = join(OUT_DIR, 'MY-FAKE-MUSEUM.html');

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

await build({
  configFile: false,
  root: ROOT,
  logLevel: 'warn',
  build: {
    outDir: TMP,
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: join(ROOT, 'src', 'main.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'bundle.js',
        assetFileNames: 'bundle[extname]',
        inlineDynamicImports: true,
      },
    },
  },
});

const script = await readFile(join(TMP, 'bundle.js'), 'utf8');
const css = await readFile(join(TMP, 'bundle.css'), 'utf8');
const favicon = await readFile(join(ROOT, 'public', 'favicon.svg'), 'utf8');
const faviconUri = `data:image/svg+xml;base64,${Buffer.from(favicon, 'utf8').toString('base64')}`;

// Guard against the one way an inline <script> can be terminated early.
const safeScript = script.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark light" />
    <meta name="description" content="ガラクタに嘘の説明をつけて展示する博物館経営ゲーム" />
    <link rel="icon" href="${faviconUri}" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="${faviconUri}" />
    <meta name="theme-color" content="#14110e" />
    <title>MY FAKE MUSEUM</title>
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="app"></div>
    <noscript>このゲームを遊ぶには JavaScript を有効にしてください。</noscript>
    <script>
${safeScript}
    </script>
  </body>
</html>
`;

await writeFile(OUT_FILE, html, 'utf8');
await rm(TMP, { recursive: true, force: true });

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`standalone build: dist-standalone/MY-FAKE-MUSEUM.html (${kb} KB)`);
