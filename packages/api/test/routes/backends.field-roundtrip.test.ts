/**
 * Every field a backend create or update body may carry is stored, and reads
 * back the same on `GET /backends/:id`.
 *
 * `queryMethod` was dropped by both routes: the body passed validation, the
 * payload builders left it out, and the backend read back as the default POST.
 * This test runs the real repositories, so a field that the route forgets, or
 * stores in a form that the read cannot map back, fails here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../scenarios/fixtures/scenario-test-base-unmocked.js';
import { getEntityRepositories } from '../../src/lib/CacheCoordinatorProvider.js';
import { QueryMethodIri, type PersistedBackend } from '../../src/persistence/schemas/BackendSchema.js';

describe('backend fields round-trip through create and update', () => {
  let context: ScenarioTestContext;
  const id = 'urn:sqlib:backend:field-roundtrip';

  const getBackend = async () => {
    const response = await context.app.inject({ method: 'GET', url: `/backends/${encodeURIComponent(id)}` });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };

  const putBackend = async (payload: Record<string, unknown>) => {
    const response = await context.app.inject({
      method: 'PUT',
      url: `/backends/${encodeURIComponent(id)}`,
      payload,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('backend-field-roundtrip');
  });

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('stores every field of a create body', async () => {
    const created = await context.app.inject({
      method: 'POST',
      url: '/backends/',
      payload: {
        id,
        name: 'Round trip',
        description: 'First description',
        backendType: 'http',
        endpoint: 'http://localhost:3030/ds/sparql',
        authEnvKey: 'ROUND_TRIP_AUTH',
        queryMethod: 'get',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().queryMethod).toBe('get');

    const read = await getBackend();
    expect(read).toMatchObject({
      name: 'Round trip',
      description: 'First description',
      backendType: 'http',
      endpoint: 'http://localhost:3030/ds/sparql',
      authEnvKey: 'ROUND_TRIP_AUTH',
      queryMethod: 'get',
    });
    // The executor reads the stored IRI, so the stored form matters as well.
    const stored = getEntityRepositories().Backend.get(id) as PersistedBackend;
    expect(stored.queryMethod).toBe(QueryMethodIri.get);
  });

  it('stores every field of an update body', async () => {
    const updated = await putBackend({
      name: 'Round trip 2',
      description: 'Second description',
      endpoint: 'http://localhost:3030/other/sparql',
      authEnvKey: 'OTHER_AUTH',
      queryMethod: 'post',
    });
    expect(updated.queryMethod).toBe('post');

    const read = await getBackend();
    expect(read).toMatchObject({
      name: 'Round trip 2',
      description: 'Second description',
      endpoint: 'http://localhost:3030/other/sparql',
      authEnvKey: 'OTHER_AUTH',
      queryMethod: 'post',
    });
    expect((getEntityRepositories().Backend.get(id) as PersistedBackend).queryMethod).toBe(QueryMethodIri.post);
  });

  it('changes queryMethod alone, and clears it with null', async () => {
    expect((await putBackend({ queryMethod: 'get' })).queryMethod).toBe('get');
    expect((await getBackend()).queryMethod).toBe('get');

    await putBackend({ queryMethod: null });
    const read = await getBackend();
    expect(read.queryMethod ?? null).toBeNull();
    expect(read.name).toBe('Round trip 2');
  });

  it('keeps queryMethod when an update leaves it out', async () => {
    await putBackend({ queryMethod: 'get' });
    await putBackend({ description: 'Third description' });
    const read = await getBackend();
    expect(read.queryMethod).toBe('get');
    expect(read.description).toBe('Third description');
  });
});
