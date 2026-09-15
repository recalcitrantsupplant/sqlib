/**
 * Whose assistant session is this, against the real plugin.
 *
 * The sweep before this one asked what a *stream* may tell a subscriber, frame
 * by frame (`events.ts`, #467). This one asks the question a step further in:
 * `/assistant` streams too, but its stream belongs to a conversation, and a
 * conversation is the one resource in this API that no grant can name. A
 * library has an IRI a grant can mention and an `isPartOf` a guard can follow.
 * A session has neither — it lives in a `Map` in the process, it is explicitly
 * not a library artifact, and `resolveOwningLibrary` has nothing to resolve.
 *
 * So the entity guard was not wrong here and no filter was missing. There was
 * simply no question being asked: `service.get(id)` answered any caller who
 * had the id, and the id is the only thing a session had. Run at the real
 * plugin in `required` mode, a principal holding **no grant of any kind** was
 * answered 200 for another principal's session — its library, its staged
 * drafts and the SPARQL in them — could interrupt that principal's turn
 * mid-flight, and could post into the conversation, which hands the model the
 * whole history and streams the answer back.
 *
 * The plugin's own header said the door was unauthenticated, which stopped
 * being true when `/assistant` turned out not to be a public path: in
 * `required` mode a token is required to reach any of this. What a token did
 * not decide was *which* sessions it reached, and that is what these rows are.
 *
 * `POST /sessions` is here for the same reason one route along: a session names
 * the library its drafts are staged for, and it took any library id at all.
 *
 * Two deliberate answers, both recorded rather than assumed:
 *
 * - **An administrator is not an owner.** `grants.admin` is over the
 *   deployment's entities; a half-written prompt is not one. The admin row
 *   below is a 404 on purpose, and is the row that fails if someone widens
 *   `requireOwner` to admins for symmetry with the rest of the vocabulary.
 * - **The refusal is a 404, byte-identical to an unknown id.** The uuid is the
 *   only thing keeping a session private, so an answer that separated "not
 *   yours" from "not there" would spend the bit the uuid is holding.
 *
 * `test/assistant/routes.test.ts` mounts this plugin with no auth context at
 * all — `authOf` then hands back a full-access context, which is `disabled`
 * mode, where every caller is the same anonymous subject and sessions are
 * shared exactly as they always were. That file passes unchanged, which is the
 * evidence that this narrows who may reach a session rather than changing what
 * a session does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import assistantRoutes, {
  configureAssistant,
  resetAssistantConfiguration,
} from '../../src/routes/assistant.js';
import type { ModelClient, ModelRequest, ModelStreamEvent } from '../../src/assistant/model.js';
import { createFullAccessContext, type AuthContext } from '../../src/auth/types.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';

const OWNER = 'urn:sqlib:principal:user:owner';
const STRANGER = 'urn:sqlib:principal:user:stranger';

function contextFor(subject: string, library: string | null, admin = false): AuthContext {
  return {
    subject,
    principals: [subject, 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin,
      backends: new Map(),
      libraries: library ? new Map([[library, new Set(['read'] as const)]]) : new Map(),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

const owner = contextFor(OWNER, MINE);
const stranger = contextFor(STRANGER, null);
const strangerWithOwnLibrary = contextFor(STRANGER, THEIRS);
const admin = { ...contextFor('urn:sqlib:principal:user:admin', null, true) };

/** Whoever the next request is from. Swapped between injects. */
let current: AuthContext = owner;

/** Every request the model was handed, so a test can assert on the history. */
let modelRequests: ModelRequest[] = [];
let scripted: ModelStreamEvent[][] = [];

function scriptedFactory(): ModelClient {
  let turn = 0;
  return {
    modelId: 'test/scripted',
    async *stream(request: ModelRequest) {
      modelRequests.push(request);
      const events = scripted[turn] ?? [];
      turn += 1;
      for (const event of events) yield event;
    },
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  scripted = [];
  modelRequests = [];
  current = owner;
  configureAssistant({ modelClientFactory: scriptedFactory });

  app = Fastify({ logger: false });
  // The shape `index.ts` gives an `AuthorizationError`: a status code and a
  // body carrying `route` and `requestId` beside the message. The 404 rows
  // below are about a refusal that must *not* come out of here.
  app.setErrorHandler((error, request, reply) => {
    reply.status((error as { statusCode?: number }).statusCode ?? 500).send({
      error: error.message,
      route: `${request.method} ${request.url}`,
      requestId: request.id,
    });
  });
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async (request) => {
    request.authContext = current;
  });
  app.post('/sparql', async () => ({ results: { bindings: [] } }));
  await app.register(assistantRoutes, { prefix: '/assistant' });
  await app.ready();
});

afterEach(async () => {
  resetAssistantConfiguration();
  await app.close();
});

async function open(context: AuthContext, libraryId: string | null = MINE) {
  current = context;
  return app.inject({ method: 'POST', url: '/assistant/sessions', payload: { libraryId } });
}

async function openedBy(context: AuthContext, libraryId: string | null = MINE): Promise<string> {
  const response = await open(context, libraryId);
  return (JSON.parse(response.payload) as { id: string }).id;
}

