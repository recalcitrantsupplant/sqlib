/**
 * `@sparql-query-lib/compiler` — the half of sqlib that needs a SPARQL parser.
 *
 * Parse, format, detect parameters, apply arguments through the AST, and
 * compile a query to the template `@sparql-query-lib/runtime` splices with no
 * parser. The API runs it on its request path and at export time; the CLI runs
 * it on text read from a file. Both then hand the template to the same runtime
 * splice, so a query compiled here runs the way an exported one does.
 */
export {
  SparqlQueryParser,
  type ApplyArgumentSet,
  type ArgumentValue,
  type CorrelatedExistsInput,
  type DetectedParameters,
  type ParsedSparql,
  type ParserDiagnostic,
  type SparqlQueryParserOptions,
} from './parser.js';

export { detectSparqlOperation, type SparqlOperation } from './operation.js';

export {
  TemplateCompileError,
  compileQueryTemplate,
  type CompileQueryOptions,
  type CompiledQuery,
} from './compileTemplate.js';
