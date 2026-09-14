import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

// Hoist mock fns for use in vi.mock factory
const hoisted = vi.hoisted(() => ({
  mockDetectInputs: vi.fn().mockReturnValue({ valuesInputs: [], limitParameters: [], offsetParameters: [], correlatedExistsInputs: [] }),
  mockDetectOutputs: vi.fn().mockReturnValue(['s', 'o']),
  mockParseQuery: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/lib/parser.js', () => ({
  SparqlQueryParser: class {
    detectInputs = hoisted.mockDetectInputs;
    detectQueryOutputs = hoisted.mockDetectOutputs;
    parseQuery = hoisted.mockParseQuery;
  }
} as any));

import detectionRoutes from '../../src/routes/detection.js';

describe('Detection Routes (root)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    // Don't add schemas here - the detection routes have inline schemas with $id
    // that Fastify will automatically register
    await app.register(detectionRoutes, { prefix: '' });
    await app.ready();
  });

  beforeEach(() => {
    hoisted.mockDetectInputs.mockClear();
    hoisted.mockDetectOutputs.mockClear();
    hoisted.mockParseQuery.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /detect-inputs returns detection object', async () => {
    const res = await app.inject({ method: 'POST', url: '/detect-inputs', payload: { query: 'SELECT * WHERE { ?s ?p ?o }' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valuesInputs: [], limitParameters: [], offsetParameters: [], correlatedExistsInputs: [] });
    expect(hoisted.mockDetectInputs).toHaveBeenCalledTimes(1);
  });

  it('GET /detect-inputs returns detection object', async () => {
    const res = await app.inject({ method: 'GET', url: '/detect-inputs?query=SELECT%20*%20WHERE%20%7B%20%3Fs%20%3Fp%20%3Fo%20%7D' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valuesInputs: [], limitParameters: [], offsetParameters: [], correlatedExistsInputs: [] });
    expect(hoisted.mockDetectInputs).toHaveBeenCalledTimes(1);
  });

  it('POST /detect-outputs returns output vars', async () => {
    const res = await app.inject({ method: 'POST', url: '/detect-outputs', payload: { query: 'SELECT ?s ?o WHERE { ?s ?p ?o }' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(['s', 'o']);
    expect(hoisted.mockDetectOutputs).toHaveBeenCalledTimes(1);
  });

  it('GET /detect-outputs returns output vars', async () => {
    const res = await app.inject({ method: 'GET', url: '/detect-outputs?query=SELECT%20?s%20?o%20WHERE%20%7B%20?s%20?p%20?o%20%7D' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(['s', 'o']);
    expect(hoisted.mockDetectOutputs).toHaveBeenCalledTimes(1);
  });

  it('POST /validate returns valid true when parse succeeds', async () => {
    hoisted.mockParseQuery.mockReturnValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/validate',
      payload: { query: 'SELECT * WHERE { ?s ?p ?o }' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true });
    expect(hoisted.mockParseQuery).toHaveBeenCalledTimes(1);
  });

  it('POST /validate returns 400 with message on parse error', async () => {
    hoisted.mockParseQuery.mockImplementationOnce(() => {
      throw new Error('Parse failed');
    });

    const res = await app.inject({
      method: 'POST',
      url: '/validate',
      payload: { query: 'INVALID QUERY' }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ valid: false, error: 'Parse failed' });
    expect(hoisted.mockParseQuery).toHaveBeenCalledTimes(1);
  });

  // Regression guard for a divergence Phase C1 fixed (#65). The POST body
  // schema carried `minLength: 1` on `query`; the hand-written GET querystring
  // schema did not. `?query=` therefore passed ajv, and the handler's zod parse
  // — which did have the constraint — threw, producing a 500 for a request the
  // published contract declared valid. Both now use one constraint.
  it.each(['/detect-inputs', '/detect-outputs'])(
    'GET %s with an empty query is rejected at the gate, not by a throw',
    async (path) => {
      const res = await app.inject({ method: 'GET', url: `${path}?query=` });

      expect(res.statusCode).toBe(400);
      expect(res.statusCode).not.toBe(500);
    }
  );
});
