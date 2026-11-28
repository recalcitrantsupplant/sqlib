// Builds the map page into one directory: index.html, map.js, map.css.
//
// Usage: node build.mjs [outdir]     default: dist/
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, 'dist'));
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(here, 'src/main.ts')],
  outfile: path.join(out, 'map.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: process.env.OGC_MAP_MINIFY !== 'false',
  legalComments: 'linked',
  // ogc-client imports these only for WMTS and OpenLayers helpers, which the
  // page does not use. The bundle tree-shakes them away.
  external: ['ol', 'ol/*', 'proj4'],
  logLevel: 'warning',
});

// MapLibre's own Worker, which parses tiles and GeoJSON off the main thread.
// The page names it with setWorkerUrl.
const require = createRequire(import.meta.url);
await build({
  entryPoints: [require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs')],
  outfile: path.join(out, 'map-worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: process.env.OGC_MAP_MINIFY !== 'false',
  legalComments: 'none',
  logLevel: 'warning',
});

(import.meta.url);
const maplibreCss = readFileSync(require.resolve('maplibre-gl/dist/maplibre-gl.css'), 'utf8');
writeFileSync(path.join(out, 'map.css'), `${maplibreCss}\n${readFileSync(path.join(here, 'src/style.css'), 'utf8')}`);
copyFileSync(path.join(here, 'src/index.html'), path.join(out, 'index.html'));
console.log(`ogc-map: wrote ${out}`);
