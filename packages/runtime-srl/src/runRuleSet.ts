/**
 * Run a SHACL 1.2 rule set: DATA blocks once, then each stratum of rules to
 * its own fixpoint, on an Oxigraph store.
 *
 * Moved from `packages/api/src/lib/RuleSetExecutor.ts`, which now calls it. The
 * host supplies what it alone knows: the rules, already loaded, validated and
 * stratified; the DATA blocks, already loaded and validated; the run's limits.
 * It supplies them through a `RuleSetSource` the runner calls at the points the
 * run needs them, so a refusal lands at the same moment, with the same result,
 * whichever host runs the set. The API's source reads its entity cache; the CLI
 * will read a bundle or an SRL file.
 */
import { createHash } from 'node:crypto';
import * as oxigraph from 'oxigraph';
import { GROUND_GRAPH_IRI, groundTupleSeedRows, parseTupleSeeds, type MonotonicityKind, type TupleRef } from '@sparql-query-lib/srl';
import { TupleStore, injectTupleReads, renderBindingValue, type SparqlJsonValue } from './TupleStore.js';
import { quadToNQuad } from './nquads.js';

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_RULE_TIMEOUT_MS = 30000;
const DEFAULT_RULE_SAMPLE_LIMIT = 10;

export type ProgramSource = 'normalized' | 'raw';
export type ExecutionStatus = 'converged' | 'cycle' | 'maxIterations' | 'failed';

type SerializedError = { message: string; stack?: string };

/** A rule ready to run: its program, and where the stratifier put it. */
export interface PreparedRule {
  ruleVersionId: string;
  /**
   * The rule's own IRI, from `RULE <iri>` in the SRL, when the author wrote one.
   *
   * The rule set's *identity* for this rule, as against `ruleVersionId`, which
   * is the identity of the entity we happen to be executing. A reader looking
   * at a run wants the former: they wrote `RULE <http://example.org/reaches>`,
   * so that is what a result should be attributed to.
   */
  ruleIri?: string;
  program: string;
  source: ProgramSource;
  stratum?: number;
  monotonicity?: MonotonicityKind;
  /**
   * Run exactly once (the spec's `SL.once`) instead of iterating to a fixpoint:
   * the rule mints blank nodes or assigns values, so every firing yields a
   * fresh answer and iterating it never converges. Stratification guarantees
   * everything such a rule reads is complete before its stratum is reached.
   */
  runOnce?: boolean;
  /** Rule-tuples metadata; absent for ordinary triple-only rules. */
  tuples?: {
    /** Body tuple patterns — VALUES blocks are injected for each before running. */
    reads: TupleRef[];
    /** Head tuple templates — solution rows are captured into the tuple store. */
    writes: TupleRef[];
    /** True when `program` is a SELECT whose rows become tuples. */
    producesTuples: boolean;
  };
}

interface DatasetState {
  hash: string;
  tripleCount: number;
  orderedKeys: string[];
  keySet: Set<string>;
}

export interface DataBlockExecutionRecord {
  dataBlockVersionId: string;
  programSource: ProgramSource;
  durationMs: number;
  tripleDelta: number;
  error?: SerializedError;
}

export interface RuleExecutionRecord {
  ruleVersionId: string;
  /** The author's `RULE <iri>`, when the rule declares one. See `PreparedRule.ruleIri`. */
  ruleIri?: string;
  /**
   * The stratum this rule was evaluated in, 0-based as the stratifier reports it.
   *
   * Carried on the record so a reader of the trace can tell which layer a firing
   * belongs to without re-stratifying the document: the replay tints its timeline
   * with the same `--stratum-*` ramp the editor gutter uses, and that colour has
   * to come from the run rather than from a later parse of possibly-edited text.
   */
  stratum?: number;
  programSource: ProgramSource;
  durationMs: number;
  /**
   * Triples the rule inserted and deleted. Exact under `trace`; otherwise the
   * net change in the store's size, split by sign, since telling a rule's
   * inserts from its deletes costs a capture of the whole dataset.
   */
  triplesInserted: number;
  triplesDeleted: number;
  /** The quads themselves, under `trace` only; empty otherwise. */
  quadSamples: string[];
  insertedQuads: string[];
  deletedQuads: string[];
  /**
   * Named tuples this rule added to the workspace, rendered `TUPLE(a, b, …)`.
   *
   * The tuple counterpart of `insertedQuads`. Tuples are never deleted — the
   * store is set-semantics and append-only for the length of a run — so there
   * is no deletion side to report.
   */
  insertedTuples: string[];
  timedOut: boolean;
  error?: SerializedError;
}

