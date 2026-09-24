/**
 * What the change feed shows a subscriber, against the real plugin.
 *
 * `GET /events` is the one route whose answer is not a response but a
 * subscription: it stays open and writes a frame every time anybody, anywhere
 * in the deployment, writes an entity. So the question the other sweeps ask of
 * a handler — which of these rows may this caller see — has to be asked of a
 * stream, and the answer has to be re-decided per frame rather than once per
 * request.
 *
 * `events.ts` does ask it. The filter is there, it reads the right grant, and
 * it was doing almost nothing, because of where the frame's `libraryId` came
 * from.
 *
 * `changeEventFor` resolved containment by looking for a property literally
 * named `libraryId` on the response body, the request body and the query
 * string. `entityGuard.ts` knows containment has four spellings
 * (`CONTAINER_BODY_KEYS` — `isPartOf`, `targetEntity`, `library`, `libraryId`)
 * and resolves whichever it finds through the cache. Stored entities use
 * `isPartOf`: `libraryId` is an argument-set input field and an assistant
 * session field, and no entity response carries it. So the feed's resolution
 * missed on essentially every real write, `libraryId` came out null, and
 * `events.ts` let a null-library frame through to everybody on the reasoning
 * that it "carries no more than 'something changed'".
 *
 * It carries four things: the entity's kind, its IRI, the HTTP verb that
 * changed it, and the `x-sqlib-client-id` of whoever made the write. So a
 * principal holding no grant of any kind, subscribed to `/events`, was told the
 * id of every query, rule set, data graph, tuple set and ETL job written
 * anywhere in the deployment, and whether each was a create, an update or a
 * delete.
 *
 * The old test file for this route mounted stub routes that answered
 * `{ id, libraryId }` — a response shape no route in the API produces — so the
 * one field the filter depended on was supplied by the test and never by the
 * code under test. That is why the filter looked covered.
 *
 * These run the real `events.ts` over a real socket, with real principals, and
 * with stub writers shaped like the responses the real routes actually send.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';
const THEIR_QUERY = 'urn:sqlib:query:salaries';
const THEIR_RULE_SET = 'urn:sqlib:rule-set:payroll-checks';
const EXPERIMENT = 'urn:sqlib:benchmark-experiment:throughput';

const store = vi.hoisted(() => ({ entities: new Map<string, Record<string, unknown>>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => store.entities.get(id) ?? null }),
  getEntityRepositories: () => ({}),
});

const {
  changeEventFor,
  registerChangeFeedHook,
  resetChangeSubscribers,
} = await import('../../src/lib/changeEvents.js');
const eventRoutes = (await import('../../src/routes/events.js')).default;

function contextFor(libraries: Record<string, readonly string[]>): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map(),
      libraries: new Map(
        Object.entries(libraries).map(([library, modes]) => [library, new Set(modes)])
      ),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  } as AuthContext;
}

/** Holds every mode on their own library, and nothing anywhere else. */
const stranger = contextFor({ [MINE]: ['read', 'write', 'execute', 'delete'] });
/** May read the library the writes below are aimed at. */
const neighbour = contextFor({ [THEIRS]: ['read'] });

/** The context the next request will carry, so one app serves several callers. */
let nextContext: AuthContext = stranger;

function seed(): void {
  store.entities.clear();
  for (const library of [MINE, THEIRS]) {
    store.entities.set(library, { '@type': 'Library', $id: library });
  }
  store.entities.set(THEIR_QUERY, {
    '@type': 'Query',
    $id: THEIR_QUERY,
    isPartOf: [THEIRS],
  });
  store.entities.set(THEIR_RULE_SET, {
    '@type': 'RuleSet',
    $id: THEIR_RULE_SET,
    isPartOf: THEIRS,
  });
  // No `isPartOf` in its schema: unowned by design, which is the guard's
  // abstaining case rather than its denying one.
  store.entities.set(EXPERIMENT, { '@type': 'BenchmarkExperiment', $id: EXPERIMENT });
}

/**
 * The app, with writers that answer the way the real routes answer.
 *
 * The entity responses carry `$id`/`isPartOf` and no `libraryId`, because that
 * is what `packages/api/src/routes/*.ts` send. A stub that invents `libraryId`
 * tests the stub.
 */
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async request => {
    request.authContext = nextContext;
  });
  registerChangeFeedHook(app);
  await app.register(eventRoutes, { prefix: '/events' });

  app.put('/queries/:id', async () => store.entities.get(THEIR_QUERY));
  // Actually removes it, because that is the state `onSend` runs in and the
  // whole reason the lookup cannot wait until then.
  app.delete('/rule-sets/:id', async (request, reply) => {
    store.entities.delete((request.params as { id: string }).id);
    return reply.status(204).send();
  });
  app.put('/benchmark-experiments/:id', async () => store.entities.get(EXPERIMENT));
  // Answers 204 with no body, so nothing but the path id is available to
  // resolve from — and that id is in no cache.
  app.delete('/data-graphs/:id', async (_request, reply) => reply.status(204).send());

  await app.ready();
  return app;
}

