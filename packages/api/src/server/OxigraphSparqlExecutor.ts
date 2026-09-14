import { Dispatcher } from 'undici'; // Still needed for interface compatibility
import {ISparqlExecutor, SparqlExecutionResult, SparqlSelectJsonOutput, SparqlQueryOptions} from './ISparqlExecutor.js';
import { toError } from '../lib/toError.js';
import * as oxigraph from 'oxigraph';
import { quadToNQuad, termToNQuad } from '../lib/nquads.js';
import { markStoreWritten } from '../lib/storeWrites.js';

/**
 * One term in SPARQL JSON results.
 *
 * `triple` is SPARQL 1.2's carrier for an RDF 1.2 triple term, and is why the
 * type is recursive: its value is three terms, not a lexical form.
 */
type SparqlJsonTerm =
    | { type: 'uri' | 'bnode' | 'literal'; value: string; datatype?: string; 'xml:lang'?: string }
    | { type: 'triple'; value: { subject: SparqlJsonTerm; predicate: SparqlJsonTerm; object: SparqlJsonTerm } };

// --- Oxigraph SPARQL Executor (Placeholder) ---

// Per-query tracing floods server logs, so it is opt-in via DEBUG_OXIGRAPH=true.
// Read the env var per call so tests can toggle it at runtime.
function debugLog(message: string): void {
    if (process.env.DEBUG_OXIGRAPH === 'true') {
        console.log(message);
    }
}

/**
 * Implements ISparqlExecutor for an in-memory Oxigraph store.
 * NOTE: This requires the 'oxigraph' package to be installed and configured.
 * The implementation details depend heavily on the oxigraph library's specific API.
 */
export class OxigraphSparqlExecutor implements ISparqlExecutor {
    private store: oxigraph.Store;

    constructor(store?: oxigraph.Store) {
        this.store = store || new oxigraph.Store();
        debugLog(`OxigraphSparqlExecutor initialized with ${this.store.size} quads`);
    }

    /**
     * Executes a SPARQL SELECT query against the Oxigraph store and returns parsed JSON.
     * Converts Oxigraph's native result format to standard SPARQL JSON.
     * Note: Oxigraph always returns JSON format, does not support alternative formats.
     */
    async selectQueryParsed(sparqlQuery: string): Promise<SparqlExecutionResult<SparqlSelectJsonOutput | string>> {
        debugLog(`Executing Oxigraph SELECT: ${sparqlQuery.substring(0, 100)}...`);
        const startTime = performance.now();
        try {
            const results = this.store.query(sparqlQuery);
            // SELECT queries return an array of Map objects (bindings)
            if (Array.isArray(results) && this.isSelectResult(results)) {
                const result = this.convertOxigraphSelectToJson(results);
                const duration = performance.now() - startTime;
                return { result, duration, contentType: 'application/sparql-results+json' };
            } else {
                throw new Error('Expected array of Map objects from SELECT query, got: ' + typeof results);
            }
        } catch (error__u: unknown) {
      const error = toError(error__u);
            console.error('Oxigraph SELECT query failed:', error);
            throw new Error(`SPARQL SELECT query execution failed: ${error?.message || error}`);
        }
    }

    /**
     * Executes a SPARQL CONSTRUCT query against the Oxigraph store and returns RDF string.
     * Converts Oxigraph's quad results to the requested format (Turtle or N-Quads).
     */
    async constructQueryParsed(sparqlQuery: string, options?: SparqlQueryOptions): Promise<SparqlExecutionResult<string>> {
        debugLog(`Executing Oxigraph CONSTRUCT: ${sparqlQuery.substring(0, 100)}...`);
        const startTime = performance.now();
        try {
            const results = this.store.query(sparqlQuery);
            // CONSTRUCT queries return an array of Quad objects
            if (Array.isArray(results)) {
                const acceptHeader = options?.acceptHeader?.toLowerCase();
                let result: string;
                let contentType: string;

                // Determine output format based on Accept header
                if (acceptHeader?.includes('text/turtle') || acceptHeader?.includes('turtle')) {
                    result = this.quadsToTurtleString(results);
                    contentType = 'text/turtle';
                } else {
                    // Default to N-Quads for backwards compatibility
                    result = this.quadsToNQuadsString(results);
                    contentType = 'application/n-quads';
                }

                const duration = performance.now() - startTime;
                return { result, duration, contentType };
            } else {
                throw new Error('Expected array result from CONSTRUCT query, got: ' + typeof results);
            }
        } catch (error__u: unknown) {
      const error = toError(error__u);
            console.error('Oxigraph CONSTRUCT query failed:', error);
            throw new Error(`SPARQL CONSTRUCT query execution failed: ${error?.message || error}`);
        }
    }

