/**
 * `detection.ts` is classified `stateless` in `route-coverage.test.ts`, which
 * is a claim about the handlers rather than about the paths: each takes SPARQL
 * or SRL text from the request, hands it to a parser, and answers about the
 * text. No entity is named, nothing is loaded, and the plugin registers no
 * guard — correctly, because a guard would abstain on every route while
 * reading as coverage.
 *
 * A classification nothing checks is a comment. These rows check the half that
 * could stop being true: a route here growing a lookup would make the plugin's
 * entry in the manifest wrong, silently, since the guard it does not have
 * cannot start refusing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { resolveEffectiveGrants } from '../../src/auth/grants.js';
import { AuthStore, inMemoryPersistence } from '../../src/auth/AuthStore.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

/** Every read of stored state in this API goes through here. */
const getCacheCoordinator = vi.fn(() => ({ get: () => null }));
overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => getCacheCoordinator(),
  getEntityRepositories: () => ({}),
});

const { default: detectionRoutes } = await import('../../src/routes/detection.js');

const NOBODY = 'urn:sqlib:principal:user:nobody';
const SELECT = 'SELECT ?s WHERE { ?s ?p ?o }';

/** A `required`-mode caller holding no grant of any kind. */
async function contextHoldingNothing(): Promise<AuthContext> {
  const store = new AuthStore(inMemoryPersistence());
  await store.load();
  return {
    subject: NOBODY,
    principals: [NOBODY],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: resolveEffectiveGrants([NOBODY], store),
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

async function app(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  setupValidator(instance);
  const context = await contextHoldingNothing();
  instance.decorateRequest('authContext', undefined);
  instance.addHook('onRequest', async request => {
    request.authContext = context;
  });
  // Mounted at the root, as `index.ts` mounts it.
  await instance.register(detectionRoutes, { prefix: '' });
  await instance.ready();
  return instance;
}

beforeEach(() => {
  getCacheCoordinator.mockClear();
});

describe('detection routes', () => {
  /**
   * The reach is the intended one: the editor calls these on every keystroke,
   * for text the caller has just typed and therefore already holds. A caller
   * holding nothing is exactly who must be answered.
   */
  it.each([
    ['POST', '/detect-inputs', { query: SELECT }],
    ['POST', '/detect-outputs', { query: SELECT }],
    ['POST', '/validate', { query: SELECT }],
    ['POST', '/format', { code: SELECT }],
    ['POST', '/validate-rule-data', { ruleOrData: 'DATA { <urn:a> <urn:b> <urn:c> }' }],
  ])('answers %s %s for a principal holding no grants', async (method, url, payload) => {
    const instance = await app();

    const response = await instance.inject({ method: method as 'POST', url, payload });

    expect(response.statusCode).toBe(200);
    await instance.close();
  });

  it.each([
    ['/detect-inputs'],
    ['/detect-outputs'],
  ])('answers GET %s for a principal holding no grants', async url => {
    const instance = await app();

    const response = await instance.inject({
      method: 'GET',
      url: `${url}?query=${encodeURIComponent(SELECT)}`,
    });

    expect(response.statusCode).toBe(200);
    await instance.close();
  });

  it('reads no stored entity while answering any of them', async () => {
    // The `stateless` claim itself. Every route in the plugin, one app, and the
    // one function that reaches the store never called.
    const instance = await app();

    await instance.inject({ method: 'POST', url: '/detect-inputs', payload: { query: SELECT } });
    await instance.inject({ method: 'POST', url: '/detect-outputs', payload: { query: SELECT } });
    await instance.inject({ method: 'POST', url: '/validate', payload: { query: SELECT } });
    await instance.inject({ method: 'POST', url: '/format', payload: { code: SELECT } });
    await instance.inject({
      method: 'POST',
      url: '/validate-rule-data',
      payload: { ruleOrData: 'DATA { <urn:a> <urn:b> <urn:c> }' },
    });
    await instance.inject({
      method: 'GET',
      url: `/detect-inputs?query=${encodeURIComponent(SELECT)}`,
    });
    await instance.inject({
      method: 'GET',
      url: `/detect-outputs?query=${encodeURIComponent(SELECT)}`,
    });

    expect(getCacheCoordinator).not.toHaveBeenCalled();
    await instance.close();
  });

  it('refuses invalid SPARQL rather than reaching for anything to resolve it', async () => {
    // The failure path answers from the parser too: a 400 about the text, not
    // a lookup of something the text might have named.
    const instance = await app();

    const response = await instance.inject({
      method: 'POST',
      url: '/validate',
      payload: { query: 'SELECT ?s WHERE {' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().valid).toBe(false);
    expect(getCacheCoordinator).not.toHaveBeenCalled();
    await instance.close();
  });
});
