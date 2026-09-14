/**
 * `@sparql-query-lib/runtime` — run exported sqlib queries without a sqlib server.
 *
 * A bundle produced by `sqlib export` carries each query already compiled: its
 * canonical text plus the span of every parameter slot. Applying arguments is then
 * "serialise a VALUES block, splice it over a span", which needs no SPARQL parser
 * — the finding this package exists to exploit.
 *
 * What that buys is not speed, it is the absence of a deployment: a static page
 * can hold parameterised queries, take user input, and talk straight to a SPARQL
 * endpoint. Development and testing still use the full sqlib API, which is what
 * compiles and verifies the templates in the first place.
 *
 * The safety boundary is {@link serializeTerm} and friends: every caller-supplied
 * value is proven to sit inside its SPARQL terminal production or rejected. That
 * is the same module the server runs, not a reimplementation of it.
 */

export {
  InvalidTermError,
  escapeLiteralLexical,
  isSafeVariableName,
  renderValuesBlock,
  serializeIri,
  serializeTerm,
  serializeVariable,
  type PrefixTable,
  type TermValue,
} from './sparql-terms.js';

export {
  alignArgumentSets,
  applyTemplateArguments,
  type ArgumentRow,
  type EmptyArgumentMode,
  type QueryTemplate,
  type TemplateArgumentSet,
  type TemplateSlot,
} from './query-template.js';

export { normalizeUndefBindings, type WireArgumentSet } from './arguments.js';

export {
  describeTerm,
  prefixTableAbbreviator,
  type Abbreviation,
  type DescribeTermOptions,
  type TermDescription,
} from './describe-term.js';

export {
  InvalidParameterError,
  assertPageParameterValue,
  substituteLimitOffset,
  toExecutionParameters,
  type ExecutionParameter,
} from './limit-offset.js';

export {
  InvalidBundleError,
  assertValidBundle,
  hashTemplateText,
  verifyBundleIntegrity,
  type ExportBundle,
  type ExportedGroup,
  type ExportedGroupEdge,
  type ExportedGroupNode,
  type ExportedQuery,
  type ExportedQueryType,
  type GroupVariableMapping,
  type PageParameterSpan,
  type QueryExample,
} from './bundle.js';

export {
  GroupHandle,
  type GroupCallPayload,
  type GroupExternalInput,
  type GroupRunResult,
} from './group.js';

export {
  SparqlEndpointError,
  httpExecutor,
  type ExecutionRequest,
  type ExecutionResult,
  type Executor,
  type HttpExecutorOptions,
  type RdfPayload,
  type SparqlAskResults,
  type SparqlSelectResults,
} from './executor.js';

export {
  QueryCallError,
  QueryHandle,
  QueryLibrary,
  fromBundle,
  iri,
  literal,
  type ArgumentSetInput,
  type CallPayload,
  type FromBundleOptions,
  type ParameterInput,
  type TypedExportBundle,
} from './library.js';