export interface IterationRecord {
  index: number;
  signature: string;
  tripleCount: number;
  /** Rows in the named-tuple workspace at the end of this iteration. */
  tupleCount: number;
  delta: number;
  /**
   * Wall clock for the whole iteration, milliseconds.
   *
   * Not the sum of `rules[].durationMs`: an iteration also hashes the dataset
   * either side of every rule, and that capture is what makes a pass expensive
   * on a large graph. Measuring the pass rather than adding up its parts is the
   * only way the difference shows.
   */
  durationMs: number;
  /**
   * The stratum this pass evaluated, 0-based as the stratifier reports it.
   *
   * The rules carry their own (`RuleExecutionRecord.stratum`), but an iteration
   * belongs to exactly one — the loop advances the cursor only at a stratum's
   * own fixpoint — and a reader comparing iteration 3 of two runs needs to know
   * whether they are the same layer before the comparison means anything.
   */
  stratum?: number;
  rules: RuleExecutionRecord[];
}

export interface RuleSetExecutionResult {
  status: ExecutionStatus;
  iterations: IterationRecord[];
  dataBlocks: DataBlockExecutionRecord[];
  /**
   * The triples the DATA blocks seeded, as N-Quads lines.
   *
   * Per-block attribution would cost a dataset capture on either side of every
   * block; the union is free, because the baseline and the post-data-block
   * state are both captured already. It completes the audit: the seeded triples
   * plus every rule's inserts, minus its deletes, is exactly `finalGraphNQuads`,
   * so a client replaying the run can reconcile against the final graph rather
   * than being short by whatever the DATA blocks contributed.
   */
  seededQuads?: string[];
  finalGraphNQuads?: string;
  finalGraphContent?: string;
  finalGraphContentType?: string;
  /**
   * The named-tuple workspace as it stood when the run ended, rendered
   * `TUPLE(a, b, …)`.
   *
   * Tuples are intermediate working data: they never enter the inference graph,
   * so without this the only trace of a tuple-driven derivation is the triples
   * it eventually wrote. Empty for a run that used no tuples.
   */
  finalTuples?: string[];
  cycle?: { startIteration: number; endIteration: number };
  maxIterations?: number;
  /**
   * Why a `failed` run failed.
   *
   * The same sentence `onExecutionError` streams to a watching UI, kept on the
   * result for callers that did not pass callbacks — the test runner, chiefly,
   * whose whole job is to report a reason. Without it every refusal reaches the
   * reader as "Rule set execution failed", which is the one thing they already
   * knew.
   */
  error?: string;
}

export interface RuleSetExecutionCallbacks {
  onExecutionStart?(payload: { ruleSetVersionId: string; totalRules: number; totalDataBlocks: number }): void;
  onDataBlockComplete?(payload: DataBlockExecutionRecord & { index: number }): void;
  onIterationStart?(payload: { index: number; signature: string; tripleCount: number }): void;
  onRuleResult?(payload: RuleExecutionRecord & { iteration: number; ruleOrder: number }): void;
  onIterationComplete?(payload: IterationRecord): void;
  onExecutionComplete?(payload: RuleSetExecutionResult): void;
  onExecutionError?(payload: { message: string; status: ExecutionStatus }): void;
}


/** A DATA block ready to run, or the reason it cannot. */
export interface PreparedDataBlock {
  dataBlockVersionId: string;
  programSource: ProgramSource;
  /** The SPARQL UPDATE that inserts the block's triples, or null when it has none. */
  program: string | null;
  /** The error a block with no program reports. */
  missingContentMessage?: string;
}

/**
 * What the host supplies to a run. Each method is called once, at the point
 * the run reaches it; throwing refuses the run with the error's message.
 */
export interface RuleSetSource {
  /** Named in `onExecutionStart` and in refusal messages. */
  id: string;
  ruleCount: number;
  dataBlockCount: number;
  /** The rules, validated, stratified and in run order. */
  prepareRules(): PreparedRule[];
  /** The DATA blocks, validated, in run order. Called after the base graph is loaded. */
  prepareDataBlocks(): PreparedDataBlock[];
  /** The named-tuple seed rows to start from, as text, or none. */
  tupleSeeds?: string | null;
}

/**
 * What the runner needs of an executor: an UPDATE and a SELECT. The API passes
 * its Oxigraph executor, so the messages its records carry are the API's own.
 */
export interface RuleExecutor {
  update(program: string): Promise<{ duration?: number }>;
  selectQueryParsed(program: string): Promise<{ result: SelectResults | string; duration?: number }>;
}

/** SPARQL Results JSON for a SELECT, as far as the runner reads it. */
export interface SelectResults {
  results?: { bindings?: Array<Record<string, unknown>> };
}

