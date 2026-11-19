#!/usr/bin/env node
/**
 * Builds the web app as ONE self-contained HTML file in local mode (no server):
 * all JavaScript and CSS inlined, hash routing instead of Next.js routing.
 * Output: dist-single/lexicore.html. Used for sharing without hosting.
 */
import { build } from 'esbuild';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-single');
mkdirSync(outDir, { recursive: true });

const css = await postcss([tailwind({ base: root })]).process(readFileSync(join(root, 'src/app/globals.css'), 'utf8'), {
  from: join(root, 'src/app/globals.css'),
});

const result = await build({
  entryPoints: [join(root, 'single/entry.tsx')],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  alias: { 'next/link': join(root, 'single/router.tsx'), 'next/navigation': join(root, 'single/router.tsx'), '@': join(root, 'src') },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NEXT_PUBLIC_SUPABASE_URL': '""',
    'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '""',
  },
  logLevel: 'warning',
  logOverride: { 'unsupported-directive': 'silent' },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f3f5f9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f131b" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="LexiCore">
<title>LexiCore</title>
<style>${css.css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
writeFileSync(join(outDir, 'lexicore.html'), html);
console.log(`wrote dist-single/lexicore.html: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
