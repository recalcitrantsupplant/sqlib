/**
 * The SPARQL query parser, as the API runs it.
 *
 * The parser itself lives in `@sparql-query-lib/compiler`, so the CLI and the
 * API compile and substitute with one implementation. This module supplies
 * what only the API has: the OpenTelemetry logger its diagnostics go to.
 * Every importer in the API keeps importing from here.
 */
import {
  SparqlQueryParser as CompilerParser,
  type ParserDiagnostic,
} from '@sparql-query-lib/compiler';
import { logger, SeverityNumber } from './logger.js';

export type {
  ApplyArgumentSet,
  CorrelatedExistsInput,
  DetectedParameters,
  ParsedSparql,
} from '@sparql-query-lib/compiler';

function emitToOtel(diagnostic: ParserDiagnostic): void {
  logger.emit({
    severityNumber: diagnostic.level === 'warn' ? SeverityNumber.WARN : SeverityNumber.DEBUG,
    body: diagnostic.message,
    ...(diagnostic.attributes ? { attributes: diagnostic.attributes } : {}),
  });
}

export class SparqlQueryParser extends CompilerParser {
  constructor() {
    super({ diagnostics: emitToOtel });
  }
}
