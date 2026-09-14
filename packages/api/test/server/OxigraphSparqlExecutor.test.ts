import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';
import { SparqlSelectJsonOutput } from '../../src/server/ISparqlExecutor.js';
import * as oxigraph from 'oxigraph';
import { Readable } from 'stream';

// Type guard to ensure result is SparqlSelectJsonOutput and not string
function assertIsSelectJson(result: SparqlSelectJsonOutput | string): asserts result is SparqlSelectJsonOutput {
    if (typeof result === 'string') {
        throw new Error('Expected SparqlSelectJsonOutput but got string');
    }
}

describe('OxigraphSparqlExecutor', () => {
    let executor: OxigraphSparqlExecutor;
    let store: oxigraph.Store;

    beforeEach(() => {
        store = new oxigraph.Store();
        executor = new OxigraphSparqlExecutor(store);
        
        // Add some test data
        const person1 = oxigraph.namedNode('http://example.org/person1');
        const person2 = oxigraph.namedNode('http://example.org/person2');
        const name = oxigraph.namedNode('http://schema.org/name');
        const age = oxigraph.namedNode('http://schema.org/age');
        const knows = oxigraph.namedNode('http://schema.org/knows');
        const blankNode = oxigraph.blankNode('b1');

        store.add(oxigraph.quad(person1, name, oxigraph.literal('John Doe', 'en')));
        store.add(oxigraph.quad(person1, age, oxigraph.literal('30', oxigraph.namedNode('http://www.w3.org/2001/XMLSchema#integer'))));
        store.add(oxigraph.quad(person2, name, oxigraph.literal('Jane Smith')));
        store.add(oxigraph.quad(person1, knows, blankNode));
        store.add(oxigraph.quad(blankNode, name, oxigraph.literal('A Blank Node Entity')));
    });

    describe('constructor', () => {
        it('should initialize a new store if one is not provided', () => {
            const newExecutor = new OxigraphSparqlExecutor();
            expect(newExecutor).toBeInstanceOf(OxigraphSparqlExecutor);
        });
    });

    describe('selectQueryParsed', () => {
        it('should execute SELECT query and return SPARQL JSON format', async () => {
            const query = 'SELECT ?person ?name WHERE { ?person <http://schema.org/name> ?name } ORDER BY ?name';
            const { result } = await executor.selectQueryParsed(query);
            assertIsSelectJson(result);

            expect(result.head.vars).toEqual(['person', 'name']);
            expect(result.results.bindings).toHaveLength(3);
            expect(result.results.bindings[0].name.value).toBe('A Blank Node Entity');
            expect(result.results.bindings[1].name.value).toBe('Jane Smith');
            expect(result.results.bindings[2].name.value).toBe('John Doe');
        });

        it('should handle queries with typed literals', async () => {
            const query = 'SELECT ?person ?age WHERE { ?person <http://schema.org/age> ?age }';
            const { result } = await executor.selectQueryParsed(query);
            assertIsSelectJson(result);

            expect(result.results.bindings).toHaveLength(1);
            const binding = result.results.bindings[0];
            expect(binding.age).toEqual({ type: 'literal', value: '30', datatype: 'http://www.w3.org/2001/XMLSchema#integer' });
        });

        it('should handle queries with language-tagged literals', async () => {
            const query = 'SELECT ?name WHERE { <http://example.org/person1> <http://schema.org/name> ?name }';
            const { result } = await executor.selectQueryParsed(query);
            assertIsSelectJson(result);
            const binding = result.results.bindings[0];
            expect(binding.name).toEqual({ type: 'literal', value: 'John Doe', 'xml:lang': 'en' });
        });

        it('should handle queries that return blank nodes', async () => {
            const query = 'SELECT ?bnode WHERE { ?s <http://schema.org/knows> ?bnode }';
            const { result } = await executor.selectQueryParsed(query);
            assertIsSelectJson(result);
            const binding = result.results.bindings[0];
            expect(binding.bnode.type).toBe('bnode');
            expect(binding.bnode.value).toBe('b1');
        });

        it('should handle empty results', async () => {
            const query = 'SELECT * WHERE { ?s <http://example.org/nonexistent> ?o }';
            const { result } = await executor.selectQueryParsed(query);
            assertIsSelectJson(result);
            expect(result.results.bindings).toHaveLength(0);
        });

        it('should throw an error for invalid SELECT query', async () => {
            const invalidQuery = 'SELECT ?s WHERE { ?s ?p }'; // Invalid SPARQL
            await expect(executor.selectQueryParsed(invalidQuery)).rejects.toThrow();
        });

        it('should throw an error if query result is not a SELECT result', async () => {
            vi.spyOn(store, 'query').mockReturnValue(true); // Mock ASK result
            await expect(executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}')).rejects.toThrow('Expected array of Map objects from SELECT query, got: boolean');
        });
    });

    describe('constructQueryParsed', () => {
        it('should execute CONSTRUCT query and return N-Quads', async () => {
            const query = 'CONSTRUCT { ?person <http://example.org/hasName> ?name } WHERE { ?person <http://schema.org/name> ?name }';
            const { result } = await executor.constructQueryParsed(query);
            
            expect(typeof result).toBe('string');
            expect(result).toContain('<http://example.org/person1> <http://example.org/hasName> "John Doe"@en .');
            expect(result).toContain('<http://example.org/person2> <http://example.org/hasName> "Jane Smith" .');
        });

        it('should handle CONSTRUCT with blank nodes', async () => {
            const query = 'CONSTRUCT { ?s <http://schema.org/knows> ?bnode } WHERE { ?s <http://schema.org/knows> ?bnode }';
            const { result } = await executor.constructQueryParsed(query);
            expect(result).toContain('<http://example.org/person1> <http://schema.org/knows> _:b1 .');
        });

        it('should handle CONSTRUCT with typed literals', async () => {
            const query = 'CONSTRUCT { ?p <http://schema.org/age> ?a } WHERE { ?p <http://schema.org/age> ?a }';
            const { result } = await executor.constructQueryParsed(query);
            expect(result).toContain('<http://example.org/person1> <http://schema.org/age> "30"^^<http://www.w3.org/2001/XMLSchema#integer> .');
        });

        it('should throw an error for invalid CONSTRUCT query', async () => {
            const invalidQuery = 'CONSTRUCT { ?s ?p } WHERE { ?s ?p ?o }'; // Invalid SPARQL
            await expect(executor.constructQueryParsed(invalidQuery)).rejects.toThrow();
        });

        it('should throw an error if query result is not an array', async () => {
            vi.spyOn(store, 'query').mockReturnValue(true); // Mock non-array result
            await expect(executor.constructQueryParsed('CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}')).rejects.toThrow('Expected array result from CONSTRUCT query, got: boolean');
        });
    });

    describe('update', () => {
        it('should execute UPDATE query successfully', async () => {
            const updateQuery = 'INSERT DATA { <http://example.org/person3> <http://schema.org/name> "Bob Johnson" }';
            
            await expect(executor.update(updateQuery)).resolves.not.toThrow();
            
            const { result } = await executor.askQuery('ASK { <http://example.org/person3> ?p ?o }');
            expect(result).toBe(true);
        });

        it('should throw an error for invalid UPDATE query', async () => {
            const invalidQuery = 'INSERT { ?s ?p ?o }'; // Invalid SPARQL
            await expect(executor.update(invalidQuery)).rejects.toThrow();
        });
    });

    describe('askQuery', () => {
        it('should return true for a matching ASK query', async () => {
            const askQuery = 'ASK { ?person <http://schema.org/name> "John Doe"@en }';
            const { result } = await executor.askQuery(askQuery);
            expect(result).toBe(true);
        });

        it('should return false for a non-matching ASK query', async () => {
            const askQuery = 'ASK { ?person <http://schema.org/name> "Non Existent" }';
            const { result } = await executor.askQuery(askQuery);
            expect(result).toBe(false);
        });

        it('should throw an error for an invalid ASK query', async () => {
            const invalidQuery = 'ASK { ?s ?p }'; // Invalid SPARQL
            await expect(executor.askQuery(invalidQuery)).rejects.toThrow();
        });

        it('should throw an error if query result is not a boolean', async () => {
            vi.spyOn(store, 'query').mockReturnValue([]); // Mock non-boolean result
            try {
                await executor.askQuery('ASK {?s ?p ?o}');
                expect.fail('askQuery should have thrown');
            } catch (e: unknown) {
                expect((e as Error).message).toBe('SPARQL ASK query execution failed: Expected boolean result from ASK query, got: object');
            }
        });
    });

    describe('selectQueryStream', () => {
        it('should return a streaming response', async () => {
            const query = 'SELECT ?person ?name WHERE { ?person <http://schema.org/name> ?name }';
            const response = await executor.selectQueryStream(query);
            
            expect(response.statusCode).toBe(200);
            expect(response.headers).toHaveProperty('content-type', 'application/json');
            expect(response.body).toBeInstanceOf(Readable);

            const streamToString = (stream: Readable): Promise<string> => {
                const chunks: Buffer[] = [];
                return new Promise<string>((resolve, reject) => {
                    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk as any)));
                    stream.on('error', (err) => reject(err));
                    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                });
            };

            const body = await streamToString(response.body as Readable);
            const parsedBody = JSON.parse(body);
            expect(parsedBody.results.bindings).toHaveLength(3);
        });
    });

    describe('constructQueryStream', () => {
        it('should return a streaming response for CONSTRUCT', async () => {
            const query = 'CONSTRUCT { ?p <http://schema.org/age> ?a } WHERE { ?p <http://schema.org/age> ?a }';
            const response = await executor.constructQueryStream(query);
            
            expect(response.statusCode).toBe(200);
            expect(response.headers).toHaveProperty('content-type', 'application/n-quads');
            expect(response.body).toBeInstanceOf(Readable);

            const streamToString = (stream: Readable): Promise<string> => {
                const chunks: Buffer[] = [];
                return new Promise<string>((resolve, reject) => {
                    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk as any)));
                    stream.on('error', (err) => reject(err));
                    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                });
            };

            const body = await streamToString(response.body as Readable);
            expect(body).toContain('<http://example.org/person1> <http://schema.org/age> "30"^^<http://www.w3.org/2001/XMLSchema#integer> .');
        });
    });

    describe('Private Methods', () => {
        it('_convertOxigraphTerm should throw on unsupported term type', () => {
            const unsupportedTerm = { termType: 'Unsupported', value: 'test' };
            // Access private method for testing
            expect(() => (executor as any).convertOxigraphTerm(unsupportedTerm))
                .toThrow('Unsupported Oxigraph term type: Unsupported');
        });

        it('_quadsToNQuadsString should handle various literal types', () => {
            const s = oxigraph.namedNode('http://example.com/s');
            const p = oxigraph.namedNode('http://example.com/p');
            const quads = [
                oxigraph.quad(s, p, oxigraph.literal('string')),
                oxigraph.quad(s, p, oxigraph.literal('lang', 'en-gb')),
                oxigraph.quad(s, p, oxigraph.literal('1.23', oxigraph.namedNode('http://www.w3.org/2001/XMLSchema#decimal'))),
                oxigraph.quad(s, p, oxigraph.literal('special chars "\n\r'))
            ];
            const nquads = (executor as any).quadsToNQuadsString(quads);
            expect(nquads).toContain('<http://example.com/s> <http://example.com/p> "string" .');
            expect(nquads).toContain('<http://example.com/s> <http://example.com/p> "lang"@en-gb .');
            expect(nquads).toContain('<http://example.com/s> <http://example.com/p> "1.23"^^<http://www.w3.org/2001/XMLSchema#decimal> .');
            expect(nquads).toContain('<http://example.com/s> <http://example.com/p> "special chars \\"\\n\\r" .');
        });
    });
});
