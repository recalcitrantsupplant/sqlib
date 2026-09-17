/**
 * Every header the client sends is one the API's CORS allowlist admits.
 *
 * A browser refuses the whole request when a preflight does not list a header
 * the request carries, and only the requests carrying that header fail — which
 * is why exporting a test run as EARL failed on its own, with every other call
 * working: `Accept: application/rdf+xml` is not CORS-safelisted, so that one
 * request preflighted, and `allowedHeaders` did not name `Accept`.
 *
 * Nothing in either package could notice: the client is right, the server is
 * right, and the agreement between them lived in two files that never mention
 * each other. So this reads both.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CLIENT = resolve(import.meta.dirname, '../src/composables/useApiClient.ts');

/** Header names the client sends under a shorthand key: `{ …, accept }`. */
const SHORTHAND = ['accept'];
const API_INDEX = resolve(import.meta.dirname, '../../api/src/index.ts');

/** The `allowedHeaders: [...]` the API registers `@fastify/cors` with. */
function allowedHeaders(): string[] {
  const source = readFileSync(API_INDEX, 'utf8');
  const match = source.match(/allowedHeaders:\s*\[([^\]]*)\]/);
  if (!match) throw new Error('No allowedHeaders in the API — has the CORS registration moved?');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase());
}

/**
 * Header names the client writes into a request.
 *
 * Read off the literals rather than by running the client: what matters is the
 * set of names that can reach a preflight, and a name is written where it is
 * sent. `authorization` is added by the auth wrapper as a computed key, so it
 * is named here rather than matched.
 */
function clientHeaders(): string[] {
  const source = readFileSync(CLIENT, 'utf8');
  const names = new Set(['authorization']);
  for (const [, block] of source.matchAll(/headers:\s*\{([^}]*)\}/g)) {
    for (const [, quoted] of block.matchAll(/'([A-Za-z][\w-]*)'\s*:/g)) names.add(quoted.toLowerCase());
    for (const [, bare] of block.matchAll(/(?:^|[,{]) *([a-z][\w-]*) *:/g)) names.add(bare.toLowerCase());
    // A shorthand key sends a header under a variable's name. There is one
    // today, and it is listed rather than inferred: an identifier inside a
    // ternary in the same block is not a header, and a regex cannot tell.
    for (const shorthand of SHORTHAND) {
      if (new RegExp(`[,{]\\s*${shorthand}\\s*(?:[,}]|$)`).test(block.trim())) names.add(shorthand);
    }
  }
  return [...names];
}

describe('CORS', () => {
  it('admits every header the client sends', () => {
    const allowed = new Set(allowedHeaders());
    const missing = clientHeaders().filter((name) => !allowed.has(name));
    expect(missing, 'add these to allowedHeaders in packages/api/src/index.ts').toEqual([]);
  });

  it('reads a real allowlist, so the check cannot pass by finding nothing', () => {
    expect(allowedHeaders()).toContain('content-type');
    expect(clientHeaders().length).toBeGreaterThan(2);
  });
});
