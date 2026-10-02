/**
 * `POST /substitute` — substitution without execution.
 *
 * The route exists so a browser-side executor gets the same query text the
 * server would have run, so what matters here is that it *is* the same: the
 * substitution runs through `applyExecutionArguments`, the same function
 * `/sparql` and `/execute` use, and a payload that does not fit is the caller's
 * 400 rather than a 500. And that nothing runs — the route has no executor to
 * reach for, which is what lets a read-only deployment serve it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import detectionRoutes from '../../src/routes/detection.js';

const QUERY = 'SELECT ?s WHERE { VALUES (?city) { (UNDEF) } ?s <http://e/in> ?city }';

describe('POST /substitute', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    await app.register(detectionRoutes, { prefix: '' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: unknown) => app.inject({ method: 'POST', url: '/substitute', payload: body });

  it('returns the query unchanged when there is nothing to substitute', async () => {
    const response = await post({ query: 'SELECT ?s WHERE { ?s ?p ?o }' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { query: string; operation: string };
    expect(body.query).toContain('SELECT');
    expect(body.operation).toBe('query');
  });

  it('splices a supplied binding into the VALUES row', async () => {
    const response = await post({
      query: QUERY,
      arguments: [
        {
          head: { vars: ['city'] },
          results: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] },
        },
      ],
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { query: string };
    expect(body.query).toContain('http://example.org/Perth');
    // The UNDEF row it replaced is gone, rather than both being present.
    expect(body.query).not.toContain('UNDEF');
  });

  it('takes a SELECT result as it came back, folding the legacy typed-literal', async () => {
    const response = await post({
      query: QUERY,
      arguments: [
        {
          head: { vars: ['city'] },
          results: {
            bindings: [
              { city: { type: 'typed-literal', value: '7', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
            ],
          },
        },
      ],
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { query: string }).query).toMatch(/7/);
  });

  it('runs a parameter the payload leaves out without its filter', async () => {
    const response = await post({
      query: 'SELECT ?s WHERE { VALUES ?city { UNDEF } VALUES ?year { UNDEF } ?s <http://e/in> ?city ; <http://e/at> ?year }',
      arguments: [{ head: { vars: ['year'] }, results: { bindings: [{ year: { type: 'literal', value: '2026' } }] } }],
    });
    expect(response.statusCode).toBe(200);
    const text = (response.json() as { query: string }).query;
    expect(text).toContain('"2026"');
    expect(text).not.toMatch(/VALUES \?city/);
    expect(text).not.toContain('UNDEF');
  });

  it('matches nothing for a parameter given zero rows', async () => {
    const response = await post({
      query: QUERY,
      arguments: [{ head: { vars: ['city'] }, results: { bindings: [] } }],
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { query: string }).query).toMatch(/VALUES \?city \{\s*\}/);
  });

  it('answers 400 for a blank node, saying why', async () => {
    const response = await post({
      query: QUERY,
      arguments: [{ head: { vars: ['city'] }, results: { bindings: [{ city: { type: 'bnode', value: 'b0' } }] } }],
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toMatch(/is a blank node/);
  });

  it('answers 400 for the retired "arguments" key and for a request-level whenEmpty', async () => {
    const old = await post({
      query: QUERY,
      arguments: [{ head: { vars: ['city'] }, arguments: { bindings: [] } }],
    });
    expect(old.statusCode).toBe(400);
    const policy = await post({
      query: QUERY,
      arguments: [{ head: { vars: ['city'] }, results: { bindings: [] }, whenEmpty: 'require' }],
    });
    expect(policy.statusCode).toBe(400);
  });

  it('reports an update as one, so a caller can pick the request shape', async () => {
    const response = await post({
      query: 'INSERT DATA { <http://e/s> <http://e/p> <http://e/o> }',
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { operation: string }).operation).toBe('update');
  });

  it('answers 400 for a query it cannot parse', async () => {
    const response = await post({ query: 'SELECT ?s WHERE {' });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toBeTruthy();
  });

  it('answers 400 when the arguments do not fit the query', async () => {
    const response = await post({
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      arguments: [
        {
          head: { vars: ['nosuchvar'] },
          results: { bindings: [{ nosuchvar: { type: 'uri', value: 'http://example.org/x' } }] },
        },
      ],
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a body naming a backend, because it does not execute', async () => {
    // `additionalProperties: false` is the statement that this is not /sparql.
    const response = await post({
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      backendId: 'urn:sqlib:backend:whatever',
    });
    expect(response.statusCode).toBe(400);
  });
});
