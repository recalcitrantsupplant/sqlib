/**
 * The read-only gate, measured against the real route table.
 *
 * `STATELESS_ROUTES` is a list of claims about handlers, and a list of claims
 * rots. This registers every route plugin the server registers, at the prefix
 * the server gives it, and fails in both directions:
 *
 * - an allowlist entry naming no registered route (a renamed or deleted route,
 *   where the silent outcome is a demo that stopped working and nobody looked
 *   at the handler that replaced it), and
 * - a mutating route that is neither allowlisted nor refused, which is the
 *   write route added later that this gate exists to catch.
 *
 * Registration only declares routes, so no store, cache or feature flag is
 * needed to walk the table.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import {
  EXTERNAL_STATELESS_ROUTES,
  MUTATING_METHODS,
  STATELESS_ROUTES,
  isRefusedWhenReadOnly,
  normalizeRouteUrl,
} from '../../src/config/readOnly.js';

/** Prefix → module, mirroring the `register` calls in `src/index.ts`. */
const PLUGINS: Record<string, string> = {
  '/events': '../../src/routes/events.js',
  '/auth': '../../src/routes/auth.js',
  '/backends': '../../src/routes/backends.js',
  '/libraries': '../../src/routes/libraries.js',
  '/tags': '../../src/routes/tags.js',
  '/tuple-sets': '../../src/routes/tuple-sets.js',
  '/data-graphs': '../../src/routes/data-graphs.js',
  '/patches': '../../src/routes/patches.js',
  '/queries': '../../src/routes/queries.js',
  '/execute': '../../src/routes/execute.js',
  '/rules': '../../src/routes/rules.js',
  '/data-blocks': '../../src/routes/data-blocks.js',
  '/rule-sets': '../../src/routes/rule-sets.js',
  '/playground': '../../src/routes/playground.js',
  '/query-groups': '../../src/routes/query-groups.js',
  '/benchmark-experiments': '../../src/routes/benchmarks.js',
  '/argument-sets': '../../src/routes/argument-sets.js',
  '/tests': '../../src/routes/tests.js',
  '/etl-jobs': '../../src/routes/etl-jobs.js',
  '/assistant': '../../src/routes/assistant.js',
  '': '../../src/routes/detection.js',
  '/sparql-proxy': '../../src/routes/sparql.js',
};

interface Route {
  method: string;
  url: string;
}

const routes: Route[] = [];

beforeAll(async () => {
  for (const [prefix, specifier] of Object.entries(PLUGINS)) {
    // One app per plugin: two plugins declaring the same path (the detection
    // and SPARQL modules both mount at the root) would collide in one.
    const app: FastifyInstance = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
    }
    app.addHook('onRoute', route => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) routes.push({ method, url: route.url });
    });
    const plugin = (await import(specifier)).default;
    await app.register(plugin as never, { prefix: prefix === '/sparql-proxy' ? '' : prefix });
    await app.ready();
  }
});

describe('the read-only route table', () => {
  it('registers something to measure', () => {
    // A crashed walk and a clean tree both score zero; see ratchet-selftest.
    expect(routes.length).toBeGreaterThan(50);
  });

  it('has a real route behind every allowlist entry', () => {
    const registered = new Set(
      routes
        .filter(route => MUTATING_METHODS.includes(route.method.toUpperCase()))
        .map(route => normalizeRouteUrl(route.url))
    );
    const missing = STATELESS_ROUTES.filter(entry => !registered.has(entry));
    expect(
      missing,
      `STATELESS_ROUTES names ${missing.join(', ')}, which no mutating route serves. ` +
        'If a route was renamed, read the handler that replaced it before re-listing it.'
    ).toEqual([]);
  });

  it('refuses every mutating route it does not name', () => {
    const admitted = routes
      .filter(route => MUTATING_METHODS.includes(route.method.toUpperCase()))
      .filter(route => !isRefusedWhenReadOnly(route.method, route.url))
      .map(route => `${route.method} ${normalizeRouteUrl(route.url)}`);

    const expected = routes
      .filter(route => MUTATING_METHODS.includes(route.method.toUpperCase()))
      .filter(route => STATELESS_ROUTES.includes(normalizeRouteUrl(route.url)))
      .map(route => `${route.method} ${normalizeRouteUrl(route.url)}`);

    expect(new Set(admitted)).toEqual(new Set(expected));
  });

  it('refuses the write routes by name', () => {
    // A handful spelled out, so the gate is readable without running it.
    for (const route of [
      'POST /queries',
      'PUT /queries/:id',
      'DELETE /queries/:id',
      'POST /backends',
      'POST /backends/probes',
      'POST /etl-jobs/preview',
      'POST /playground/etl/execute',
      'POST /auth/grants',
      'POST /libraries',
    ]) {
      const [method, url] = route.split(' ');
      expect(isRefusedWhenReadOnly(method, url), `${route} should be refused`).toBe(true);
    }
  });

  it('admits the compute routes the demo needs', () => {
    for (const route of [
      'POST /detect-inputs',
      'POST /format',
      'POST /execute',
      'POST /sparql',
      'POST /playground/rules/execute',
      'POST /rule-sets/srl/analyze',
    ]) {
      const [method, url] = route.split(' ');
      expect(isRefusedWhenReadOnly(method, url), `${route} should be admitted`).toBe(false);
    }
  });

  /*
   * The other direction, and the one issue #26 was about: this file walked the
   * table for refusals only, so a route that *should* answer on a read-only
   * deployment and does not reads as the gate working. Running a test and
   * reaching MCP were both refused through a green CI that way.
   */
  it('keeps the routes a read-only deployment must still answer', () => {
    for (const route of [
      // A verdict is compute; the run history is the write, and
      // `recordTestRuns` is what declines it. See `TestRunStore`.
      'POST /tests/run',
      'POST /tests/:id/run',
      // All of MCP is POST /mcp, so refusing it removes every tool.
      'POST /mcp',
      'GET /mcp',
      'DELETE /mcp',
    ]) {
      const [method, url] = route.split(' ');
      expect(isRefusedWhenReadOnly(method, url), `${route} should be reachable`).toBe(false);
    }
  });

  it('keeps the external allowlist for routes this table does not serve', () => {
    // An entry this table does serve belongs in `STATELESS_ROUTES`, where the
    // rot check above covers it. `EXTERNAL_STATELESS_ROUTES` is exempt from
    // that check, so it must not collect entries the check would have covered.
    const registered = new Set(
      routes
        .filter(route => MUTATING_METHODS.includes(route.method.toUpperCase()))
        .map(route => normalizeRouteUrl(route.url))
    );
    const misplaced = EXTERNAL_STATELESS_ROUTES.filter(entry => registered.has(entry));
    expect(misplaced).toEqual([]);
  });

  it('leaves reads alone', () => {
    for (const route of routes.filter(r => r.method.toUpperCase() === 'GET')) {
      expect(isRefusedWhenReadOnly(route.method, route.url)).toBe(false);
    }
  });
});
