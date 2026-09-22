import { Parser } from '@traqula/parser-sparql-1-2';
import { QueryTypeIri, type QueryTypeValue } from '../constants/queryTypes.js';

export type SparqlOperation = QueryTypeValue;

// Use the SPARQL 1.2 parser so RDF-star triple terms don't fail parsing during detection.
// A Traqula Parser instance is stateful and not parallel-safe, so keep it module-scoped and
// reuse it for sequential calls (matching how sparqljs was used here).
//
// Built on first use rather than at import: constructing one assembles the whole
// chevrotain SPARQL 1.2 grammar, ~70ms, and this module is on the API's import
// path whether or not the process ever detects a query type. Three such
// constructions were ~210ms of a ~2.8s cold start (issue: startup time). The
// instance is still made exactly once, and still shared.
let parser: Parser | null = null;

function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
  }
  return parser;
}

// SPARQL 1.1/1.2 update operation forms, keyed by Traqula's lowercase `operation.subType`.
const SUPPORTED_UPDATE_OPS = new Set([
  'load',
  'clear',
  'create',
  'drop',
  'add',
  'move',
  'copy',
  'insertdata',
  'deletedata',
  'deletewhere',
  'modify',
]);

/**
 * Inspect a SPARQL string and identify the top-level operation type.
 * Uses Traqula so PREFIX/BASE declarations and comments are handled correctly.
 * Throws if the text cannot be parsed or the operation is not supported.
 */
export function detectSparqlOperation(queryString: string): SparqlOperation {
  if (!queryString || !queryString.trim()) {
    throw new Error('SPARQL query is empty');
  }

  const activeParser = getParser();
  let parsed: ReturnType<typeof activeParser.parse>;
  try {
    parsed = activeParser.parse(queryString);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse SPARQL query: ${message}`);
  }

  if (parsed.type === 'query') {
    const subType: string = parsed.subType;
    switch (subType) {
      case 'select':
        return QueryTypeIri.select;
      case 'ask':
        return QueryTypeIri.ask;
      case 'construct':
        return QueryTypeIri.construct;
      case 'describe':
        return QueryTypeIri.describe;
      default:
        throw new Error(`Unsupported SPARQL query form: ${(subType || 'UNKNOWN').toUpperCase()}`);
    }
  }

  if (parsed.type === 'update') {
    const updates = parsed.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new Error('SPARQL UPDATE contains no operations');
    }

    // Validate that every operation is one of the SPARQL 1.1 update forms
    const unsupported = updates
      .map(entry => entry?.operation?.subType as string | undefined)
      .filter((subType): subType is string => !!subType && !SUPPORTED_UPDATE_OPS.has(subType));

    if (unsupported.length > 0) {
      throw new Error(`Unsupported SPARQL update operation(s): ${unsupported.join(', ')}`);
    }

    return QueryTypeIri.update;
  }

  throw new Error(`Unsupported SPARQL operation type: ${(parsed as { type?: string }).type}`);
}
