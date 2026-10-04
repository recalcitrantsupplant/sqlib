/**
 * The route table per feature-flag combination (WP21, review finding D14).
 *
 * A switched-off section is not registered at all, so what is mounted is the
 * claim to pin: `/sparql` and `/detect-*` belong to queries, each playground
 * route to its own flag, and argument sets to whatever can be called with one
 * — tests included.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import { buildFeatureFlags, type FeatureFlags } from '@sparql-query-lib/types';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { registerApplicationRoutes } from '../../src/server/registerRoutes.js';

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: () => null, list: () => [] }),
  getEntityRepositories: () => ({}),
});

afterAll(() => overrideCacheCoordinatorProvider(null));

const SECTIONS = [
  'queries', 'queryGroups', 'rulesSuite', 'tests', 'benchmarks', 'etl', 'assistant',
  'playgroundQueries', 'playgroundRules', 'playgroundEtl',
] as const;

/** Every section off, then the named ones on. */
function flags(on: Array<(typeof SECTIONS)[number]>): FeatureFlags {
  const base = buildFeatureFlags({}) as unknown as Record<string, boolean>;
  for (const key of SECTIONS) base[key] = on.includes(key);
  return base as unknown as FeatureFlags;
}

async function mounted(featureFlags: FeatureFlags): Promise<Set<string>> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema as never);
  }
  const routes = new Set<string>();
  app.addHook('onRoute', route => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) if (method !== 'HEAD') routes.add(`${method} ${route.path}`);
  });
  await registerApplicationRoutes(app, { featureFlags, registerSwagger: false, publicBasePath: '' });
  await app.ready();
  await app.close();
  return routes;
}

function under(routes: Set<string>, prefix: string): boolean {
  return [...routes].some(route => route.split(' ')[1]!.startsWith(prefix));
}

describe('the route table per flag combination', () => {
  it('mounts only the unflagged routes with every section off', async () => {
    const routes = await mounted(flags([]));

    // Shared by the query and rules editors, so not any one section's.
    expect(routes.has('POST /validate-rule-data')).toBe(true);
    expect(routes.has('POST /format')).toBe(true);

    for (const prefix of ['/health', '/metrics', '/events', '/auth', '/backends', '/libraries', '/tags', '/tuple-sets', '/data-graphs', '/patches']) {
      expect(under(routes, prefix), prefix).toBe(true);
    }
    for (const prefix of ['/queries', '/execute', '/sparql', '/detect-', '/query-groups', '/rules', '/rule-sets', '/data-blocks', '/tests', '/argument-sets', '/playground', '/benchmark-experiments', '/etl-jobs', '/assistant']) {
      expect(under(routes, prefix), prefix).toBe(false);
    }
  });

  it('puts the SPARQL proxy and query analysis under queries', async () => {
    const routes = await mounted(flags(['queries']));

    expect(routes.has('GET /sparql')).toBe(true);
    expect(routes.has('POST /sparql')).toBe(true);
    expect(routes.has('POST /detect-inputs')).toBe(true);
    expect(under(routes, '/queries')).toBe(true);
    expect(under(routes, '/argument-sets')).toBe(true);
    expect(under(routes, '/tests')).toBe(false);
  });

  it('registers argument sets for tests even with queries and groups off', async () => {
    const routes = await mounted(flags(['rulesSuite', 'tests']));

    expect(under(routes, '/tests')).toBe(true);
    expect(under(routes, '/argument-sets')).toBe(true);
    expect(under(routes, '/rule-sets')).toBe(true);
    expect(under(routes, '/sparql')).toBe(false);
  });

  it('does not register tests with nothing to test', async () => {
    const routes = await mounted(flags(['tests']));

    expect(under(routes, '/tests')).toBe(false);
    expect(under(routes, '/argument-sets')).toBe(false);
  });

  it('registers each playground route under its own flag', async () => {
    const rulesOnly = await mounted(flags(['playgroundRules']));
    expect(rulesOnly.has('POST /playground/rules/execute')).toBe(true);
    expect(rulesOnly.has('POST /playground/etl/execute')).toBe(false);

    const etlOnly = await mounted(flags(['playgroundEtl']));
    expect(etlOnly.has('POST /playground/etl/execute')).toBe(true);
    expect(etlOnly.has('POST /playground/rules/execute')).toBe(false);

    // The queries playground is the SPA's, with no route of its own here.
    expect(under(await mounted(flags(['playgroundQueries'])), '/playground')).toBe(false);
  });
});