    /**
     * Executes a SPARQL SELECT query and returns a stream.
     * For Oxigraph, this converts parsed results to a stream format.
     */
    async selectQueryStream(sparqlQuery: string): Promise<Dispatcher.ResponseData> {
        debugLog(`Executing Oxigraph SELECT (Stream): ${sparqlQuery.substring(0, 100)}...`);
        
        // For now, fallback to parsed results and convert to stream
        const { result } = await this.selectQueryParsed(sparqlQuery);
        const jsonString = JSON.stringify(result);
        const buffer = Buffer.from(jsonString, 'utf8');
        
        // Create a simple readable stream from the buffer
        const stream = new (require('stream').Readable)({
            read() {
                this.push(buffer);
                this.push(null); // End the stream
            }
        });
        
        return {
            statusCode: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: stream,
            trailers: {},
            opaque: null,
            context: {}
        } as Dispatcher.ResponseData;
    }

    /**
     * Executes a SPARQL CONSTRUCT query and returns a stream.
     * For Oxigraph, this converts parsed results to a stream format.
     */
    async constructQueryStream(sparqlQuery: string): Promise<Dispatcher.ResponseData> {
        debugLog(`Executing Oxigraph CONSTRUCT (Stream): ${sparqlQuery.substring(0, 100)}...`);
        
        // Fallback to parsed results and convert to stream
        const { result } = await this.constructQueryParsed(sparqlQuery);
        const buffer = Buffer.from(result, 'utf8');
        
        // Create a simple readable stream from the buffer
        const stream = new (require('stream').Readable)({
            read() {
                this.push(buffer);
                this.push(null); // End the stream
            }
        });
        
        return {
            statusCode: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/n-quads' },
            body: stream,
            trailers: {},
            opaque: null,
            context: {}
        } as Dispatcher.ResponseData;
    }

    // --- Private Helper Methods ---

    /**
     * Converts an array of Oxigraph Quad objects into a Turtle string representation.
     * Groups triples by subject for more readable Turtle output.
     * @param quads An array of Quad objects from Oxigraph.
     * @returns A Turtle formatted string.
     */
    private quadsToTurtleString(quads: any[]): string {
        if (quads.length === 0) return '';

        // Group quads by subject
        const subjectMap = new Map<string, Array<{ pred: string; obj: string }>>();

        for (const q of quads) {
            // Format subject
            const subj = q.subject.termType === 'NamedNode'
                ? `<${q.subject.value}>`
                : `_:${q.subject.value}`;

            // Format predicate
            const pred = `<${q.predicate.value}>`;

            // Format object
            // Turtle 1.2 shares N-Triples' term syntax for everything that can
            // stand in object position, triple terms included.
            const obj = termToNQuad(q.object);

            // Add to subject map
            if (!subjectMap.has(subj)) {
                subjectMap.set(subj, []);
            }
            subjectMap.get(subj)!.push({ pred, obj });
        }

        // Generate Turtle output
        const lines: string[] = [];
        for (const [subj, predicates] of subjectMap) {
            // Group by predicate for even more compact output
            const predMap = new Map<string, string[]>();
            for (const { pred, obj } of predicates) {
                if (!predMap.has(pred)) {
                    predMap.set(pred, []);
                }
                predMap.get(pred)!.push(obj);
            }

            // Format as Turtle
            lines.push(subj);
            const predLines = Array.from(predMap.entries()).map(([pred, objs], idx, arr) => {
                const objList = objs.join(', ');
                const terminator = idx === arr.length - 1 ? ' .' : ' ;';
                return `  ${pred} ${objList}${terminator}`;
            });
            lines.push(...predLines);
            lines.push(''); // Blank line between subjects
        }

        return lines.join('\n');
    }