export type RuleRunLog = (level: 'debug' | 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => void;

export interface RuleSetRunOptions {
  /** Passes per stratum before the run stops as `maxIterations`. Default 5. */
  maxIterations?: number;
  /** A rule that takes longer than this is recorded as timed out. Default 30s. */
  timeoutMs?: number;
  /** Inserted quads sampled per rule under trace. Default 10. */
  sampleLimit?: number;
  /** Serialisation of the inference graph. Default N-Triples. */
  inferenceFormat?: string;
  callbacks?: RuleSetExecutionCallbacks;
  shouldAbort?: () => boolean;
  /** Stops the run before its next rule or DATA block. */
  signal?: AbortSignal;
  /** Turns an aborted signal into the error whose message the run reports. */
  abortError?: (signal: AbortSignal) => Error;
  /** Record which quads each rule inserted and deleted. See the API's options. */
  trace?: boolean;
  /** The base graph G0, and how to read it. */
  initialGraph?: string | null;
  initialGraphFormat?: string | null;
  /** The store to run on. Default: a new, empty one. The caller disposes of it. */
  store?: oxigraph.Store;
  /** The executor over that store. Default: `storeExecutor(store)`. */
  executor?: RuleExecutor;
  /** How the base graph is loaded. Default: `loadIntoStore`. */
  loadGraph?: (store: oxigraph.Store, data: string, format: string) => Promise<void>;
  log?: RuleRunLog;
}

function defaultAbortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Execution was aborted');
}

const FORMATS: Record<string, string> = {
  ntriples: 'application/n-triples',
  nt: 'application/n-triples',
  nquads: 'application/n-quads',
  nq: 'application/n-quads',
  turtle: 'text/turtle',
  ttl: 'text/turtle',
  trig: 'application/trig',
  rdfxml: 'application/rdf+xml',
  jsonld: 'application/ld+json',
};

/** Load RDF text into a store. Takes a media type or a short name such as `turtle`. */
export async function loadIntoStore(store: oxigraph.Store, data: string, format: string): Promise<void> {
  store.load(data, { format: FORMATS[format.toLowerCase()] ?? format });
}

