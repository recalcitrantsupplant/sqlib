import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 17: a constant parameter (`VALUES ?000level { UNDEF }`) and a value
 * pattern on its slot.
 *
 * The run gets exactly one value. sqlib keeps the filled VALUES row and also
 * writes the value into the triple pattern, which is what an engine that needs
 * a constant at plan time (QLever text search) reads. The author's value
 * pattern, saved through `inputPolicies`, refuses a value before anything runs.
 * See `docs/proposals/constant-substitution.md`.
 */
describe('a constant parameter on a query slot', () => {
  let context: ScenarioTestContext;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('constant-parameter');
    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Constant Backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'Constant Library');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  const levelQuery = `
    PREFIX ex: <http://example.org/>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>

    SELECT ?name ?000level WHERE {
      VALUES ?000level { UNDEF }
      ?p ex:experienceLevel ?000level ;
         foaf:name ?name .
    }
    ORDER BY ?name
  `;

  const createQuery = async (name: string) => {
    const query = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name, isPartOf: [context.libraryId], defaultBackend: context.backendId },
    });
    expect(query.statusCode).toBe(201);
    return query.json().id as string;
  };

  const saveVersion = (queryId: string, queryString: string, extra: Record<string, unknown> = {}) =>
    context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(queryId)}/versions`,
      payload: { queryVersion: { queryString, queryType: QueryTypeIri.select }, ...extra },
    });

  const execute = (targetId: string, payload: Record<string, unknown> = {}) =>
    context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'application/sparql-results+json' },
      payload: { targetId, backendId: context.backendId, ...payload },
    });

  const level = (value: string) => ({
    head: { vars: ['000level'] },
    results: { bindings: [{ '000level': { type: 'literal', value } }] },
  });

  it('detects the constant, and runs it with one value', async () => {
    const detected = await context.app.inject({ method: 'POST', url: '/detect-inputs', payload: { query: levelQuery } });
    expect(detected.statusCode).toBe(200);
    expect(detected.json()).toMatchObject({
      valuesInputs: [['000level']],
      constantInputs: ['000level'],
      constantWarnings: [],
    });

    const queryId = await createQuery('Names by level');
    expect((await saveVersion(queryId, levelQuery)).statusCode).toBe(201);

    const run = await execute(queryId, { arguments: [level('senior')] });
    expect(run.statusCode).toBe(200);
    const rows = run.json().results.bindings as Array<{ name: { value: string }; '000level': { value: string } }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.find((row) => row.name.value === 'Alice Johnson')?.['000level'].value).toBe('senior');
  }, 20000);

  it('refuses a run that omits the constant', async () => {
    const queryId = await createQuery('Names by level, omitted');
    await saveVersion(queryId, levelQuery);
    const run = await execute(queryId);
    expect(run.statusCode).toBe(400);
    expect(run.json().error).toContain('?000level needs exactly one value');
  }, 20000);

  it('saves a value pattern, enforces it, and carries it to the next version', async () => {
    const queryId = await createQuery('Names by level, patterned');
    const saved = await saveVersion(queryId, levelQuery, {
      inputPolicies: [{ vars: ['000level'], valuePattern: '^[a-z]{4,}$' }],
    });
    expect(saved.statusCode).toBe(201);
    expect((saved.json() as { inputTuples: Array<{ valuePattern?: string }> }).inputTuples[0].valuePattern).toBe('^[a-z]{4,}$');

    const refused = await execute(queryId, { arguments: [level('jr')] });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toContain('does not match the pattern ^[a-z]{4,}$');
    expect((await execute(queryId, { arguments: [level('senior')] })).statusCode).toBe(200);

    await saveVersion(queryId, `${levelQuery}\nLIMIT 10`);
    expect((await execute(queryId, { arguments: [level('jr')] })).statusCode).toBe(400);
  }, 20000);

  it('refuses at save a value pattern that does not compile', async () => {
    const queryId = await createQuery('Names by level, bad pattern');
    const saved = await saveVersion(queryId, levelQuery, {
      inputPolicies: [{ vars: ['000level'], valuePattern: '([a-z' }],
    });
    expect(saved.statusCode).toBe(400);
    expect(saved.json().error).toContain('is not a valid regular expression');
  }, 20000);

  it('refuses at save a constant beside other variables in one VALUES clause', async () => {
    const queryId = await createQuery('Names by level, multi');
    const saved = await saveVersion(queryId, levelQuery.replace(
      'VALUES ?000level { UNDEF }',
      'VALUES (?000level ?p) { (UNDEF UNDEF) }',
    ));
    expect(saved.statusCode).toBe(400);
    expect(saved.json().error).toContain('must be the only variable of its VALUES clause');
  }, 20000);
});
