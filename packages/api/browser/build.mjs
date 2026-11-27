// Builds the sqlib API for a browser Worker.
//
//   node browser/build.mjs [outdir]
//
// The bundle is the unchanged API (src/index.ts) with Node built-ins replaced:
// in-memory http and fs, sqlite-wasm for node:sqlite, fetch for undici, and
// unenv for the rest. See browser/README.md.
import * as esbuild from 'esbuild';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '..');
const repo = path.resolve(apiDir, '../..');
const outdir = path.resolve(process.argv[2] ?? path.join(apiDir, 'dist-browser'));
const require = createRequire(path.join(apiDir, 'package.json'));
const shim = name => path.join(here, 'shims', name);
const unenv = name => require.resolve(`unenv/node/${name}`);

const readableStream = path.dirname(require.resolve('readable-stream/package.json'));

/** Node built-in → module. */
const builtins = {
  http: shim('http.mjs'),
  https: shim('http.mjs'),
  crypto: shim('crypto.mjs'),
  fs: shim('fs.mjs'),
  'fs/promises': shim('fs-promises.mjs'),
  sqlite: shim('sqlite.mjs'),
  worker_threads: shim('worker_threads.mjs'),
  stream: path.join(readableStream, 'lib/ours/browser.js'),
  'stream/promises': path.join(readableStream, 'lib/stream/promises.js'),
  'stream/web': shim('empty.mjs'),
  events: require.resolve('events/'),
  buffer: unenv('buffer'),
  util: unenv('util'),
  'util/types': unenv('util/types'),
  assert: unenv('assert'),
  'assert/strict': unenv('assert/strict'),
  path: unenv('path'),
  'path/posix': unenv('path'),
  url: unenv('url'),
  querystring: unenv('querystring'),
  string_decoder: unenv('string_decoder'),
  timers: unenv('timers'),
  'timers/promises': unenv('timers/promises'),
  async_hooks: unenv('async_hooks'),
  diagnostics_channel: unenv('diagnostics_channel'),
  perf_hooks: unenv('perf_hooks'),
  os: unenv('os'),
  zlib: unenv('zlib'),
  net: unenv('net'),
  tls: unenv('tls'),
  http2: unenv('http2'),
  dns: unenv('dns'),
  'dns/promises': unenv('dns/promises'),
  child_process: unenv('child_process'),
  module: unenv('module'),
  v8: unenv('v8'),
  vm: unenv('vm'),
  tty: unenv('tty'),
  console: unenv('console'),
  process: unenv('process'),
  cluster: unenv('cluster'),
  dgram: unenv('dgram'),
  readline: unenv('readline'),
  inspector: unenv('inspector'),
  punycode: unenv('punycode'),
};

/** Packages replaced outright. */
const packages = {
  undici: shim('undici.mjs'),
  '@duckdb/node-api': shim('duckdb-loader.mjs'),
  '@opentelemetry/sdk-node': shim('throws.mjs'),
  '@opentelemetry/instrumentation-http': shim('throws.mjs'),
  '@opentelemetry/instrumentation-undici': shim('throws.mjs'),
  '@opentelemetry/sdk-logs': shim('throws.mjs'),
  '@opentelemetry/sdk-trace': shim('throws.mjs'),
  '@fastify/otel': shim('throws.mjs'),
  'pino-pretty': shim('throws.mjs'),
  dotenv: shim('empty.mjs'),
  pino: shim('pino.cjs'),
};