/** Reads `data:` frames off an SSE body, one at a time. */
function frameReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async next(): Promise<Record<string, unknown>> {
      for (;;) {
        const index = buffer.indexOf('data: ');
        if (index !== -1) {
          const end = buffer.indexOf('\n\n', index);
          if (end !== -1) {
            const frame = buffer.slice(index + 6, end);
            buffer = buffer.slice(end + 2);
            return JSON.parse(frame) as Record<string, unknown>;
          }
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended before a frame arrived');
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel: () => reader.cancel().catch(() => undefined),
  };
}

describe('GET /events, against the real plugin', () => {
  let app: FastifyInstance;
  let address: string;
  const controllers: AbortController[] = [];

  beforeEach(async () => {
    seed();
    resetChangeSubscribers();
    nextContext = stranger;
    app = await buildApp();
    address = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    for (const controller of controllers) controller.abort();
    controllers.length = 0;
    await app.close();
    resetChangeSubscribers();
  });

  /** Subscribes as `context` and returns a reader positioned past the greeting. */
  async function subscribe(context: AuthContext) {
    nextContext = context;
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(`${address}/events`, { signal: controller.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    return frameReader(response.body!);
  }

  async function write(method: 'PUT' | 'DELETE', url: string): Promise<void> {
    nextContext = contextFor({ [THEIRS]: ['read', 'write', 'delete'] });
    const response = await app.inject({ method, url, payload: method === 'PUT' ? {} : undefined });
    expect(response.statusCode).toBeLessThan(300);
  }

  /*
   * The canary is how "did not receive" is asserted without a sleep: the
   * withheld frame is published first, so if the next frame to arrive is the
   * one published second, the first was dropped rather than merely slow.
   */
  it('withholds a write to a library the subscriber cannot read', async () => {
    const frames = await subscribe(stranger);

    await write('PUT', `/queries/${encodeURIComponent(THEIR_QUERY)}`);
    await write('PUT', `/benchmark-experiments/${encodeURIComponent(EXPERIMENT)}`);

    // The query frame names another library's entity; only the experiment,
    // which is unowned and readable by any authenticated principal today,
    // should arrive.
    expect(await frames.next()).toMatchObject({ entity: 'benchmarkExperiment', id: EXPERIMENT });
  });

  it('delivers that same write to a subscriber who may read the library', async () => {
    const frames = await subscribe(neighbour);

    await write('PUT', `/queries/${encodeURIComponent(THEIR_QUERY)}`);

    expect(await frames.next()).toMatchObject({
      entity: 'query',
      id: THEIR_QUERY,
      libraryId: THEIRS,
    });
  });

  /*
   * A delete is the frame that most wants withholding — it names an entity and
   * says it is gone — and the one the feed cannot resolve after the fact,
   * because by `onSend` the entity is out of the cache. Resolution therefore
   * has to happen before the handler runs, which is where the guard already
   * does it.
   */
  it('withholds a delete, whose entity is gone by the time the frame is built', async () => {
    const frames = await subscribe(stranger);

    await write('DELETE', `/rule-sets/${encodeURIComponent(THEIR_RULE_SET)}`);
    await write('PUT', `/benchmark-experiments/${encodeURIComponent(EXPERIMENT)}`);

    expect(await frames.next()).toMatchObject({ entity: 'benchmarkExperiment' });
  });

  /*
   * The case the filter itself decides, rather than the resolution.
   *
   * A write to an entity this process has never cached resolves to no library
   * and is not unowned either — a dangling reference, the situation
   * `entityGuard.ts` refuses rather than abstains on. Letting it through was
   * the old behaviour for *every* frame; it is still the only shape that
   * reaches this branch now that resolution works.
   */
  it('withholds a frame whose library cannot be resolved at all', async () => {
    const frames = await subscribe(stranger);

    await write('DELETE', '/data-graphs/urn:sqlib:data-graph:not-in-this-cache');
    await write('PUT', `/benchmark-experiments/${encodeURIComponent(EXPERIMENT)}`);

    expect(await frames.next()).toMatchObject({ entity: 'benchmarkExperiment' });
  });

  it('delivers a delete to a subscriber who may read the library', async () => {
    const frames = await subscribe(neighbour);

    await write('DELETE', `/rule-sets/${encodeURIComponent(THEIR_RULE_SET)}`);

    expect(await frames.next()).toMatchObject({
      entity: 'ruleSet',
      id: THEIR_RULE_SET,
      libraryId: THEIRS,
      method: 'DELETE',
    });
  });
});

describe('changeEventFor resolves containment the way the guard does', () => {
  beforeEach(seed);

  const reply = { statusCode: 200 } as never;

  it('follows `isPartOf` on the response body, which is what routes send', () => {
    const request = {
      method: 'PUT',
      url: `/queries/${encodeURIComponent(THEIR_QUERY)}`,
      params: { id: THEIR_QUERY },
      headers: {},
      body: {},
      query: {},
    } as never;

    expect(changeEventFor(request, reply, '')).toMatchObject({
      entity: 'query',
      id: THEIR_QUERY,
      libraryId: THEIRS,
    });
  });

  it('still treats a library write as its own library id', () => {
    const request = {
      method: 'PUT',
      url: `/libraries/${encodeURIComponent(THEIRS)}`,
      params: { id: THEIRS },
      headers: {},
      body: {},
      query: {},
    } as never;

    expect(changeEventFor(request, reply, '')).toMatchObject({
      entity: 'library',
      id: THEIRS,
      libraryId: THEIRS,
    });
  });

  it('marks an entity that names no container as unowned rather than unresolved', () => {
    const request = {
      method: 'PUT',
      url: `/benchmark-experiments/${encodeURIComponent(EXPERIMENT)}`,
      params: { id: EXPERIMENT },
      headers: {},
      body: {},
      query: {},
    } as never;

    expect(changeEventFor(request, reply, '')).toMatchObject({
      entity: 'benchmarkExperiment',
      libraryId: null,
      unowned: true,
    });
  });

  it('leaves an entity it cannot find at all unresolved, not unowned', () => {
    const request = {
      method: 'DELETE',
      url: '/queries/urn:sqlib:query:vanished',
      params: { id: 'urn:sqlib:query:vanished' },
      headers: {},
      body: {},
      query: {},
    } as never;

    expect(changeEventFor(request, reply, '')).toMatchObject({
      entity: 'query',
      libraryId: null,
      unowned: false,
    });
  });
});
