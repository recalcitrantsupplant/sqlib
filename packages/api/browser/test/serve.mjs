// A static file server for the browser build: `node serve.mjs <dir> [port]`.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.map': 'application/json', '.sqlite': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

export function serve(dir, port = 0, { spaFallback = null } = {}) {
  const root = path.resolve(dir);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    } catch {
      if (spaFallback) file = path.join(root, spaFallback); else { res.writeHead(404).end(); return; }
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await serve(process.argv[2] ?? '.', Number(process.argv[3] ?? 8787), { spaFallback: process.argv[4] ?? null });
  console.log(`http://127.0.0.1:${server.address().port}/`);
}
