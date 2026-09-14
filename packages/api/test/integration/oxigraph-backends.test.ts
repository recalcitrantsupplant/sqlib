import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { OxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';
import { SparqlSelectJsonOutput } from '../../src/server/ISparqlExecutor.js';
import type { ExecutionGraph, ResolvedNode, ResolvedEdge } from '../../src/lib/orchestration/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Type guard to ensure result is SparqlSelectJsonOutput and not string
function assertIsSelectJson(result: SparqlSelectJsonOutput | string): asserts result is SparqlSelectJsonOutput {
    if (typeof result === 'string') {
        throw new Error('Expected SparqlSelectJsonOutput but got string');
    }
}

/**
 * Integration tests for Oxigraph backends.
 *
 * NOTE: Oxigraph JS only supports in-memory stores. "Durable" stores are
 * serialized to .nq files on shutdown and restored on startup.
 * This is NOT true disk-backed persistence like RocksDB.
 */
describe('Oxigraph Backends Integration', () => {
  let storeManager: OxigraphStoreManager;
  let executorFactory: ExecutorFactory;
  let executionEngine: ExecutionEngine;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `oxigraph-integration-test-${Date.now()}`);
    storeManager = new OxigraphStoreManager(tempDir);
    await storeManager.initialize();

    executorFactory = new ExecutorFactory();
    executionEngine = new ExecutionEngine(executorFactory);
  });

  afterEach(async () => {
    await storeManager.shutdown();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('durable oxigraph backend', () => {
    it('should execute queries against durable store', async () => {
      // Create a durable store with test data (in-memory, serialized on shutdown)
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await storeManager.createDurableStore('test-backend', config);
      
      // Load test data
      const testData = `
        @prefix ex: <http://example.org/> .
        ex:person1 ex:name "Alice" ;
                   ex:age 30 .
        ex:person2 ex:name "Bob" ;
                   ex:age 25 .
        ex:person3 ex:name "Charlie" ;
                   ex:age 35 .
      `;
      
      await storeManager.loadDataFromString(store, testData, 'turtle');
      expect(store.size).toBe(6); // 3 people × 2 properties each

      // Create executor and test queries
      const executor = new OxigraphSparqlExecutor(store);

      // Test SELECT query
      const selectQuery = `
        PREFIX ex: <http://example.org/>
        SELECT ?name ?age WHERE {
          ?person ex:name ?name ;
                  ex:age ?age .
        } ORDER BY ?age
      `;

      const selectResults = await executor.selectQueryParsed(selectQuery);
      assertIsSelectJson(selectResults.result);
      expect(selectResults.result.results.bindings).toHaveLength(3);
      expect(selectResults.result.results.bindings[0].name.value).toBe('Bob');
      expect(selectResults.result.results.bindings[0].age.value).toBe('25');

      // Test ASK query
      const askQuery = `
        PREFIX ex: <http://example.org/>
        ASK { ?person ex:name "Alice" }
      `;

      const { result: askResult } = await executor.askQuery(askQuery);
      expect(askResult).toBe(true);

      // Test CONSTRUCT query
      const constructQuery = `
        PREFIX ex: <http://example.org/>
        CONSTRUCT { ?person a ex:Person ; ex:displayName ?name }
        WHERE { ?person ex:name ?name }
      `;

      const { result: constructResult } = await executor.constructQueryParsed(constructQuery);
      expect(constructResult).toContain('<http://example.org/Person>');
      expect(constructResult).toContain('<http://example.org/displayName>');
      expect(constructResult).toContain('"Alice"');
    });

    it('should handle UPDATE queries on durable store', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await storeManager.createDurableStore('test-backend', config);
      const executor = new OxigraphSparqlExecutor(store);

      // Insert data via UPDATE
      const insertQuery = `
        PREFIX ex: <http://example.org/>
        INSERT DATA {
          ex:person1 ex:name "Alice" ;
                     ex:age 30 .
        }
      `;

      await executor.update(insertQuery);
      expect(store.size).toBe(2);

      // Verify data was inserted
      const selectQuery = `
        PREFIX ex: <http://example.org/>
        SELECT ?name WHERE { ex:person1 ex:name ?name }
      `;

      const { result } = await executor.selectQueryParsed(selectQuery);
      assertIsSelectJson(result);
      expect(result.results.bindings).toHaveLength(1);
      expect(result.results.bindings[0].name.value).toBe('Alice');

      // Update existing data
      const updateQuery = `
        PREFIX ex: <http://example.org/>
        DELETE { ex:person1 ex:age ?oldAge }
        INSERT { ex:person1 ex:age 31 }
        WHERE { ex:person1 ex:age ?oldAge }
      `;

      await executor.update(updateQuery);
      
      // Verify update
      const verifyQuery = `
        PREFIX ex: <http://example.org/>
        SELECT ?age WHERE { ex:person1 ex:age ?age }
      `;

      const { result: verifyResult } = await executor.selectQueryParsed(verifyQuery);
      assertIsSelectJson(verifyResult);
      expect(verifyResult.results.bindings[0].age.value).toBe('31');
    });
  });

  describe('ephemeral oxigraph backend in query groups', () => {
    it('should execute query group with ephemeral stores', async () => {
      // Create a mock execution graph with ephemeral store
      const nodes = new Map<string, ResolvedNode>();
      
      // First node: source data (would normally be from another backend)
      nodes.set('source-node', {
        id: 'source-node',
        raw: {},
        backendId: 'dummy',
        queryVersionId: 'dummy',
        queryVersion: {} as any,
        queryString: `
          SELECT ?name ?age WHERE {
            VALUES (?name ?age) {
              ("Alice" 30)
              ("Bob" 25)
              ("Charlie" 35)
            }
          }
        `,
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: ['output-tuple-1']
      });

      // Second node: transform data using ephemeral store
      nodes.set('transform-node', {
        id: 'transform-node',
        raw: {},
        backendId: 'dummy',
        queryVersionId: 'dummy',
        queryVersion: {} as any,
        queryString: `
          SELECT ?name WHERE {
            ?result <https://sparql-query-lib/var/name> ?name ;
                    <https://sparql-query-lib/var/age> ?age .
            FILTER(?age >= 30)
          } ORDER BY ?name
        `,
        queryType: QueryTypeIri.select,
        inputTupleIds: ['input-tuple-1'],
        outputTupleIds: [],
        backendConfig: {
          type: 'ephemeral-oxigraph',
          storeId: 'temp-transform-store'
        }
      });

      const edges: ResolvedEdge[] = [{
        id: 'edge-1',
        raw: {} as any,
        sourceNodeId: 'source-node',
        targetNodeId: 'transform-node',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'output-tuple-1',
        targetInputId: 'input-tuple-1'
      }];

      const graph: ExecutionGraph = {
        groupVersion: {} as any,
        nodes,
        edges,
        incomingEdges: new Map([['transform-node', [edges[0]]]]),
        outgoingEdges: new Map([['source-node', [edges[0]]]]),
        startNodeIds: ['source-node'],
        endNodeIds: ['transform-node']
      };

      // Mock the execution engine to handle the ephemeral store workflow
      // This is a simplified test that verifies the core functionality
      
      // Execute source node manually
      const sourceExecutor = new OxigraphSparqlExecutor(new (await import('oxigraph')).Store());
      const { result: sourceResults } = await sourceExecutor.selectQueryParsed(nodes.get('source-node')!.queryString!);
      assertIsSelectJson(sourceResults);
      
      expect(sourceResults.results.bindings).toHaveLength(3);
      
      // Create ephemeral store and populate it with source results
      const ephemeralStore = storeManager.createEphemeralStore('temp-transform-store');
      
      // Convert results to RDF triples (simulating ExecutionEngine.populateEphemeralStore)
      const triples: string[] = [];
      for (let i = 0; i < sourceResults.results.bindings.length; i++) {
        const binding = sourceResults.results.bindings[i];
        const subjectId = `_:result${i}`;
        
        triples.push(`${subjectId} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://sparql-query-lib/QueryResult> .`);
        triples.push(`${subjectId} <https://sparql-query-lib/resultIndex> "${i}"^^<http://www.w3.org/2001/XMLSchema#integer> .`);
        
        if (binding.name) {
          triples.push(`${subjectId} <https://sparql-query-lib/var/name> "${binding.name.value}" .`);
        }
        if (binding.age) {
          triples.push(`${subjectId} <https://sparql-query-lib/var/age> "${binding.age.value}"^^<http://www.w3.org/2001/XMLSchema#integer> .`);
        }
      }
      
      const turtleData = triples.join('\n');
      await storeManager.loadDataFromString(ephemeralStore, turtleData, 'ntriples');
      
      // Execute transform node
      const transformExecutor = new OxigraphSparqlExecutor(ephemeralStore);
      const { result: transformResults } = await transformExecutor.selectQueryParsed(nodes.get('transform-node')!.queryString!);
      
      assertIsSelectJson(transformResults);
      // Should only return people aged 30 or older (Alice and Charlie)
      expect(transformResults.results.bindings).toHaveLength(2);
      const names = transformResults.results.bindings.map(b => b.name.value).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
      
      // Cleanup ephemeral store
      storeManager.destroyEphemeralStore('temp-transform-store');
      expect(storeManager.getEphemeralStore('temp-transform-store')).toBeNull();
    });
  });

  describe('data loading scenarios', () => {
    it('should load data from different formats', async () => {
      const formats = [
        {
          name: 'turtle',
          data: `
            @prefix ex: <http://example.org/> .
            ex:subject ex:predicate "value" .
          `,
          format: 'turtle'
        },
        {
          name: 'n-triples',
          data: '<http://example.org/subject> <http://example.org/predicate> "value" .',
          format: 'ntriples'
        },
        {
          name: 'json-ld',
          data: JSON.stringify({
            '@context': { 'ex': 'http://example.org/' },
            '@id': 'ex:subject',
            'ex:predicate': 'value'
          }),
          format: 'jsonld'
        }
      ];

      for (const { name, data, format } of formats) {
        const config = {
          storeType: 'durable' as const,
          loadMethod: 'none' as const
        };

        const store = await storeManager.createDurableStore(`backend-${name}`, config);
        await storeManager.loadDataFromString(store, data, format);
        
        expect(store.size).toBeGreaterThan(0);
        
        // Verify data was loaded correctly
        const executor = new OxigraphSparqlExecutor(store);
        const { result: results } = await executor.selectQueryParsed('SELECT * WHERE { ?s ?p ?o }');
        assertIsSelectJson(results);
        expect(results.results.bindings.length).toBeGreaterThan(0);
      }
    });

    it('should handle remote SPARQL import', async () => {
      // This would normally import from a real SPARQL endpoint
      // For testing, we'll simulate the process

      const config = {
        storeType: 'durable' as const,
        loadMethod: 'remote-sparql' as const,
        sourceConfig: {
          remoteEndpoint: 'http://example.org/sparql',
          importQuery: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 10'
        }
      };

      // Mock the import process (normally handled by OxigraphStoreManager)
      const store = await storeManager.createDurableStore('remote-backend', {
        storeType: 'durable',
        loadMethod: 'none'
      });

      // Simulate imported data
      const importedData = `
        <http://example.org/imported1> <http://example.org/prop> "value1" .
        <http://example.org/imported2> <http://example.org/prop> "value2" .
      `;
      
      await storeManager.loadDataFromString(store, importedData, 'ntriples');
      expect(store.size).toBe(2);
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle malformed SPARQL queries', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await storeManager.createDurableStore('test-backend', config);
      const executor = new OxigraphSparqlExecutor(store);

      const malformedQuery = 'SELECT * WHERE { INVALID SPARQL }';
      
      await expect(executor.selectQueryParsed(malformedQuery)).rejects.toThrow();
    });

    it('should handle empty query results', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await storeManager.createDurableStore('test-backend', config);
      const executor = new OxigraphSparqlExecutor(store);

      const emptyQuery = 'SELECT ?p ?o WHERE { <http://nonexistent> ?p ?o }';
      const { result: results } = await executor.selectQueryParsed(emptyQuery);
      assertIsSelectJson(results);

      expect(results.results.bindings).toHaveLength(0);
      // When there are no results, oxigraph doesn't return variable names
      expect(results.head.vars).toEqual([]);
    });

    it('should handle store cleanup on execution failure', async () => {
      // Test that ephemeral stores are cleaned up even if execution fails
      const storeId = 'cleanup-test-store';
      
      // Create ephemeral store
      const store = storeManager.createEphemeralStore(storeId);
      expect(storeManager.getEphemeralStore(storeId)).toBeDefined();
      
      // Simulate execution failure scenario
      try {
        const executor = new OxigraphSparqlExecutor(store);
        await executor.selectQueryParsed('INVALID SPARQL QUERY');
      } catch (error) {
        // Expected error
      } finally {
        // Cleanup should still happen
        storeManager.destroyEphemeralStore(storeId);
      }
      
      expect(storeManager.getEphemeralStore(storeId)).toBeNull();
    });
  });

  describe('performance and memory management', () => {
    it('should track store statistics accurately', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await storeManager.createDurableStore('stats-backend', config);
      
      let stats = storeManager.getStoreStats('stats-backend');
      expect(stats!.tripleCount).toBe(0);
      expect(stats!.memoryUsage).toBe(0);
      
      // Add data and check stats update
      const testData = `
        @prefix ex: <http://example.org/> .
        ex:s1 ex:p1 "v1" .
        ex:s2 ex:p2 "v2" .
        ex:s3 ex:p3 "v3" .
      `;
      
      await storeManager.loadDataFromString(store, testData, 'turtle');
      
      stats = storeManager.getStoreStats('stats-backend');
      expect(stats!.tripleCount).toBe(3);
      expect(stats!.memoryUsage).toBeGreaterThan(0);
    });

    it('should handle multiple concurrent ephemeral stores', () => {
      const storeIds = ['concurrent1', 'concurrent2', 'concurrent3'];
      const stores = storeIds.map(id => storeManager.createEphemeralStore(id));
      
      // Verify all stores exist
      storeIds.forEach(id => {
        expect(storeManager.getEphemeralStore(id)).toBeDefined();
      });
      
      // Verify store isolation
      stores.forEach((store, index) => {
        expect(store).not.toBe(stores[(index + 1) % stores.length]);
      });
      
      // Cleanup
      storeIds.forEach(id => storeManager.destroyEphemeralStore(id));
      
      // Verify cleanup
      storeIds.forEach(id => {
        expect(storeManager.getEphemeralStore(id)).toBeNull();
      });
    });
  });
});