/**
 * `@sparql-query-lib/runtime-srl` — run a SHACL 1.2 rule set with no server.
 *
 * `RuleSetRunner` evaluates DATA blocks once, then each stratum of rules to its
 * own fixpoint, on an Oxigraph store, and reports every pass. The host prepares
 * the rules (loaded, validated, stratified) and the DATA blocks through a
 * `RuleSetSource`; the API's reads its entity cache, and the CLI's will read a
 * bundle or an SRL file.
 */
export {
  RuleSetRunner,
  loadIntoStore,
  storeExecutor,
  type DataBlockExecutionRecord,
  type ExecutionStatus,
  type IterationRecord,
  type PreparedDataBlock,
  type PreparedRule,
  type ProgramSource,
  type RuleExecutionRecord,
  type RuleExecutor,
  type RuleRunLog,
  type RuleSetExecutionCallbacks,
  type RuleSetExecutionResult,
  type RuleSetRunOptions,
  type RuleSetSource,
  type SelectResults,
} from './runRuleSet.js';

export { TupleStore, injectTupleReads, renderBindingValue, renderTerm, type SparqlJsonValue } from './TupleStore.js';
export { quadToNQuad, termToNQuad, type RenderableQuad, type RenderableTerm } from './nquads.js';