/** An executor straight over an Oxigraph store, for a host with no executor of its own. */
export function storeExecutor(store: oxigraph.Store): RuleExecutor {
  return {
    async update(program) {
      const start = performance.now();
      try {
        store.update(program);
      } catch (error) {
        throw new Error(`SPARQL UPDATE query execution failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      return { duration: performance.now() - start };
    },
    async selectQueryParsed(program) {
      const start = performance.now();
      let json: unknown;
      try {
        json = store.query(program, { results_format: 'application/sparql-results+json' });
      } catch (error) {
        throw new Error(`SPARQL SELECT query execution failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      return { result: (typeof json === 'string' ? JSON.parse(json) : json) as SelectResults, duration: performance.now() - start };
    },
  };
}

export class RuleSetRunner {
  async run(source: RuleSetSource, options: RuleSetRunOptions = {}): Promise<RuleSetExecutionResult> {
    // The host caps this: the API at its deployment's limit.
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const trace = options.trace === true;
    const abortError = options.abortError ?? defaultAbortError;
    const log = options.log ?? (() => {});
    const timeoutMs = options.timeoutMs ?? DEFAULT_RULE_TIMEOUT_MS;
    const sampleLimit = options.sampleLimit ?? DEFAULT_RULE_SAMPLE_LIMIT;
    const inferenceFormat = options.inferenceFormat ?? 'application/n-triples';
    const callbacks = options.callbacks;
    const shouldAbort = options.shouldAbort ?? (() => false);
    /** Why the run must stop now, or null to carry on. */
    const stopReason = (): string | null => {
      if (options.signal?.aborted) return abortError(options.signal).message;
      return shouldAbort() ? 'Execution aborted by caller' : null;
    };

    const dataBlockRecords: DataBlockExecutionRecord[] = [];
    const iterations: IterationRecord[] = [];
    let currentState: DatasetState | null = null;
    let baselineState: DatasetState | null = null;
    let cycleInfo: { startIteration: number; endIteration: number } | undefined;
    let status: ExecutionStatus | undefined;
    // Assigned once the DATA blocks have run; a failure before that leaves it
    // undefined, which is the honest answer rather than an empty list.
    let seededQuads: string[] | undefined;

    const store = options.store ?? new oxigraph.Store();
    const executor = options.executor ?? storeExecutor(store);
    const loadGraph = options.loadGraph ?? loadIntoStore;
    // Ephemeral per execution; tuples never enter the RDF/inference graph.
    const tupleStore = new TupleStore();

    /**
     * Give up, saying why, once.
     *
     * Every refusal used to be a callback and a `buildResult` on the next line,
     * and the reason reached only the callback — so a caller without one got a
     * status and nothing else. One helper keeps the two in step.
     */
    /**
     * The named-tuple workspace as it stands, attached to a result.
     *
     * Only when the run actually used tuples: a rule set with none should not
     * grow an empty section on every result. Kept out of `buildResult` because
     * tuples are not the RDF dataset and it has no business knowing about them.
     */
    const withTuples = (result: RuleSetExecutionResult): RuleSetExecutionResult => (
      tupleStore.size > 0
        ? { ...result, finalTuples: tupleStore.allRows().map(renderTupleRow) }
        : result
    );

    const fail = (message: string, failStatus: ExecutionStatus = 'failed'): RuleSetExecutionResult => {
      callbacks?.onExecutionError?.({ message, status: failStatus });
      return {
        ...withTuples(buildResult(failStatus, iterations, dataBlockRecords, currentState, baselineState, cycleInfo, maxIterations, store, inferenceFormat, seededQuads, log)),
        error: message,
      };
    };

    try {
      callbacks?.onExecutionStart?.({
        ruleSetVersionId: source.id,
        totalRules: source.ruleCount,
        totalDataBlocks: source.dataBlockCount,
      });

      /*
       * Whether the rules can run at all is settled before anything touches the
       * store. An invalid rule or a rule set that does not stratify is refused
       * as a whole, and it used to be refused only after the DATA blocks had
       * been applied — so a failed run still reported their triples as
       * seeded, and a client showing "what the rule set produced" showed them
       * for a rule set that produced nothing. Nothing is seeded now.
       */
      // The host loads, validates and stratifies the rules, and refuses the
      // whole set by throwing, which fails the run below with its message.
      const preparedRules = source.prepareRules();

      // Seed the tuple store with the ruleset's initial named tuples, before
      // anything runs. Without this a tuple relation can only ever be derived
      // by some rule head — never *given* — so a ruleset cannot take a tuple as
      // input. Rows carrying variables are declarations of inputs a caller
      // supplies, not values, so only ground rows are seeded.
      const seedFailure = seedTupleStore(tupleStore, source.id, source.tupleSeeds);
      if (seedFailure) {
        return fail(seedFailure);
      }

      // Seed the store with the base graph G0: either the data graph supplied
      // with the request (a saved DataGraphVersion or inline RDF — see
      // `dataGraphInput`) or the output of an upstream construct/describe node
      // in a query group. One seam, because they are the same thing to the
      // rules: input they match against and never emit.
      const initialGraph = options.initialGraph?.trim();
      if (initialGraph) {
        await loadGraph(store, initialGraph, options.initialGraphFormat || 'ntriples');
      }

      // The baseline is the base graph G0 — the data graph the rules run
      // against — and nothing else. It is captured here, *before* data blocks
      // run, because SHACL 1.2 Rules initialises the inference graph from the
      // DATA triples: "a data block is equivalent to a rule with an empty
      // body: its triples are part of the inference graph without any rule
      // being evaluated", formally `GI = { t ∈ D | t ∉ G0 }`. Capturing the
      // baseline after the data blocks would subtract those triples back out
      // of the result. See `docs/reference/srl-language.md`.
      baselineState = captureDatasetState(store);

      // Freeze the ground graph, `GD`, for `WHERE DATA` / `NOT DATA` to match
      // against. Here — after the base graph is loaded, *before* any DATA block
      // runs — because ground data is the input, and DATA blocks are part of
      // the rule set rather than the data.
      //
      // The spec says this twice and not quite the same way. The prose is
      // "Ground data is the triples in the base graph" (Matching Ground Data);
      // the pseudocode is `let GD = G0 ∪ D` (Evaluation of a Rule Set). The two
      // disagree exactly when a DATA block supplies a triple a `NOT DATA` asks
      // about, and `eval-neg-data-03` is that case: base graph empty, `DATA {
      // :s :p :o }`, and the expected result has the rule firing — so the test
      // sides with the prose. It is also the reading that holds together with
      // §1 of our data-graph design (issue #149): DATA triples are inference
      // *output*, and a triple cannot sensibly be both inferred output and
      // ground input. Following the prose; reported upstream.
      //
      // Moving this line past the data-block loop below is the other reading,
      // and `test/lib/RuleSetExecutor.groundGraph.test.ts` is where that shows:
      // three of its cases fail and the rest pass, which is the difference
      // between the two readings and nothing else. In the W3C suite the same
      // move costs `eval-neg-data-03` and `-06`, taking the eval category from
      // 35/35 to 33/35.
      await executor.update(`INSERT { GRAPH <${GROUND_GRAPH_IRI}> { ?s ?p ?o } } WHERE { ?s ?p ?o }`);

      // Execute data blocks once before any rules
      // As with the rules: the host loads and validates, and refuses by throwing.
      const dataBlocks = source.prepareDataBlocks();
      for (let idx = 0; idx < dataBlocks.length; idx += 1) {
        const stopped = stopReason();
        if (stopped) {
          return fail(stopped);
        }

        const record = await runDataBlock(executor, store, dataBlocks[idx]!);
        dataBlockRecords.push(record);
        callbacks?.onDataBlockComplete?.({ ...record, index: idx + 1 });

        if (record.error) {
          return fail(record.error.message);
        }
      }

      // Fixpoint bookkeeping starts from the post-data-block state: data
      // blocks run once and are not part of the iteration delta.
      currentState = captureDatasetState(store);

      // Both ends of the DATA blocks' contribution are already in hand, so the
      // triples they seeded cost a set difference rather than a capture.
      seededQuads = baselineState
        ? diffDatasetStates(baselineState, currentState, 0).inserted
        : currentState.orderedKeys.slice();


      if (preparedRules.length === 0) {
        const result = withTuples(buildResult('converged', iterations, dataBlockRecords, currentState, baselineState, cycleInfo, maxIterations, store, inferenceFormat, seededQuads, log));
        callbacks?.onExecutionComplete?.(result);
        return result;
      }

      if (!currentState) {
        throw new Error('Rule set execution state failed to initialise');
      }
      let seenSignatures = new Map<string, number>();
      seenSignatures.set(`${currentState.hash}\n${tupleStore.signature()}`, 0);

      let executionFailed = false;

      // Stratified evaluation: each stratum runs to its *own* fixpoint before
      // the next one starts. Sorting `preparedRules` by stratum is not enough —
      // a rule guarded by `NOT` would otherwise fire on the first pass, when the
      // relation it negates is still being derived, and nothing here retracts.
      // See `docs/reference/srl-language.md`.
      //
      // A pass evaluates the active stratum and nothing else. A stratum that has
      // reached its fixpoint is finished: stratification admits no edge from a
      // higher stratum back to a lower one, so re-running it can only re-derive
      // what it has already derived. Not re-running it is the point of
      // stratifying, and it is what the spec's evaluation loop does — strata in
      // order, each to its fixpoint, never returning to a completed one.
      //
      // Within a stratum, a run-once (`SL.once`) rule fires on the pass that
      // activates its stratum and never again: it mints blank nodes or assigns
      // values, so a second firing would only add a differently-named copy of
      // what it already derived. `firedOnce` records the ones that have run.
      //
      // Strata are taken from the rules themselves rather than counted up from
      // zero: a gap in the numbering would otherwise spend a whole pass firing
      // nothing to discover that nobody lives there.
      const strata = [...new Set(preparedRules.map(rule => rule.stratum ?? 0))].sort((a, b) => a - b);
      let stratumCursor = 0;
      let activeStratum = strata[0]!;
      const firedOnce = new Set<number>();

      // The iteration budget is per stratum, not per run. Each stratum spends a
      // pass proving it has stopped deriving, so under one shared budget a
      // program with several strata could exhaust `maxIterations` while
      // converging perfectly normally, and the run would be reported as having
      // hit the limit. Per stratum the number means what a reader expects it to:
      // how far a single fixpoint may iterate.
      let iterationIndex = 0;
      let iterationsInStratum = 0;

      for (;;) {
        if (iterationsInStratum >= maxIterations) {
          status = 'maxIterations';
          break;
        }
        const stopped = stopReason();
        if (stopped) {
          return fail(stopped);
        }

        if (!currentState) {
          throw new Error('Rule set execution state became unavailable');
        }
        iterationIndex += 1;
        iterationsInStratum += 1;
        const iterationStartState: DatasetState = currentState;
        const startSignature = `${iterationStartState.hash}\n${tupleStore.signature()}`;
        callbacks?.onIterationStart?.({
          index: iterationIndex,
          signature: iterationStartState.hash,
          tripleCount: iterationStartState.tripleCount,
        });

        const iterationStartedAt = performance.now();
        const iterationRecord: IterationRecord = {
          index: iterationIndex,
          signature: iterationStartState.hash,
          tripleCount: iterationStartState.tripleCount,
          tupleCount: tupleStore.size,
          delta: 0,
          durationMs: 0,
          stratum: activeStratum,
          rules: [],
        };

        let stateBeforeRule: DatasetState = iterationStartState;

        for (let ruleOrder = 0; ruleOrder < preparedRules.length; ruleOrder += 1) {
          if ((preparedRules[ruleOrder]!.stratum ?? 0) !== activeStratum) {
            // Not this pass: a lower stratum is complete and can derive nothing
            // further, a higher one's turn has not come.
            continue;
          }
          if (preparedRules[ruleOrder]!.runOnce && firedOnce.has(ruleOrder)) {
            // `SL.once`: already evaluated for its stratum.
            continue;
          }
          const stopped = stopReason();
          if (stopped) {
            return fail(stopped);
          }

          const preparedRule = preparedRules[ruleOrder]!;
          const { record, nextState } = await runRule(
            executor,
            store,
            stateBeforeRule,
            preparedRule,
            timeoutMs,
            sampleLimit,
            tupleStore,
            trace,
          );
          if (preparedRule.runOnce) firedOnce.add(ruleOrder);

          iterationRecord.rules.push(record);
          callbacks?.onRuleResult?.({
            ...record,
            iteration: iterationIndex,
            ruleOrder: ruleOrder + 1,
          });

          if (record.error) {
            executionFailed = true;
          }

          if (nextState) stateBeforeRule = nextState;
        }

        // Under `trace` the last rule's capture is the iteration's end state;
        // otherwise this is the one capture the iteration makes.
        const iterationEndState: DatasetState = trace ? stateBeforeRule : captureDatasetState(store);
        currentState = iterationEndState;
        iterationRecord.signature = iterationEndState.hash;
        iterationRecord.tripleCount = iterationEndState.tripleCount;
        iterationRecord.tupleCount = tupleStore.size;
        iterationRecord.delta = iterationEndState.tripleCount - iterationStartState.tripleCount;
        iterationRecord.durationMs = performance.now() - iterationStartedAt;

        iterations.push(iterationRecord);
        callbacks?.onIterationComplete?.(iterationRecord);

        if (executionFailed) {
          status = 'failed';
          break;
        }

        // Convergence is over *every* relation the rules can write, not just the
        // RDF dataset: a pass whose only progress is tuple growth inserts no
        // triples and would otherwise read as a fixpoint.
        const endSignature = `${iterationEndState.hash}\n${tupleStore.signature()}`;
        if (endSignature === startSignature) {
          // This stratum has reached its own fixpoint. Only when the last one
          // has is the whole program at a fixpoint — see `activeStratum`.
          if (stratumCursor < strata.length - 1) {
            stratumCursor += 1;
            activeStratum = strata[stratumCursor]!;
            // A new fixpoint gets a fresh budget, and a fresh cycle history: the
            // signatures above were produced by a different set of rules, so a
            // repeat of one says nothing about this stratum looping.
            iterationsInStratum = 0;
            seenSignatures = new Map<string, number>();
            seenSignatures.set(endSignature, iterationIndex);
            // The record was pushed and reported above; advancing a stratum is
            // not a second iteration.
            continue;
          }
          status = 'converged';
          break;
        }

        const priorIndex = seenSignatures.get(endSignature);
        if (priorIndex !== undefined) {
          status = 'cycle';
          cycleInfo = { startIteration: priorIndex + 1, endIteration: iterationIndex };
          break;
        }

        seenSignatures.set(endSignature, iterationIndex);
      }

      if (!status) {
        // Unreachable: every exit above sets one. Here so the type stays honest.
        status = 'converged';
      }

      if (status === 'failed') {
        // The first rule that errored is the reason; the generic sentence is
        // the fallback for a failure no rule recorded.
        return fail(
          iterations.flatMap(i => i.rules).find(rule => rule.error)?.error?.message ?? 'Rule set execution failed',
          status,
        );
      }

      const result = withTuples(buildResult(status, iterations, dataBlockRecords, currentState, baselineState, cycleInfo, maxIterations, store, inferenceFormat, seededQuads, log));
      callbacks?.onExecutionComplete?.(result);
      return result;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

}

function seedTupleStore(
tupleStore: TupleStore,
ruleSetId: string,
seeds: string | null | undefined,
): string | null {
  // The host resolves which seeds apply: a run's own, or the version's.
  const text = (seeds ?? '').trim();
  if (!text) return null;
  try {
    for (const row of groundTupleSeedRows(parseTupleSeeds(text, { tuples: true }))) {
      tupleStore.add(row);
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `RuleSetVersion ${ruleSetId} has invalid initial named tuples: ${message}`;
  }
}


async function runDataBlock(
  executor: RuleExecutor,
  store: oxigraph.Store,
  block: PreparedDataBlock,
): Promise<DataBlockExecutionRecord> {
  const record: DataBlockExecutionRecord = {
    dataBlockVersionId: block.dataBlockVersionId,
    programSource: block.programSource,
    durationMs: 0,
    tripleDelta: 0,
  };
  if (block.program === null) {
    record.error = { message: block.missingContentMessage ?? `DataBlockVersion ${block.dataBlockVersionId} has no executable content` };
    return record;
  }
  const beforeSize = store.size;
  try {
    const { duration } = await executor.update(block.program);
    record.durationMs = duration ?? 0;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    record.error = { message: err.message, stack: err.stack };
    return record;
  }
  record.tripleDelta = store.size - beforeSize;
  return record;
}

async function runRule(
  executor: RuleExecutor,
  store: oxigraph.Store,
  beforeState: DatasetState,
  preparedRule: PreparedRule,
  timeoutMs: number,
  sampleLimit: number,
  tupleStore?: TupleStore,
  trace = true,
): Promise<{ record: RuleExecutionRecord; nextState: DatasetState | null }> {
  const record: RuleExecutionRecord = {
    ruleVersionId: preparedRule.ruleVersionId,
    ruleIri: preparedRule.ruleIri,
    stratum: preparedRule.stratum,
    programSource: preparedRule.source,
    durationMs: 0,
    triplesInserted: 0,
    triplesDeleted: 0,
    quadSamples: [],
    insertedQuads: [],
    deletedQuads: [],
    insertedTuples: [],
    timedOut: false,
  };

  const start = performance.now();
  const sizeBefore = store.size;
  let updateError: Error | undefined;
  // What the workspace held before this rule ran, so the rows it adds can be
  // attributed to it the same way inserted triples are.
  const tuplesBefore = tupleStore?.snapshot();

  // Tuple rules: inject VALUES for each body tuple read from the current store,
  // then either capture SELECT rows as tuples or run the UPDATE as usual.
  const tupleMeta = preparedRule.tuples;
  let program = preparedRule.program;
  if (tupleMeta && tupleStore && tupleMeta.reads.length > 0) {
    program = injectTupleReads(program, tupleStore);
  }

  try {
    if (tupleMeta?.producesTuples && tupleStore) {
      const { duration } = await captureTuples(executor, program, tupleMeta.writes, tupleStore);
      record.durationMs = duration ?? performance.now() - start;
    } else {
      const { duration } = await executor.update(program);
      record.durationMs = duration ?? performance.now() - start;
    }
  } catch (error) {
    updateError = error instanceof Error ? error : new Error(String(error));
    record.durationMs = performance.now() - start;
  }

  if (record.durationMs > timeoutMs) {
    record.timedOut = true;
    if (!updateError) {
      updateError = new Error(`Rule execution exceeded timeout (${timeoutMs}ms)`);
    }
  }

  record.insertedTuples = tupleStore && tuplesBefore
    ? tupleStore.addedSince(tuplesBefore).map(renderTupleRow)
    : [];

  let afterState: DatasetState | null = null;
  if (trace) {
    afterState = captureDatasetState(store);
    const diff = diffDatasetStates(beforeState, afterState, sampleLimit);
    record.triplesInserted = diff.insertedCount;
    record.triplesDeleted = diff.deletedCount;
    record.quadSamples = diff.sampledInserted;
    record.insertedQuads = diff.inserted;
    record.deletedQuads = diff.deleted;
  } else {
    const delta = store.size - sizeBefore;
    record.triplesInserted = Math.max(delta, 0);
    record.triplesDeleted = Math.max(-delta, 0);
  }

  if (updateError) {
    record.error = { message: updateError.message, stack: updateError.stack };
  }

  return { record, nextState: afterState };
}

/**
 * Run a tuple-producing rule's SELECT and append each solution row to the
 * tuple store as a grounded tuple.
 *
 * A row that leaves any template variable unbound is skipped: tuples must be
 * ground, so a partial binding cannot be stored.
 */
async function captureTuples(
  executor: RuleExecutor,
  program: string,
  writes: TupleRef[],
  tupleStore: TupleStore,
): Promise<{ duration?: number }> {
  const { result, duration } = await executor.selectQueryParsed(program);
  if (typeof result === 'string') return { duration };

  for (const binding of result.results?.bindings ?? []) {
    for (const ref of writes) {
      const row = TupleStore.rowFromTemplate(ref, (name) => {
        const value = binding[name] as SparqlJsonValue | undefined;
        return value ? renderBindingValue(value) : undefined;
      });
      if (row) tupleStore.add(row);
    }
  }
  return { duration };
}

function buildResult(
  status: ExecutionStatus,
  iterations: IterationRecord[],
  dataBlocks: DataBlockExecutionRecord[],
  finalState: DatasetState | null,
  baselineState: DatasetState | null,
  cycle: { startIteration: number; endIteration: number } | undefined,
  maxIterations: number,
  store: oxigraph.Store | null = null,
  inferenceFormat: string = 'application/n-triples',
  seededQuads?: string[],
  log: RuleRunLog = () => {},
): RuleSetExecutionResult {
  const result: RuleSetExecutionResult = {
    status,
    iterations,
    dataBlocks,
  };

  if (seededQuads) {
    result.seededQuads = seededQuads;
  }

  if (status !== 'failed' && finalState) {
    const baselineSet = baselineState?.keySet;
    const inferredKeys = baselineSet
      ? finalState.orderedKeys.filter((quad) => !baselineSet.has(quad))
      : finalState.orderedKeys.slice();
    const inferredGraph = inferredKeys.join('\n');

    result.finalGraphNQuads = inferredGraph;

    if (store) {
      try {
        const inferenceStore = new oxigraph.Store();
        if (inferredKeys.length > 0) {
          inferenceStore.load(inferredGraph, { format: 'application/n-quads' });
        }
        const serialized = serializeStore(inferenceStore, inferenceFormat);
        result.finalGraphContent = serialized.content;
        result.finalGraphContentType = serialized.contentType;
      } catch (error) {
        log('error', 'RuleSetExecutor: failed to serialize final graph', { err: error });
        result.finalGraphContent = inferredGraph;
        result.finalGraphContentType = 'application/n-triples';
      }
    }
  }

  if (status === 'cycle' && cycle) {
    result.cycle = cycle;
  }

  if (status === 'maxIterations') {
    result.maxIterations = maxIterations;
  }

  return result;
}

function serializeStore(store: oxigraph.Store, format: string): { content: string; contentType: string } {
  const normalised = normaliseContentType(format);

  // If N-Triples was requested but the dataset contains named graphs, fall back to N-Quads.
  if (normalised === 'application/n-triples') {
    const quads = store.match();
    const hasNamedGraphs = quads.some((q) => q.graph && q.graph.termType !== 'DefaultGraph');
    if (!hasNamedGraphs) {
      return { content: quads.map(quadToNQuad).join('\n'), contentType: 'application/n-triples' };
    }
    return serializeStore(store, 'application/n-quads');
  }

  const formatMap: Record<string, string> = {
    'application/n-quads': 'nq',
    'application/ld+json': 'jsonld',
  };

  const oxigraphFormat = formatMap[normalised] ?? 'nq';
  const content = store.dump({ format: oxigraphFormat });
  const contentType = normalised === 'application/ld+json' ? 'application/ld+json' : 'application/n-quads';
  return { content, contentType };
}

function normaliseContentType(format: string): string {
  if (!format) {
    return 'application/n-triples';
  }
  const [type] = format.split(';');
  return type.trim().toLowerCase() || 'application/n-triples';
}
/**
 * One tuple row as the language writes it: `TUPLE(<a>, <b>)`.
 *
 * Rows are stored as already-rendered SPARQL terms, so this is only the
 * punctuation — which is worth adding, because a bare list of terms on screen
 * is indistinguishable from a triple.
 */
function renderTupleRow(row: string[]): string {
  return `TUPLE(${row.join(', ')})`;
}

function captureDatasetState(store: oxigraph.Store): DatasetState {
  // Everything except the ground graph. That named graph is a frozen copy of
  // `G0 ∪ D` kept so `WHERE DATA` / `NOT DATA` have something to match against
  // (see `GROUND_GRAPH_IRI`); it is executor bookkeeping, not data. Counting it
  // would double every triple in the fixpoint's convergence check and emit the
  // whole input again as "inferred".
  const quads = store.match().filter(
    quad => !(quad.graph?.termType === 'NamedNode' && quad.graph.value === GROUND_GRAPH_IRI),
  );
  const quadStrings = quads.map(quadToNQuad);

  // Lexically sorted raw quads, blank-node labels and all. Canonicalising here
  // (an option this used to carry) is wrong twice over: RDFC-1.1 labels are
  // assigned over the whole dataset, so inserting one triple can relabel
  // pre-existing blank nodes — which makes the per-rule diff below report
  // phantom inserts and deletes, and makes `final − baseline` in `buildResult`
  // hand back base-graph triples as "inferred". Graph isomorphism belongs where
  // two *finished* graphs are compared (`testComparators.compareGraphs`), never
  // inside the fixpoint loop.
  const orderedKeys = quadStrings.slice().sort();

  const hasher = createHash('sha256');
  for (const key of orderedKeys) {
    hasher.update(key);
    hasher.update('\n');
  }
  return {
    hash: hasher.digest('hex'),
    tripleCount: orderedKeys.length,
    orderedKeys,
    keySet: new Set(orderedKeys),
  };
}

function diffDatasetStates(before: DatasetState, after: DatasetState, sampleLimit: number): {
  insertedCount: number;
  deletedCount: number;
  sampledInserted: string[];
  inserted: string[];
  deleted: string[];
} {
  const inserted: string[] = [];
  const deleted: string[] = [];

  for (const key of after.orderedKeys) {
    if (!before.keySet.has(key)) {
      inserted.push(key);
    }
  }

  for (const key of before.orderedKeys) {
    if (!after.keySet.has(key)) {
      deleted.push(key);
    }
  }

  return {
    insertedCount: inserted.length,
    deletedCount: deleted.length,
    sampledInserted: inserted.slice(0, sampleLimit),
    inserted,
    deleted,
  };
}
