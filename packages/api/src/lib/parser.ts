/**
 * The SPARQL query parser, as the API runs it.
 *
 * The parser itself lives in `@sparql-query-lib/compiler`, so the CLI and the
 * API compile and substitute with one implementation. This module supplies
 * what only the API has: the service log its diagnostics go to (and, through
 * it, OpenTelemetry when log export is on).
 * Every importer in the API keeps importing from here.
 */
import {
  SparqlQueryParser as CompilerParser,
  type ParserDiagnostic,
} from '@sparql-query-lib/compiler';
import { log } from './log.js';

export type {
  ApplyArgumentSet,
  ConstantWarning,
  CorrelatedExistsInput,
  DetectedParameters,
  ParsedSparql,
} from '@sparql-query-lib/compiler';

const parserLog = log.child({ component: 'sparql-parser' });

function logDiagnostic(diagnostic: ParserDiagnostic): void {
  // Debug diagnostics can carry the query text, so they stay at debug, below
  // the default level.
  if (diagnostic.level === 'warn') parserLog.warn(diagnostic.attributes ?? {}, diagnostic.message);
  else parserLog.debug(diagnostic.attributes ?? {}, diagnostic.message);
}

export class SparqlQueryParser extends CompilerParser {
  constructor() {
    super({ diagnostics: logDiagnostic });
  }
}
