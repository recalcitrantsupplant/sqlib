/**
 * Checks that the built server answers small queries at a minimum rate.
 *
 * The check exists because two defects each added synchronous work to every
 * request, and no test saw them: `POST /sparql` built a SPARQL parser for each
 * request (25 ms), and the Oxigraph executor counted every quad of its store
 * when it was constructed. `POST /sparql` then served 37 requests/s to any
 * backend. Without those defects it serves more than 1,000 requests/s on one
 * core.
 *
 * The script starts a mock SPARQL endpoint in this process and the built
 * server (`dist/index.js`) in a child process. It then sends requests over a
 * fixed number of connections for a few seconds per case:
 *
 * - `POST /execute`, a saved query with one argument, on the mock endpoint
 * - `POST /sparql`, query text, on the mock endpoint
 * - `POST /sparql`, a point query, on an in-memory store of 20,000 quads
 *
 * A case fails when a request fails or when the rate is under the floor. The
 * floor is far under the expected rate, because CI machines differ and the
 * load generator shares their cores.
 *
 *   pnpm --filter @sparql-query-lib/api build
 *   pnpm --filter @sparql-query-lib/api smoke:throughput
 *
 * Settings, from the environment:
 *
 * - `THROUGHPUT_FLOOR`: the minimum requests per second for each case (200)
 * - `THROUGHPUT_SECONDS`: how long each case runs (4)
 * - `THROUGHPUT_CONNECTIONS`: requests in flight at once (16)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const FLOOR = Number(process.env.THROUGHPUT_FLOOR ?? 200);
const SECONDS = Number(process.env.THROUGHPUT_SECONDS ?? 4);
const CONNECTIONS = Number(process.env.THROUGHPUT_CONNECTIONS ?? 16);
const MEMORY_SUBJECTS = 5000;

const SERVER_ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));

/** A fixed SELECT result of 10 rows, as a SPARQL endpoint returns it. */
const MOCK_RESULT = Buffer.from(
  JSON.stringify({
    head: { vars: ['s', 'label'] },
    results: {
      bindings: Array.from({ length: 10 }, (_, row) => ({
        s: { type: 'uri', value: `http://example.org/item/${row}` },
        label: { type: 'literal', value: `Item ${row}` },
      })),
    },
  }),
);

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

/** An endpoint that answers every request with `MOCK_RESULT`, with no delay. */
function mockEndpoint(): Server {
  return createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, {
        'content-type': 'application/sparql-results+json',
        'content-length': MOCK_RESULT.length,
      });
      response.end(MOCK_RESULT);
    });
  });
}

/** A free port: the child server needs a number before it starts. */
async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function waitForHealth(base: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`The server stopped at start-up (exit ${child.exitCode}).`);
    try {
      const response = await fetch(`${base}/health`);
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // The server does not listen yet.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('The server did not answer GET /health in 30 s.');
}

async function postJson(base: string, path: string, body: unknown): Promise<{ id: string }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${path} answered ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as { id: string };
}

type Case = { name: string; path: string; body: string };

