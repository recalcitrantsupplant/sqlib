/**
 * `/notebooks` over a real cache coordinator and an in-memory store.
 *
 * The generic versioned-entity routes are tested once, in their own files.
 * What is the notebook's own is the version writer: what it accepts as a
 * document, what it refuses, and that a saved version is frozen.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import notebookRoutes from '../../src/routes/notebooks.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

const LIBRARY = 'urn:sqlib:library:nb-lib';

const document = (title: string) => JSON.stringify({
  format: 'sqlib-notebook/1',
  title,
  library: LIBRARY,
  cells: [{ kind: 'markdown', id: 'c1', source: '# Hello' }],
}, null, 2);

describe('/notebooks', () => {
  let app: FastifyInstance;
  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
    }
    await app.register(notebookRoutes, { prefix: '/notebooks' });
    await app.ready();
  });

  beforeEach(async () => {
    store = await installFakePersistenceAdapter([
      { type: 'Library', entity: { $id: LIBRARY, name: 'Notebook library' } },
    ]);
  });

  afterEach(() => store.restore());
  afterAll(() => app.close());

  async function createNotebook(name = 'Walkthrough'): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/notebooks', payload: { name, isPartOf: [LIBRARY] } });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  it('saves numbered versions, stores the document compact, and points the notebook at the latest', async () => {
    const id = await createNotebook();
    expect(id).toMatch(/^urn:sqlib:notebook:/);

    const first = await app.inject({ method: 'POST', url: `/notebooks/${encodeURIComponent(id)}/versions`, payload: { contentString: document('One') } });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ version: 1, immutable: true });
    expect(first.json().contentString).toBe(JSON.stringify(JSON.parse(document('One'))));

    const second = await app.inject({ method: 'POST', url: `/notebooks/${encodeURIComponent(id)}/versions`, payload: { contentString: document('Two'), comment: 'retitled' } });
    expect(second.json()).toMatchObject({ version: 2, comment: 'retitled' });

    const notebook = await app.inject({ method: 'GET', url: `/notebooks/${encodeURIComponent(id)}` });
    expect(notebook.json()).toMatchObject({ currentVersion: second.json().id });

    const listed = await app.inject({ method: 'GET', url: '/notebooks' });
    expect(listed.json().map((entry: { id: string }) => entry.id)).toEqual([id]);

    const v1 = await app.inject({ method: 'GET', url: `/notebooks/${encodeURIComponent(id)}/versions/1` });
    expect(JSON.parse(v1.json().contentString).title).toBe('One');
  });

  it.each([
    ['not JSON', '{ nope', /not JSON/],
    ['not an object', '[1, 2]', /JSON object/],
    ['another format', JSON.stringify({ format: 'jupyter', cells: [] }), /sqlib-notebook\/1/],
    ['no cells', JSON.stringify({ format: 'sqlib-notebook/1', title: 'x' }), /cells/],
  ])('refuses a document that is %s with 400', async (_label, contentString, message) => {
    const id = await createNotebook();
    const res = await app.inject({ method: 'POST', url: `/notebooks/${encodeURIComponent(id)}/versions`, payload: { contentString } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(message);
  });

  it('lets a saved version take a comment but not new content', async () => {
    const id = await createNotebook();
    await app.inject({ method: 'POST', url: `/notebooks/${encodeURIComponent(id)}/versions`, payload: { contentString: document('One') } });
    const url = `/notebooks/${encodeURIComponent(id)}/versions/1`;

    const comment = await app.inject({ method: 'PATCH', url, payload: { comment: 'first cut' } });
    expect(comment.statusCode).toBe(200);
    expect(comment.json().comment).toBe('first cut');

    const content = await app.inject({ method: 'PATCH', url, payload: { contentString: document('Changed') } });
    expect(content.statusCode).toBe(409);
  });
});
