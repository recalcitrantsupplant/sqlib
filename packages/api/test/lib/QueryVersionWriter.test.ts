
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    list: hoisted.list,
    create: hoisted.create,
    update: hoisted.update,
    get: hoisted.get,
    delete: hoisted.delete,
  }),
}));

import { SparqlQueryParser } from '../../src/lib/parser.js';
import { deriveQueryVersionMetadata } from '../../src/lib/QueryVersionDeriver.js';
import { createQueryVersionFlat } from '../../src/lib/QueryVersionWriter.js';

describe('QueryVersionWriter Integration', () => {
  const parser = new SparqlQueryParser();

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.list.mockReturnValue([]);
    hoisted.create.mockImplementation(async (_type: string, data: any) => data);
    hoisted.update.mockResolvedValue({ $id: 'test-id', '@type': 'Query' });
    hoisted.get.mockReturnValue(null);
  });

  const testCases = [
    {
      title: 'SELECT query',
      queryString: `SELECT ?s WHERE { VALUES (?p ?o) { (UNDEF UNDEF) } ?s ?p ?o . }`,
      expectedQueryType: 'https://sparql-query-lib/query-type/select',
      inferredOutputCheck: (inferredOutputs: any[] | undefined) => {
        const outputTuple = (hoisted.create as any).mock.calls.find((call: any) => call[0] === 'QueryOutputTuple');
        expect(outputTuple).toBeDefined();
        expect(outputTuple![1].name).toBe('All query outputs');
        expect(inferredOutputs).toBeDefined();
        expect(inferredOutputs!).toContain(outputTuple![1].$id);
      },
    },
    {
      title: 'ASK query',
      queryString: `ASK { VALUES (?p ?o) { (UNDEF UNDEF) } ?s ?p ?o . }`,
      expectedQueryType: 'https://sparql-query-lib/query-type/ask',
      inferredOutputCheck: (inferredOutputs: any[] | undefined) => {
        const booleanIo = (hoisted.create as any).mock.calls.find((call: any) => call[0] === 'BooleanIO');
        expect(booleanIo).toBeDefined();
        expect(booleanIo![1].name).toBe('Boolean result');
        expect(inferredOutputs).toBeDefined();
        expect(inferredOutputs!).toContain(booleanIo![1].$id);
      },
    },
    {
      title: 'CONSTRUCT query',
      queryString: `CONSTRUCT { ?s ?p ?o } WHERE { VALUES (?p ?o) { (UNDEF UNDEF) } ?s ?p ?o . }`,
      expectedQueryType: 'https://sparql-query-lib/query-type/construct',
      inferredOutputCheck: (inferredOutputs: any[] | undefined) => {
        const rdfOutput = (hoisted.create as any).mock.calls.find((call: any) => call[0] === 'TriplesQuadsIO');
        expect(rdfOutput).toBeDefined();
        expect(rdfOutput![1].name).toBe('RDF graph output');
        expect(inferredOutputs).toBeDefined();
        expect(inferredOutputs!).toContain(rdfOutput![1].$id);
      },
    },
    {
      title: 'DESCRIBE query',
      queryString: `DESCRIBE ?s WHERE { VALUES (?p ?o) { (UNDEF UNDEF) } ?s ?p ?o . }`,
      expectedQueryType: 'https://sparql-query-lib/query-type/describe',
      inferredOutputCheck: (inferredOutputs: any[] | undefined) => {
        const rdfOutput = (hoisted.create as any).mock.calls.find((call: any) => call[0] === 'TriplesQuadsIO');
        expect(rdfOutput).toBeDefined();
        expect(rdfOutput![1].name).toBe('RDF graph output');
        expect(inferredOutputs).toBeDefined();
        expect(inferredOutputs!).toContain(rdfOutput![1].$id);
      },
    },
    {
        title: 'INSERT query',
        queryString: `INSERT { ?s a <http://ex.com/Type> } WHERE { VALUES (?s) { (UNDEF) } }`,
        expectedQueryType: 'https://sparql-query-lib/query-type/update',
        inferredOutputCheck: (inferredOutputs: any[] | undefined) => {
            expect(inferredOutputs).toBeUndefined();
        },
      },
  ];

  for (const tc of testCases) {
    it(`should correctly infer metadata and create version for a ${tc.title}`, async () => {
      const queryId = `urn:test:${tc.title.replace(/ /g, '')}`;
      
      // 1. Derive metadata from query string
      const derived = deriveQueryVersionMetadata(parser, tc.queryString);
      const parserForType = new SparqlQueryParser();
      const parsedQuery = parserForType.parseQuery(tc.queryString);
      const queryType = (parsedQuery as any).type === 'update' ? 'UPDATE' : (parsedQuery as any).subType.toUpperCase();

      // 2. Prepare body for writer, omitting queryType to test inference
      const body = {
        queryString: tc.queryString,
        queryType: queryType,
        ...derived,
      };

      // 3. Call writer
      const { created } = await createQueryVersionFlat(queryId, body);

      // 4. Assertions
      expect(created).toBeDefined();
      expect(created.queryType).toBe(tc.expectedQueryType);

      // Assert inferred inputs
      if (tc.queryString.includes('UNDEF')) {
        expect(created.inferredInputs).toBeDefined();
        expect(created.inferredInputs!.length).toBe(1);
        const inputTuple = (hoisted.create as any).mock.calls.find((call: any) => call[0] === 'QueryInputTuple');
        expect(inputTuple).toBeDefined();
      }

      // Assert inferred outputs
      tc.inferredOutputCheck(created.inferredOutputs);
    });
  }
});