const nodeShims = {
  name: 'sqlib-node-shims',
  setup(build) {
    build.onResolve({ filter: /^(node:)?[a-z_\/0-9]+$/ }, args => {
      const name = args.path.replace(/^node:/, '');
      if (builtins[name]) {
        // A CommonJS `require` gets the module's default export, with the named
        // exports on it, as Node gives `require('node:assert')` a function.
        if (args.kind === 'require-call') return { path: `${builtins[name]}.cjs`, namespace: 'sqlib-cjs' };
        return { path: builtins[name] };
      }
      if (args.path.startsWith('node:')) return { errors: [{ text: `No browser shim for ${args.path}` }] };
      return undefined;
    });
    build.onResolve({ filter: /.*/ }, args => (packages[args.path] ? { path: packages[args.path] } : undefined));
    // sqlib's own modules derive file paths from import.meta.url. Give each
    // one a file: URL like the server's, and leave dependencies such as
    // Oxigraph and sqlite-wasm their real URL, which they load WASM from.
    build.onLoad({ filter: /[\\/]packages[\\/][^\\/]+[\\/](src|dist)[\\/].*\.(ts|js|mjs)$/ }, async args => {
      if (args.path.includes('node_modules')) return undefined;
      const text = await readFile(args.path, 'utf8');
      if (!text.includes('import.meta.url')) return undefined;
      const url = 'file:///app/' + path.relative(repo, args.path).split(path.sep).join('/');
      return { contents: text.replaceAll('import.meta.url', JSON.stringify(url)), loader: args.path.endsWith('.ts') ? 'ts' : 'js' };
    });
    build.onLoad({ filter: /.*/, namespace: 'sqlib-cjs' }, args => ({
      contents: `const m = require(${JSON.stringify(args.path.slice(0, -4))});\n`
        + `const d = m.default;\n`
        + `if (d && (typeof d === 'function' || typeof d === 'object')) {\n`
        + `  for (const k of Object.keys(m)) { if (k === 'default' || k in d) continue; try { d[k] = m[k]; } catch {} }\n`
        + `  module.exports = d;\n`
        + `} else module.exports = m;\n`,
      loader: 'js',
      resolveDir: path.dirname(args.path),
    }));
    build.onResolve({ filter: /^sqlib-browser-config$/ }, () => ({ path: 'config', namespace: 'sqlib-browser' }));
    build.onLoad({ filter: /.*/, namespace: 'sqlib-browser' }, () => ({
      contents: `export const env = ${JSON.stringify(demoEnv())};\nexport const files = ${JSON.stringify(files)};\n`,
      loader: 'js',
    }));
  },
};

/** The demo settings, as `demo/server.env` gives them, with paths moved into the in-memory fs. */
function demoEnv() {
  const env = {};
  for (const line of readFileSync(path.join(repo, 'demo/server.env'), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  Object.assign(env, {
    NODE_ENV: 'production',
    LIBRARY_STORAGE_DIR: '/opt/sqlib-demo/store',
    OXIGRAPH_STORAGE_DIR: '/opt/sqlib-demo/oxigraph',
    SQLIB_AUTH_STORE_DIR: '/opt/sqlib-demo/auth',
    SQLIB_DEMO_PEOPLE: '/opt/sqlib-demo/people.json',
    SQLIB_AUTH_SEED_GRANTS: '/opt/sqlib-demo/grants.ttl',
    SQLIB_QUERY_WORKERS: '0',
    SQLIB_LOG_LEVEL: 'warn',
    LOG_LEVEL: 'warn',
    OTEL_ENABLED: 'false',
  });
  return env;
}

const files = {
  '/opt/sqlib-demo/people.json': readFileSync(path.join(repo, 'demo/people.json'), 'utf8'),
  '/opt/sqlib-demo/grants.ttl': readFileSync(path.join(repo, 'demo/grants.ttl'), 'utf8'),
};
/** Files the API reads from its own package at run time, at the paths the server has. */
for (const rel of ['packages/api/package.json', 'packages/api/system-store/assets']) {
  for (const file of listFiles(path.join(repo, rel))) {
    files['/app/' + path.relative(repo, file).split(path.sep).join('/')] = readFileSync(file, 'utf8');
  }
}

function listFiles(p) {
  if (!statSync(p).isDirectory()) return [p];
  return readdirSync(p).flatMap(name => listFiles(path.join(p, name)));
}

const result = await esbuild.build({
  entryPoints: { 'sqlib-api-worker': path.join(here, 'worker.ts'), 'sqlib-duckdb': shim('duckdb.mjs') },
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser', 'import', 'default'],
  define: {
  },
  plugins: [nodeShims],
  loader: { '.wasm': 'file' },
  minify: process.env.SQLIB_BROWSER_MINIFY !== 'false',
  sourcemap: true,
  metafile: true,
  logLevel: 'warning',
  legalComments: 'none',
});

const outputs = Object.entries(result.metafile.outputs).filter(([f]) => !f.endsWith('.map'));
for (const [file, info] of outputs) console.log(`${path.relative(process.cwd(), file)}  ${(info.bytes / 1024).toFixed(0)} KiB`);

// The WebAssembly the Worker loads, beside it.
const { copyFile, mkdir } = await import('node:fs/promises');
await mkdir(outdir, { recursive: true });
const oxigraphDir = path.dirname(require.resolve('oxigraph/package.json'));
await copyFile(path.join(oxigraphDir, 'web_bg.wasm'), path.join(outdir, 'oxigraph.wasm'));
const sqliteDir = path.dirname(require.resolve('@sqlite.org/sqlite-wasm/package.json'));
await copyFile(path.join(sqliteDir, 'dist/sqlite3.wasm'), path.join(outdir, 'sqlite3.wasm'));
