#!/usr/bin/env node
/**
 * Packs the Expo web export into ONE self-contained HTML file (no external
 * requests): all JS bundles are inlined and every asset referenced by the
 * bundle (icon font, images) is embedded as a data: URI. Used to publish the
 * app as a single page that can be opened in Safari on iPad.
 *
 * Usage: node scripts/build-web-page.mjs <export-dir> <out.html>
 *   (create the export with: npx expo export --platform web --output-dir <export-dir>)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error('usage: build-web-page.mjs <export-dir> <out.html>');
  process.exit(1);
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const index = readFileSync(join(dir, 'index.html'), 'utf8');
const scripts = [...index.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
if (scripts.length === 0) throw new Error('no scripts found in index.html');

let embedded = 0;
const inline = scripts.map((src) => {
  let js = readFileSync(join(dir, src.replace(/^\//, '')), 'utf8');
  js = js.replace(/"(\/assets\/[^"]+\.(png|jpg|ttf|otf|woff2?))"/g, (whole, path) => {
    const file = join(dir, path.replace(/^\//, ''));
    if (!existsSync(file)) return whole;
    embedded++;
    return `"data:${MIME[extname(path)]};base64,${readFileSync(file).toString('base64')}"`;
  });
  if (/\/_expo\/static\/js\//.test(js)) throw new Error(`${src} still loads code by URL (disable async routes)`);
  // A literal "</script" inside JS would end the inline <script> element.
  return js.replace(/<\/script/gi, '<\\/script');
});

const html = `<title>LexiCore</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="LexiCore">
<style>
  :root { --bg: #F3F5F9; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0F131B; color-scheme: dark; } }
  :root[data-theme="dark"] { --bg: #0F131B; color-scheme: dark; }
  html, body { height: 100%; }
  body { overflow: hidden; background: var(--bg); }
  #root { display: flex; height: 100%; flex: 1; }
</style>
<noscript>JavaScript を有効にしてください。</noscript>
<div id="root"></div>
${inline.map((js) => `<script>${js}</script>`).join('\n')}
`;
writeFileSync(out, html);
console.log(`wrote ${out}: ${(html.length / 1024 / 1024).toFixed(2)} MB, ${scripts.length} scripts, ${embedded} embedded assets`);