/** Sends `testCase` over `CONNECTIONS` connections for `seconds`. */
async function measure(base: string, testCase: Case, seconds: number): Promise<{ rate: number; failures: number }> {
  const end = performance.now() + seconds * 1000;
  let done = 0;
  let failures = 0;
  const start = performance.now();
  await Promise.all(
    Array.from({ length: CONNECTIONS }, async () => {
      while (performance.now() < end) {
        try {
          const response = await fetch(`${base}${testCase.path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: testCase.body,
          });
          await response.arrayBuffer();
          if (response.ok) done += 1;
          else failures += 1;
        } catch {
          failures += 1;
        }
      }
    }),
  );
  return { rate: done / ((performance.now() - start) / 1000), failures };
}

async function main(): Promise<number> {
  const mock = mockEndpoint();
  const mockPort = await listen(mock);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      FASTIFY_ADDRESS: '127.0.0.1',
      NODE_ENV: 'production',
      SQLIB_AUTH_MODE: 'disabled',
      LIBRARY_STORAGE_DIR: ':memory:',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // The server logs each request. Keep the last lines, and print them when a
  // case fails or the script throws.
  const serverLog: string[] = [];
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    serverLog.push(...chunk.split('\n').filter(Boolean));
    if (serverLog.length > 40) serverLog.splice(0, serverLog.length - 40);
  });
  const printServerLog = () => console.error(['Last server log lines:', ...serverLog].join('\n'));

  try {
    await waitForHealth(base, child);

    const library = await postJson(base, '/libraries', { name: 'throughput smoke' });
    const query = await postJson(base, '/queries', { name: 'by subject', isPartOf: library.id });
    await postJson(base, `/queries/${encodeURIComponent(query.id)}/versions`, {
      queryVersion: {
        queryString:
          'SELECT ?s ?label WHERE { VALUES ?s { UNDEF } ?s <http://www.w3.org/2000/01/rdf-schema#label> ?label }',
      },
    });
    const remote = await postJson(base, '/backends', {
      name: 'mock endpoint',
      backendType: 'http',
      endpoint: `http://127.0.0.1:${mockPort}/sparql`,
    });
    const memory = await postJson(base, '/backends', {
      name: 'memory store',
      backendType: 'oxigraphMemory',
      oxigraphConfig: JSON.stringify({ storeType: 'ephemeral', mode: 'ephemeral' }),
    });
    for (let from = 0; from < MEMORY_SUBJECTS; from += 1000) {
      let triples = '';
      for (let subject = from; subject < from + 1000; subject += 1) {
        const iri = `<http://example.org/item/${subject}>`;
        triples +=
          `${iri} <http://www.w3.org/2000/01/rdf-schema#label> "Item ${subject}" ; ` +
          `<http://example.org/n> ${subject} ; ` +
          `<http://example.org/group> <http://example.org/group/${subject % 50}> ; ` +
          'a <http://example.org/Item> .\n';
      }
      await postJson(base, '/sparql', { backendId: memory.id, query: `INSERT DATA { ${triples} }` });
    }

    const pointQuery =
      'SELECT ?label WHERE { <http://example.org/item/123> <http://www.w3.org/2000/01/rdf-schema#label> ?label }';
    const cases: Case[] = [
      {
        name: 'POST /execute, mock endpoint',
        path: '/execute',
        body: JSON.stringify({
          targetId: query.id,
          backendId: remote.id,
          arguments: [
            {
              head: { vars: ['s'] },
              results: { bindings: [{ s: { type: 'uri', value: 'http://example.org/item/1' } }] },
            },
          ],
        }),
      },
      {
        name: 'POST /sparql, mock endpoint',
        path: '/sparql',
        body: JSON.stringify({ backendId: remote.id, query: pointQuery }),
      },
      {
        name: 'POST /sparql, memory store',
        path: '/sparql',
        body: JSON.stringify({ backendId: memory.id, query: pointQuery }),
      },
    ];

    let failed = 0;
    for (const testCase of cases) {
      await measure(base, testCase, 1); // Warm-up: route schemas compile on the first response.
      const { rate, failures } = await measure(base, testCase, SECONDS);
      const ok = failures === 0 && rate >= FLOOR;
      if (!ok) failed += 1;
      console.log(
        `${ok ? 'ok  ' : 'FAIL'} ${testCase.name}: ${Math.round(rate)} requests/s` +
          ` (floor ${FLOOR}), ${failures} failed requests`,
      );
    }
    if (failed > 0) printServerLog();
    return failed === 0 ? 0 : 1;
  } catch (error) {
    printServerLog();
    throw error;
  } finally {
    child.kill('SIGTERM');
    mock.close();
    mock.closeAllConnections();
  }
}

main().then(
  code => process.exit(code),
  error => {
    console.error(error);
    process.exit(1);
  },
);
