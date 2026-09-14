import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import detectionRoutes from '../../src/routes/detection.js';
import { setupValidator } from '../../src/lib/validator-setup.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app); // Configure AJV with Draft 2020-12 support
  await app.register(detectionRoutes);
  await app.ready();
  return app;
}

describe('POST /format', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should format a simple SPARQL query', async () => {
    const messyQuery = `SELECT   ?subject    ?predicate   ?object
    WHERE {
        ?subject   ?predicate   ?object .
    }`;

    const response = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: messyQuery },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('formatted');
    expect(body.formatted).toContain('SELECT');
    expect(body.formatted).toContain('?subject');
    expect(body.formatted).toContain('?predicate');
    expect(body.formatted).toContain('?object');
    expect(body.formatted).toContain('WHERE');

    // Formatting is not guaranteed to reduce size; just ensure output is non-empty
    expect(body.formatted.length).toBeGreaterThan(0);
  });

  it('formats SPARQL through Traqula instead of the SRL validating passthrough', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: 'construct \n\n\nwhere {?s ?p ?o} limit 10' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      formatted: 'CONSTRUCT {\n  ?s ?p ?o .\n}\nWHERE {\n  ?s ?p ?o .\n}\nLIMIT 10',
    });
  });

  it('should format a query with prefixes', async () => {
    const queryWithPrefixes = `PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX dc: <http://purl.org/dc/elements/1.1/>

SELECT ?title ?name WHERE {
  ?book dc:title ?title .
  ?book dc:creator ?author .
  ?author foaf:name ?name .
}`;

    const response = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: queryWithPrefixes },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.formatted).toContain('PREFIX foaf:');
    expect(body.formatted).toContain('PREFIX dc:');
    expect(body.formatted).toContain('SELECT');
  });

  it('should preserve declared prefixes (format-only)', async () => {
    const queryWithUnusedPrefix = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>

SELECT ?name WHERE {
  ?person foaf:name ?name .
}`;

    const response = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: queryWithUnusedPrefix },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.formatted).toContain('PREFIX foaf:');
    // Behaviour change vs sparqljs: the Traqula generator preserves all declared
    // prefixes (it does not prune unused ones during formatting).
    expect(body.formatted).toContain('PREFIX rdf:');
  });

  it('should format RULE syntax (no translation)', async () => {
    const ruleCode = `PREFIX : <http://example.org/>
RULE {
  ?x a :Inferred .
} WHERE {
  ?x a :Source .
}`;

    const response = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: ruleCode },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.formatted).toContain('RULE');
    expect(body.formatted).toContain('WHERE');
    expect(body.formatted).not.toContain('INSERT'); // Formatting does not translate RULE → SPARQL UPDATE
  });

  it('should format DATA syntax (no translation)', async () => {
    const dataCode = `DATA {
  <http://example.org/book1> <http://purl.org/dc/elements/1.1/title> "Example Book" .
}`;

    const response = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: dataCode },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.formatted).toContain('DATA');
    expect(body.formatted).not.toContain('INSERT DATA'); // Formatting does not translate DATA → INSERT DATA
  });

  it('should return 400 for invalid SPARQL', async () => {
    const invalidQuery = 'SELECT * INVALID SYNTAX';

    const response = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: invalidQuery },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

  it('should return 400 for empty code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: '' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error');
  });

  it('should be idempotent - formatting twice should produce same result', async () => {
    const query = `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`;

    const response1 = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: query },
    });

    expect(response1.statusCode).toBe(200);
    const body1 = JSON.parse(response1.body);

    // Format the already-formatted result
    const response2 = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: body1.formatted },
    });

    expect(response2.statusCode).toBe(200);
    const body2 = JSON.parse(response2.body);

    // Should be identical
    expect(body1.formatted).toBe(body2.formatted);
  });

  it('should handle UPDATE queries', async () => {
    const updateQuery = `PREFIX dc: <http://purl.org/dc/elements/1.1/>
DELETE DATA {
  <http://example/book1> dc:title "Old Title" .
}`;

    const response = await app.inject({
      method: 'POST',
      url: '/format',
      payload: { code: updateQuery },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.formatted).toContain('PREFIX dc:');
    expect(body.formatted).toContain('DELETE DATA');
  });
});