describe('assistant sessions belong to the principal that opened one', () => {
  it('answers the owner', async () => {
    const id = await openedBy(owner);

    current = owner;
    const response = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({ id, libraryId: MINE });
  });

  it('does not answer a stranger holding no grant of any kind', async () => {
    const id = await openedBy(owner);

    current = stranger;
    const response = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });

    expect(response.statusCode).toBe(404);
  });

  it('does not answer a stranger holding read on a library of their own', async () => {
    const id = await openedBy(owner);

    current = strangerWithOwnLibrary;
    const response = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });

    expect(response.statusCode).toBe(404);
  });

  /*
   * The row that says the decision is about ownership rather than about
   * privilege. Flipping `requireOwner` to let admins in fails here and nowhere
   * else, so the choice cannot be made by accident.
   */
  it('does not answer an administrator either', async () => {
    const id = await openedBy(owner);

    current = admin;
    const response = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });

    expect(response.statusCode).toBe(404);
  });

  it('refuses a session that is not theirs exactly as it refuses one that is not there', async () => {
    const id = await openedBy(owner);

    current = stranger;
    const theirs = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });
    const missing = await app.inject({ method: 'GET', url: '/assistant/sessions/session-nope' });

    expect(theirs.statusCode).toBe(missing.statusCode);
    // Byte-identical, not merely both 404: the global handler's body carries a
    // `route` and a `requestId` that an unknown id's does not, so a refusal
    // escaping to it would be a usable oracle for which ids exist.
    expect(theirs.payload).toBe(missing.payload);
    expect(JSON.parse(theirs.payload)).toEqual({ error: 'Session not found' });
  });

  it('does not let a stranger interrupt a turn', async () => {
    const id = await openedBy(owner);

    current = stranger;
    const response = await app.inject({ method: 'POST', url: `/assistant/sessions/${id}/interrupt` });

    expect(response.statusCode).toBe(404);
  });

  /*
   * The worst of the three, because a session is not only read by this: the
   * turn is prefixed with everything said so far, so posting into someone
   * else's conversation is a read of all of it with an answer streamed back.
   */
  it('does not let a stranger post into the conversation', async () => {
    scripted = [[{ type: 'text', text: 'Hello ' }]];
    const id = await openedBy(owner);

    current = stranger;
    const response = await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { prompt: 'what were we saying?', provider: 'test', model: 'scripted' },
    });

    expect(response.statusCode).toBe(404);
    // No stream was opened and no model was called, so nothing of the owner's
    // conversation was assembled in the first place.
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    expect(modelRequests).toHaveLength(0);
  });

  /*
   * The drafts are the payload of the read, so one is staged for real rather
   * than asserted about in the abstract: the owner's turn calls
   * `drafts.createQuery`, and what a stranger would have been handed is the
   * name and the SPARQL.
   */
  it('does not hand a stranger the drafts staged in the session', async () => {
    scripted = [
      [{
        type: 'tool-call',
        call: {
          id: 'c1',
          name: 'drafts.createQuery',
          arguments: { name: 'Salaries', queryString: 'SELECT ?salary WHERE { ?p <http://example.org/earns> ?salary }' },
        },
      }],
      [{ type: 'text', text: 'Staged.' }],
    ];
    const id = await openedBy(owner);

    current = owner;
    await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { prompt: 'draft me one', provider: 'test', model: 'scripted' },
    });

    const mine = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });
    expect(JSON.parse(mine.payload).drafts).toHaveLength(1);

    current = stranger;
    const theirs = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });
    expect(theirs.statusCode).toBe(404);
    expect(theirs.payload).not.toContain('Salaries');
    expect(theirs.payload).not.toContain('example.org/earns');
  });

  it('lets each principal reach their own session', async () => {
    const mine = await openedBy(owner);
    const theirs = await openedBy(strangerWithOwnLibrary, THEIRS);

    current = owner;
    expect((await app.inject({ method: 'GET', url: `/assistant/sessions/${mine}` })).statusCode).toBe(200);

    current = strangerWithOwnLibrary;
    expect((await app.inject({ method: 'GET', url: `/assistant/sessions/${theirs}` })).statusCode).toBe(200);
  });

  /*
   * `disabled` mode, which is the deployment this door was written for and the
   * one every existing test of it runs in: one anonymous subject, so a second
   * browser tab is the same caller and sessions stay shared.
   */
  it('shares sessions when auth is disabled, as it always did', async () => {
    const anonymous = createFullAccessContext('disabled');
    const id = await openedBy(anonymous);

    current = { ...createFullAccessContext('disabled') };
    const response = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });

    expect(response.statusCode).toBe(200);
  });

  /*
   * `dry-run` audits what it would have refused and lets the request through.
   * The row exists because the natural way to write this check — an `if` on
   * the owner — would have enforced in all three modes and made this the one
   * refusal in the API that dry-run could not preview.
   */
  it('lets a stranger through in dry-run mode, as every other check does', async () => {
    const id = await openedBy(owner);

    current = { ...stranger, mode: 'dry-run' };
    const response = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });

    expect(response.statusCode).toBe(200);
  });
});

describe('opening a session on a library', () => {
  it('opens one on a library the caller may read', async () => {
    const response = await open(owner, MINE);
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload).libraryId).toBe(MINE);
  });

  it('refuses one on a library the caller may not read', async () => {
    const response = await open(stranger, MINE);
    expect(response.statusCode).toBe(403);
  });

  /*
   * A session with no library is the panel's own default — nothing is scoped,
   * so there is nothing to hold a grant on.
   */
  it('opens an unscoped session for anyone', async () => {
    const response = await open(stranger, null);
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload).libraryId).toBeNull();
  });

  /*
   * And the session that refusal protects: the drafts staged in a session are
   * staged *for* its library, so a session opened on a library the caller
   * cannot read would have been a place to build against one.
   */
  it('does not leave a session behind when it refuses', async () => {
    const refused = await open(stranger, MINE);
    expect(refused.statusCode).toBe(403);
    expect(refused.payload).not.toContain('session-');
  });
});