    /**
     * Converts an array of Oxigraph Quad objects into an N-Quads string representation.
     * @param quads An array of Quad objects from Oxigraph.
     * @returns An N-Quads formatted string.
     */
    private quadsToNQuadsString(quads: any[]): string {
        // The shared writer, so a triple term in a CONSTRUCT result is rendered
        // the same way the executor and the canonicaliser render it.
        return quads.map(q => quadToNQuad(q)).join('\n');
    }



    /** Converts Oxigraph's SELECT result format to standard SPARQL JSON */
    private convertOxigraphSelectToJson(oxigraphResults: Array<Map<string, any>>): SparqlSelectJsonOutput {
        const bindings: any[] = [];
        const vars = new Set<string>();

        // Process each binding from the results
        for (const binding of oxigraphResults) {
            const bindingObj: Record<string, any> = {};
            
            // Iterate through all variables in this binding
            for (const [varName, term] of Array.from(binding)) {
                vars.add(varName);
                bindingObj[varName] = this.convertOxigraphTerm(term);
            }
            
            bindings.push(bindingObj);
        }

        return {
            head: { vars: Array.from(vars) },
            results: { bindings }
        };
    }

    /** Type guard to check if results are from SELECT query (array of Maps) */
    private isSelectResult(results: any[]): results is Array<Map<string, any>> {
        return results.length === 0 || results[0] instanceof Map;
    }

    /** Converts a single Oxigraph term to the SPARQL JSON binding format */
    private convertOxigraphTerm(term: any): SparqlJsonTerm {
        switch (term.termType) {
            case 'NamedNode':
                return { type: 'uri', value: term.value };
            case 'Literal':
                const binding: any = { type: 'literal', value: term.value };
                if (term.language) {
                    binding['xml:lang'] = term.language;
                } else if (term.datatype && term.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
                    binding.datatype = term.datatype.value;
                }
                return binding;
            case 'BlankNode':
                // SPARQL JSON results typically use "bnode" type
                return { type: 'bnode', value: term.value };
            // An RDF 1.2 triple term, which SPARQL 1.2's JSON results format
            // carries as a nested object rather than a lexical form.
            case 'Quad':
                return {
                    type: 'triple',
                    value: {
                        subject: this.convertOxigraphTerm(term.subject),
                        predicate: this.convertOxigraphTerm(term.predicate),
                        object: this.convertOxigraphTerm(term.object),
                    },
                };
            default:
                throw new Error(`Unsupported Oxigraph term type: ${term.termType}`);
        }
    }

    /**
     * Executes a SPARQL UPDATE query (e.g., INSERT, DELETE) against the Oxigraph store.
     */
    async update(sparqlUpdateQuery: string): Promise<SparqlExecutionResult<void>> {
        debugLog(`Executing Oxigraph UPDATE: ${sparqlUpdateQuery.substring(0, 100)}...`);
        const startTime = performance.now();
        try {
            this.store.update(sparqlUpdateQuery);
            // The one place a SPARQL write reaches an in-process store, so it
            // is where the periodic checkpoint learns that a durable store is
            // no longer the file on disk (#443). Marked on success only: a
            // failed update leaves the store as it was.
            markStoreWritten(this.store);
            debugLog('Oxigraph UPDATE completed successfully');
            const duration = performance.now() - startTime;
            return { result: undefined, duration };
        } catch (error__u: unknown) {
      const error = toError(error__u);
            console.error('Oxigraph UPDATE failed:', error);
            throw new Error(`SPARQL UPDATE query execution failed: ${error?.message || error}`);
        }
    }

    /**
     * Executes a SPARQL ASK query against the Oxigraph store.
     * Returns a promise resolving to a boolean.
     */
    async askQuery(sparqlAskQuery: string): Promise<SparqlExecutionResult<boolean | string>> {
        debugLog(`Executing Oxigraph ASK: ${sparqlAskQuery.substring(0, 100)}...`);
        const startTime = performance.now();
        try {
            const result = this.store.query(sparqlAskQuery);
            // ASK queries return boolean directly
            if (typeof result === 'boolean') {
                const duration = performance.now() - startTime;
                return { result, duration, contentType: 'application/sparql-results+json' };
            } else {
                throw new Error('Expected boolean result from ASK query, got: ' + typeof result);
            }
        } catch (error__u: unknown) {
      const error = toError(error__u);
            console.error('Oxigraph ASK query failed:', error);
            throw new Error(`SPARQL ASK query execution failed: ${error?.message || error}`);
        }
    }
}
