/**
 * Serve the harness.
 *
 * A file:// page cannot POST to the MCP endpoint (its origin is `null`, and the
 * fetch is rejected before CORS is even consulted), so the harness needs an
 * origin. Twenty lines of `node:http` rather than a dependency, because the
 * whole point of this file is to be startable in a checkout that has just been
 * cloned.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.MCP_APP_HARNESS_PORT ?? 3006);

const server = createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  const file = path === '/' || path === '/index.html' ? 'host.html' : path.replace(/^\/+/, '');
  if (file.includes('..')) {
    response.writeHead(400).end('no');
    return;
  }
  try {
    const body = await readFile(`${here}${file}`);
    response.writeHead(200, {
      'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      // The harness is edited while it is running; a cached copy is never what
      // you want here.
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`MCP App harness on http://localhost:${port}/`);
  console.log('Point it at a running sqlib server (just run-local-memory serves /mcp on :3005).');
});
