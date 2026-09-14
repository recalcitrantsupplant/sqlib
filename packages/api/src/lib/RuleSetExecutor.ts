import { createHash } from 'node:crypto';
import * as oxigraph from 'oxigraph';
import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import { LdkitDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import { oxigraphStoreManager } from './OxigraphStoreManager.js';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import { RuleStratifier, type StratificationReport, type MonotonicityKind } from './RuleStratifier.js';
import { RuleGrammarValidator } from './RuleGrammarValidator.js';
import {
  compileRule as compileSrlRule,
  parseRuleSet as parseSrl,
  expandIris,
  GROUND_GRAPH_IRI,
  groundTupleSeedRows,
  parseTupleSeeds,
  type TupleRef,
} from '@sparql-query-lib/srl';
import { TupleStore, injectTupleReads, renderBindingValue } from './TupleStore.js';
import { quadToNQuad } from './nquads.js';

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_RULE_TIMEOUT_MS = Number.parseInt(process.env.RULE_EXECUTION_TIMEOUT_MS ?? '30000', 10) || 30000;
const DEFAULT_RULE_SAMPLE_LIMIT = Number.parseInt(process.env.RULE_EXECUTION_SAMPLE_LIMIT ?? '10', 10) || 10;

type ProgramSource = 'normalized' | 'raw';
type ExecutionStatus = 'converged' | 'cycle' | 'maxIterations' | 'failed';

type SerializedError = { message: string; stack?: string };

interface PreparedRule {
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
  triplesInserted: number;
  triplesDeleted: number;
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

export interface RuleSetExecutionOptions {
  maxIterations?: number;
  timeoutMs?: number;
  sampleLimit?: number;
  inferenceFormat?: string;
  callbacks?: RuleSetExecutionCallbacks;
  shouldAbort?: () => boolean;
  initialGraph?: string | null;
  /**
   * How to read `initialGraph`. Query-group chaining hands over N-Triples,
   * which is why that was hardcoded; a registered data graph is authored as
   * Turtle as often as not, so the format travels with the content.
   */
  initialGraphFormat?: string | null;
  /**
   * Rows for this run, overriding the version's stored `tupleSeeds`.
   *
   * A rule set's tabular input is an *argument*: the same relationship an
   * argument set has to a query. It was stored on the version and nowhere else,
   * so varying it per run meant saving a new version. Absent here, the stored
   * seeds run exactly as before. See `lib/tupleSeedInput.ts`.
   */
  tupleSeeds?: string | null;
}

export class RuleSetExecutor {
  private ruleValidator = new RuleGrammarValidator();

  async execute(ruleSetVersion: LdkitRuleSetVersion, options: RuleSetExecutionOptions = {}): Promise<RuleSetExecutionResult> {
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_RULE_TIMEOUT_MS;
    const sampleLimit = options.sampleLimit ?? DEFAULT_RULE_SAMPLE_LIMIT;
    const inferenceFormat = options.inferenceFormat ?? 'application/n-triples';
    const callbacks = options.callbacks;
    const shouldAbort = options.shouldAbort ?? (() => false);

    const dataBlockRecords: DataBlockExecutionRecord[] = [];
    const iterations: IterationRecord[] = [];
    let currentState: DatasetState | null = null;
    let baselineState: DatasetState | null = null;
    let cycleInfo: { startIteration: number; endIteration: number } | undefined;
    let status: ExecutionStatus | null = null;
    // Assigned once the DATA blocks have run; a failure before that leaves it
    // undefined, which is the honest answer rather than an empty list.
    let seededQuads: string[] | undefined;

    const storeId = `${mintId('ruleset')}:exec`;
    const store = oxigraphStoreManager.createEphemeralStore(storeId);
    const executor = new OxigraphSparqlExecutor(store);
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
        ...withTuples(this.buildResult(failStatus, iterations, dataBlockRecords, currentState, baselineState, cycleInfo, maxIterations, store, inferenceFormat, seededQuads)),
        error: message,
      };
    };

    try {
      const ruleIds = normalizeIdList(ruleSetVersion.hasRule);
      const dataBlockIds = normalizeIdList(ruleSetVersion.hasDataBlock);

      callbacks?.onExecutionStart?.({
        ruleSetVersionId: ruleSetVersion.$id,
        totalRules: ruleIds.length,
        totalDataBlocks: dataBlockIds.length,
      });

      // Seed the tuple store with the ruleset's initial named tuples, before
      // anything runs. Without this a tuple relation can only ever be derived
      // by some rule head — never *given* — so a ruleset cannot take a tuple as
      // input. Rows carrying variables are declarations of inputs a caller
      // supplies, not values, so only ground rows are seeded.
      const seedFailure = this.seedTupleStore(tupleStore, ruleSetVersion, options.tupleSeeds);
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
        await oxigraphStoreManager.loadDataFromString(store, initialGraph, options.initialGraphFormat || 'ntriples');
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
      const dataBlocks = this.loadDataBlockVersions(dataBlockIds);
      const invalidDataBlocks = dataBlocks.filter(db => db.grammarValid === false);
      if (invalidDataBlocks.length > 0) {
        const message = `RuleSet contains invalid DataBlockVersions: ${invalidDataBlocks.map(db => db.$id).join(', ')}`;
        return fail(message);
      }
      for (let idx = 0; idx < dataBlocks.length; idx += 1) {
        if (shouldAbort()) {
          return fail('Execution aborted by caller');
        }

        const record = await this.runDataBlock(executor, store, dataBlocks[idx]!);
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

      const loadedRules = this.loadRuleVersions(ruleIds);
      const invalidRules = loadedRules.ruleVersions.filter(rv => rv.grammarValid === false);
      if (invalidRules.length > 0) {
        const message = `RuleSet contains invalid RuleVersions: ${invalidRules.map(rv => rv.$id).join(', ')}`;
        return fail(message);
      }
      const stratification = this.resolveStratification(ruleSetVersion, loadedRules.ruleVersions);
      const preparedRules = this.applyStrata(loadedRules.prepared, stratification);

      if (preparedRules.length === 0) {
        const result = withTuples(this.buildResult('converged', iterations, dataBlockRecords, currentState, baselineState, cycleInfo, maxIterations, store, inferenceFormat, seededQuads));
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
        if (shouldAbort()) {
          return fail('Execution aborted by caller');
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
          if (shouldAbort()) {
            return fail('Execution aborted by caller');
          }

          const preparedRule = preparedRules[ruleOrder]!;
          const { record, nextState } = await this.runRule(
            executor,
            store,
            stateBeforeRule,
            preparedRule,
            timeoutMs,
            sampleLimit,
            tupleStore,
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

          stateBeforeRule = nextState;
        }

        const iterationEndState: DatasetState = stateBeforeRule;
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

      const result = withTuples(this.buildResult(status, iterations, dataBlockRecords, currentState, baselineState, cycleInfo, maxIterations, store, inferenceFormat, seededQuads));
      callbacks?.onExecutionComplete?.(result);
      return result;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    } finally {
      oxigraphStoreManager.destroyEphemeralStore(storeId);
    }
  }

  /**
   * Seed the tuple store from the version's `tupleSeeds` document.
   *
   * Returns an error message when the document does not parse, `null` on
   * success (including the common case of no seeds at all). A malformed seed
   * document fails the execution rather than being skipped: silently running
   * with an empty store would turn every tuple premise vacuous, which is a
   * wrong answer rather than a missing one.
   */
  private seedTupleStore(
    tupleStore: TupleStore,
    ruleSetVersion: LdkitRuleSetVersion,
    override?: string | null,
  ): string | null {
    // An empty string is a deliberate "no rows", distinct from an absent
    // override meaning "use what the version stored".
    const source = override !== undefined && override !== null ? override : (ruleSetVersion.tupleSeeds ?? '');
    const text = source.trim();
    if (!text) return null;
    try {
      for (const row of groundTupleSeedRows(parseTupleSeeds(text, { tuples: true }))) {
        tupleStore.add(row);
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `RuleSetVersion ${ruleSetVersion.$id} has invalid initial named tuples: ${message}`;
    }
  }

  private loadDataBlockVersions(ids: string[]): LdkitDataBlockVersion[] {
    const versions: LdkitDataBlockVersion[] = [];
    for (const id of ids) {
      const entity = getCacheCoordinator().get(id);
      if (!entity) {
        console.warn(`[RuleSetExecutor] DataBlockVersion ${id} not found in cache; skipping.`);
        continue;
      }

      // Validate entity type to catch configuration errors
      const entityType = entity['@type'];
      if (entityType !== 'DataBlockVersion') {
        console.error(`[RuleSetExecutor] ERROR: Entity ${id} has type '${entityType}', expected 'DataBlockVersion'. RuleSets must reference DataBlockVersions, not DataBlocks!`);
        throw new Error(`Invalid entity type for ${id}: expected DataBlockVersion, got ${entityType}. RuleSets must reference version entities for immutable execution.`);
      }

      versions.push(entity as LdkitDataBlockVersion);
    }
    return versions;
  }

  private resolveStratification(ruleSetVersion: LdkitRuleSetVersion, ruleVersions: LdkitRuleVersion[]): StratificationReport | undefined {
    if (!ruleVersions || ruleVersions.length === 0) return undefined;
    const parsed = this.parseStratificationReport(ruleSetVersion.stratificationReport ?? undefined);
    const stratifier = new RuleStratifier();
    const report = parsed ?? stratifier.analyzeRuleVersions(ruleVersions);
    if (report.issues && report.issues.length > 0) {
      throw new Error(`RuleSetVersion ${ruleSetVersion.$id} is not stratifiable: ${report.issues.join('; ')}`);
    }
    return report;
  }

  private parseStratificationReport(report?: string | null): StratificationReport | null {
    if (!report) return null;
    try {
      const parsed = JSON.parse(report) as StratificationReport;
      if (parsed && typeof parsed === 'object') {
        if (parsed.runOnce === undefined) {
          // Written before run-once scheduling existed, so its strata predate
          // closed-edge promotion too: reusing it would keep executing the rule
          // set the old, wrong way. Recompute rather than trust the snapshot.
          console.info('[RuleSetExecutor] stratificationReport predates run-once scheduling; recomputing');
          return null;
        }
        return parsed;
      }
    } catch (error) {
      console.warn('[RuleSetExecutor] Failed to parse stratificationReport; will recompute', error);
    }
    return null;
  }

  private applyStrata(prepared: PreparedRule[], stratification?: StratificationReport): PreparedRule[] {
    if (!stratification) {
      return prepared.map(rule => ({ ...rule, stratum: 0, monotonicity: 'monotone', runOnce: false }));
    }
    const strata = stratification.strata || {};
    const mono = stratification.monotonicity || {};
    // Reports persisted before run-once scheduling existed have no `runOnce`;
    // absent means "iterate", which is what those reports were executed under.
    const runOnce = stratification.runOnce || {};
    const annotated = prepared.map(rule => ({
      ...rule,
      stratum: strata[rule.ruleVersionId] ?? 0,
      monotonicity: (mono as Record<string, MonotonicityKind>)[rule.ruleVersionId] ?? 'monotone',
      runOnce: runOnce[rule.ruleVersionId] === true,
    }));
    // Within a stratum the run-once rules go first: the spec evaluates `SL.once`
    // for the stratum, then iterates `SL.general` to its fixpoint, so the
    // general rules see the once-rules' output on their very first pass.
    annotated.sort((a, b) => (a.stratum ?? 0) - (b.stratum ?? 0) || Number(b.runOnce) - Number(a.runOnce));
    return annotated;
  }

  private loadRuleVersions(ids: string[]): { prepared: PreparedRule[]; ruleVersions: LdkitRuleVersion[] } {
    const prepared: PreparedRule[] = [];
    const ruleVersions: LdkitRuleVersion[] = [];
    for (const id of ids) {
      const entity = getCacheCoordinator().get(id);
      if (!entity) {
        console.warn(`[RuleSetExecutor] RuleVersion ${id} not found in cache; skipping.`);
        continue;
      }

      // Validate entity type to catch configuration errors
      const entityType = entity['@type'];
      if (entityType !== 'RuleVersion') {
        console.error(`[RuleSetExecutor] ERROR: Entity ${id} has type '${entityType}', expected 'RuleVersion'. RuleSets must reference RuleVersions, not Rules!`);
        throw new Error(`Invalid entity type for ${id}: expected RuleVersion, got ${entityType}. RuleSets must reference version entities for immutable execution.`);
      }

      const ruleVersion = entity as LdkitRuleVersion;
      ruleVersions.push(ruleVersion);
      const preparedRule = this.prepareRule(ruleVersion);
      if (preparedRule) {
        prepared.push(preparedRule);
      }
    }
    return { prepared, ruleVersions };
  }

  private prepareRule(ruleVersion: LdkitRuleVersion): PreparedRule | null {
    // Tuple rules must be compiled from source: their program carries VALUES
    // placeholders plus read/write metadata that a stored `normalizedInsert`
    // cannot express.
    const tupleCompiled = this.compileTupleRule(ruleVersion);
    if (tupleCompiled) return tupleCompiled;

    const normalized = this.normalizeRuleContent(ruleVersion.ruleString, ruleVersion.normalizedInsert);
    if (!normalized) {
      console.warn(`[RuleSetExecutor] RuleVersion ${ruleVersion.$id} has no executable content; skipping.`);
      return null;
    }

    return {
      ruleVersionId: ruleVersion.$id,
      ruleIri: declaredRuleIri(ruleVersion),
      program: normalized.program,
      source: normalized.source,
    };
  }

  /**
   * Compile a rule that uses the rule-tuples extension, or return null when it
   * does not (or cannot be parsed as SRL, in which case the normal path applies).
   */
  private compileTupleRule(ruleVersion: LdkitRuleVersion): PreparedRule | null {
    const source = (ruleVersion.ruleString ?? '').trim();
    if (!source || !/\bTUPLE\s*\(/i.test(source)) return null;
    try {
      const ruleSet = expandIris(parseSrl(source, { tuples: true }));
      const rule = ruleSet.rules[0];
      if (!rule) return null;
      const compiled = compileSrlRule(rule, ruleSet.prologueText);
      if (compiled.tupleReads.length === 0 && compiled.tupleWrites.length === 0) return null;
      return {
        ruleVersionId: ruleVersion.$id,
        ruleIri: rule.name,
        program: compiled.program,
        source: 'normalized',
        tuples: {
          reads: compiled.tupleReads,
          writes: compiled.tupleWrites,
          producesTuples: compiled.producesTuples,
        },
      };
    } catch (error) {
      console.warn(
        `[RuleSetExecutor] RuleVersion ${ruleVersion.$id} looks like a tuple rule but failed to compile: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private normalizeRuleContent(rawContent?: string | null, normalizedContent?: string | null): { program: string; source: ProgramSource } | null {
    const normalized = (normalizedContent ?? '').trim();
    if (normalized) {
      return { program: this.ensureTrailingSemicolon(normalized), source: 'normalized' };
    }

    const source = (rawContent ?? '').trim();
    if (!source) {
      return null;
    }

    const validation = this.ruleValidator.validateWithAllGrammars(source);
    if (validation.valid && validation.normalized) {
      return { program: this.ensureTrailingSemicolon(validation.normalized), source: 'normalized' };
    }

    return { program: this.ensureTrailingSemicolon(source), source: 'raw' };
  }

  private ensureTrailingSemicolon(program: string): string {
    return program.endsWith(';') ? program : `${program};`;
  }

  private async runDataBlock(
    executor: OxigraphSparqlExecutor,
    store: oxigraph.Store,
    version: LdkitDataBlockVersion,
  ): Promise<DataBlockExecutionRecord> {
    const record: DataBlockExecutionRecord = {
      dataBlockVersionId: version.$id,
      programSource: version.normalizedInsertData ? 'normalized' : 'raw',
      durationMs: 0,
      tripleDelta: 0,
    };

    const normalized = this.normalizeRuleContent(version.dataString, version.normalizedInsertData);
    if (!normalized) {
      // Enhanced error message with debugging info
      const debugInfo = {
        hasNormalized: !!version.normalizedInsertData,
        normalizedLength: version.normalizedInsertData?.length ?? 0,
        hasDataString: !!version.dataString,
        dataStringLength: version.dataString?.length ?? 0,
        dataStringPreview: version.dataString?.substring(0, 100) ?? '(null)',
      };
      console.error(`[RuleSetExecutor] DataBlockVersion ${version.$id} missing content:`, debugInfo);
      record.error = {
        message: `DataBlockVersion ${version.$id} has no executable content (dataString: ${debugInfo.hasDataString ? `${debugInfo.dataStringLength} chars` : 'null'}, normalized: ${debugInfo.hasNormalized ? `${debugInfo.normalizedLength} chars` : 'null'})`
      };
      return record;
    }

    const program = normalized.program;
    record.programSource = normalized.source;

    const beforeSize = store.size;

    try {
      const { duration } = await executor.update(program);
      record.durationMs = duration ?? 0;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      record.error = { message: err.message, stack: err.stack };
      return record;
    }

    record.tripleDelta = store.size - beforeSize;

    return record;
  }

  private async runRule(
    executor: OxigraphSparqlExecutor,
    store: oxigraph.Store,
    beforeState: DatasetState,
    preparedRule: PreparedRule,
    timeoutMs: number,
    sampleLimit: number,
    tupleStore?: TupleStore,
  ): Promise<{ record: RuleExecutionRecord; nextState: DatasetState }> {
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
        const { duration } = await this.captureTuples(executor, program, tupleMeta.writes, tupleStore);
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

    const afterState = captureDatasetState(store);
    const diff = diffDatasetStates(beforeState, afterState, sampleLimit);

    record.insertedTuples = tupleStore && tuplesBefore
      ? tupleStore.addedSince(tuplesBefore).map(renderTupleRow)
      : [];

    record.triplesInserted = diff.insertedCount;
    record.triplesDeleted = diff.deletedCount;
    record.quadSamples = diff.sampledInserted;
    record.insertedQuads = diff.inserted;
    record.deletedQuads = diff.deleted;

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
  private async captureTuples(
    executor: OxigraphSparqlExecutor,
    program: string,
    writes: TupleRef[],
    tupleStore: TupleStore,
  ): Promise<{ duration?: number }> {
    const { result, duration } = await executor.selectQueryParsed(program);
    if (typeof result === 'string') return { duration };

    for (const binding of result.results?.bindings ?? []) {
      for (const ref of writes) {
        const row = TupleStore.rowFromTemplate(ref, (name) => {
          const value = (binding as Record<string, any>)[name];
          return value ? renderBindingValue(value) : undefined;
        });
        if (row) tupleStore.add(row);
      }
    }
    return { duration };
  }

  private buildResult(
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
          const serialized = this.serializeStore(inferenceStore, inferenceFormat);
          result.finalGraphContent = serialized.content;
          result.finalGraphContentType = serialized.contentType;
        } catch (error) {
          console.error('Failed to serialize final graph:', error);
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

  private serializeStore(store: oxigraph.Store, format: string): { content: string; contentType: string } {
    const normalised = this.normaliseContentType(format);

    // If N-Triples was requested but the dataset contains named graphs, fall back to N-Quads.
    if (normalised === 'application/n-triples') {
      const quads = store.match();
      const hasNamedGraphs = quads.some((q) => q.graph && q.graph.termType !== 'DefaultGraph');
      if (!hasNamedGraphs) {
        return { content: quads.map(quadToNQuad).join('\n'), contentType: 'application/n-triples' };
      }
      return this.serializeStore(store, 'application/n-quads');
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

  private normaliseContentType(format: string): string {
    if (!format) {
      return 'application/n-triples';
    }
    const [type] = format.split(';');
    return type.trim().toLowerCase() || 'application/n-triples';
  }
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

/**
 * The IRI the author gave a rule in its SRL (`RULE <iri> { … }`), or undefined.
 *
 * Parsed rather than pattern-matched because the name may be written as a
 * prefixed name against the rule's own prologue; `expandIris` is what settles
 * it, exactly as `splitRuleSet` does when computing a rule's stored identity.
 * A rule that will not parse simply has no declared IRI — execution falls back
 * to the entity id, and the parse failure surfaces on the paths that report it.
 */
function declaredRuleIri(ruleVersion: LdkitRuleVersion): string | undefined {
  const source = (ruleVersion.ruleString ?? '').trim();
  if (!source) return undefined;
  try {
    return expandIris(parseSrl(source, { tuples: true })).rules[0]?.name;
  } catch {
    return undefined;
  }
}

function normalizeIdList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  return [String(value)];
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
