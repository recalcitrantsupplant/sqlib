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
 * The safety boundary is `serializeTerm` and friends: every caller-supplied
 * value is proven to sit inside its SPARQL terminal production or rejected. That
 * is the same module the server runs, not a reimplementation of it.
 *
 * This entry is what an exported page needs, and what the semver range promises.
 * The machinery underneath — term serialisation, slot assignment, page-parameter
 * substitution, bundle hashing — is shared with the sqlib server through
 * `@sparql-query-lib/runtime/internal`, which promises nothing.
 */

export { InvalidTermError, type PrefixTable, type TermValue } from './sparql-terms.js';

export {
  type ArgumentRow,
  type EmptyArgumentMode,
  type QueryTemplate,
  type TemplateSlot,
} from './query-template.js';

export { InvalidArgumentError, type WireArgumentSet } from './arguments.js';

export {
  describeTerm,
  prefixTableAbbreviator,
  type Abbreviation,
  type DescribeTermOptions,
  type TermDescription,
} from './describe-term.js';

export { InvalidParameterError, type ExecutionParameter } from './limit-offset.js';

export {
  InvalidBundleError,
  assertValidBundle,
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
