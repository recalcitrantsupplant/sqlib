/**
 * Run a stored rule set version, as the API does.
 *
 * The evaluation itself — DATA blocks, then each stratum to its fixpoint —
 * lives in `@sparql-query-lib/runtime-srl`, so the API and the CLI run one
 * implementation. This module is the API's host for it: it reads rule and
 * DATA block versions from the entity cache, validates and stratifies them,
 * applies this deployment's limits and deadline, and runs on a managed
 * ephemeral store through the API's own Oxigraph executor.
 */
import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { PersistedRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import { PersistedDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import { PersistedRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import { oxigraphStoreManager } from './OxigraphStoreManager.js';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import { RuleStratifier, type StratificationReport, type MonotonicityKind } from './RuleStratifier.js';
import { RuleGrammarValidator } from './RuleGrammarValidator.js';
import {
  compileRule as compileSrlRule,
  parseRuleSet as parseSrl,
  expandIris,
} from '@sparql-query-lib/srl';
import {
  RuleSetRunner,
  type PreparedDataBlock,
  type PreparedRule,
  type ProgramSource,
  type RuleSetExecutionCallbacks,
  type RuleSetExecutionResult,
} from '@sparql-query-lib/runtime-srl';
import { log } from './log.js';
import { abortReason, executionSignal } from './cancellation.js';
import { executionDeadlineMs, maxRuleIterations } from '../config/executionLimits.js';
import { RULE_AGGREGATES_DISABLED_MESSAGE, ruleAggregatesAllowed, usesRuleAggregates } from './ruleAggregates.js';

export type {
  DataBlockExecutionRecord,
  IterationRecord,
  RuleExecutionRecord,
  RuleSetExecutionCallbacks,
  RuleSetExecutionResult,
} from '@sparql-query-lib/runtime-srl';

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_RULE_TIMEOUT_MS = Number.parseInt(process.env.RULE_EXECUTION_TIMEOUT_MS ?? '30000', 10) || 30000;
const DEFAULT_RULE_SAMPLE_LIMIT = Number.parseInt(process.env.RULE_EXECUTION_SAMPLE_LIMIT ?? '10', 10) || 10;

export interface RuleSetExecutionOptions {
  maxIterations?: number;
  timeoutMs?: number;
  sampleLimit?: number;
  inferenceFormat?: string;
  callbacks?: RuleSetExecutionCallbacks;
  shouldAbort?: () => boolean;
  /** Stops the run before its next rule or DATA block. */
  signal?: AbortSignal;
  /**
   * The most the whole run may take, in milliseconds; `0` for none. Defaults
   * to `SQLIB_EXECUTION_TIMEOUT_MS`. Distinct from `timeoutMs`, which judges
   * each rule after it has run: this is checked *before* each rule, so a run
   * past its deadline starts nothing further.
   */
  deadlineMs?: number;
  /**
   * Record which quads each rule inserted and deleted.
   *
   * That costs a capture (and hash) of the whole dataset after every rule of
   * every iteration, and a full quad diff per rule in the result — the price of
   * a trace someone is going to read, and nothing a caller that only wants the
   * inferred graph should pay. Without it the dataset is captured once per
   * iteration, which is all fixpoint detection needs, and a rule's record
   * carries its net triple delta and no quads.
   */
  trace?: boolean;
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

  async execute(ruleSetVersion: PersistedRuleSetVersion, options: RuleSetExecutionOptions = {}): Promise<RuleSetExecutionResult> {
    // Whatever a caller asks for, never past the deployment's cap.
    const maxIterations = Math.min(options.maxIterations ?? DEFAULT_MAX_ITERATIONS, maxRuleIterations());
    const stop = executionSignal(options.signal, options.deadlineMs ?? executionDeadlineMs());
    const storeId = `${mintId('ruleset')}:exec`;
    const store = oxigraphStoreManager.createEphemeralStore(storeId);
    const ruleIds = normalizeIdList(ruleSetVersion.hasRule);
    const dataBlockIds = normalizeIdList(ruleSetVersion.hasDataBlock);

    try {
      return await new RuleSetRunner().run(
        {
          id: ruleSetVersion.$id,
          ruleCount: ruleIds.length,
          dataBlockCount: dataBlockIds.length,
          /*
           * Whether the rules can run at all is settled before anything
           * touches the store: an invalid rule or a rule set that does not
           * stratify refuses the whole set, and nothing is seeded.
           */
          prepareRules: () => {
            const loadedRules = this.loadRuleVersions(ruleIds);
            const invalidRules = loadedRules.ruleVersions.filter(rv => rv.grammarValid === false);
            if (invalidRules.length > 0) {
              throw new Error(`RuleSet contains invalid RuleVersions: ${invalidRules.map(rv => rv.$id).join(', ')}`);
            }
            const stratification = this.resolveStratification(ruleSetVersion, loadedRules.ruleVersions);
            return this.applyStrata(loadedRules.prepared, stratification);
          },
          prepareDataBlocks: () => {
            const dataBlocks = this.loadDataBlockVersions(dataBlockIds);
            const invalidDataBlocks = dataBlocks.filter(db => db.grammarValid === false);
            if (invalidDataBlocks.length > 0) {
              throw new Error(`RuleSet contains invalid DataBlockVersions: ${invalidDataBlocks.map(db => db.$id).join(', ')}`);
            }
            return dataBlocks.map(version => this.prepareDataBlock(version));
          },
          // An empty string is a deliberate "no rows", distinct from an absent
          // override meaning "use what the version stored".
          tupleSeeds: options.tupleSeeds !== undefined && options.tupleSeeds !== null
            ? options.tupleSeeds
            : (ruleSetVersion.tupleSeeds ?? ''),
        },
        {
          maxIterations,
          timeoutMs: options.timeoutMs ?? DEFAULT_RULE_TIMEOUT_MS,
          sampleLimit: options.sampleLimit ?? DEFAULT_RULE_SAMPLE_LIMIT,
          inferenceFormat: options.inferenceFormat ?? 'application/n-triples',
          callbacks: options.callbacks,
          shouldAbort: options.shouldAbort,
          signal: stop.signal,
          abortError: abortReason,
          trace: options.trace,
          initialGraph: options.initialGraph,
          initialGraphFormat: options.initialGraphFormat,
          store,
          executor: new OxigraphSparqlExecutor(store),
          // The runner loads into the store it was given, which is \`store\`;
          // using it here keeps the oxigraph type the manager takes.
          loadGraph: (_target, data, format) => oxigraphStoreManager.loadDataFromString(store, data, format),
          log: (level, message, context) => log[level](context ?? {}, message),
        },
      );
    } finally {
      stop.dispose();
      oxigraphStoreManager.destroyEphemeralStore(storeId);
    }
  }

  /** A DATA block's program, or why it has none, for the runner to apply. */
  private prepareDataBlock(version: PersistedDataBlockVersion): PreparedDataBlock {
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
      log.error({ dataBlockVersionId: version.$id, ...debugInfo }, 'RuleSetExecutor: DataBlockVersion missing content');
      return {
        dataBlockVersionId: version.$id,
        programSource: version.normalizedInsertData ? 'normalized' : 'raw',
        program: null,
        missingContentMessage: `DataBlockVersion ${version.$id} has no executable content (dataString: ${debugInfo.hasDataString ? `${debugInfo.dataStringLength} chars` : 'null'}, normalized: ${debugInfo.hasNormalized ? `${debugInfo.normalizedLength} chars` : 'null'})`,
      };
    }
    return { dataBlockVersionId: version.$id, programSource: normalized.source, program: normalized.program };
  }

  private loadDataBlockVersions(ids: string[]): PersistedDataBlockVersion[] {
    const versions: PersistedDataBlockVersion[] = [];
    for (const id of ids) {
      const entity = getCacheCoordinator().get(id);
      if (!entity) {
        log.warn({ dataBlockVersionId: id }, 'RuleSetExecutor: DataBlockVersion not found in cache; skipping');
        continue;
      }

      // Validate entity type to catch configuration errors
      const entityType = entity['@type'];
      if (entityType !== 'DataBlockVersion') {
        log.error(
          { id, entityType },
          'RuleSetExecutor: expected a DataBlockVersion; RuleSets must reference DataBlockVersions, not DataBlocks',
        );
        throw new Error(`Invalid entity type for ${id}: expected DataBlockVersion, got ${entityType}. RuleSets must reference version entities for immutable execution.`);
      }

      versions.push(entity as PersistedDataBlockVersion);
    }
    return versions;
  }

  private resolveStratification(ruleSetVersion: PersistedRuleSetVersion, ruleVersions: PersistedRuleVersion[]): StratificationReport | undefined {
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
          log.info('RuleSetExecutor: stratificationReport predates run-once scheduling; recomputing');
          return null;
        }
        return parsed;
      }
    } catch (error) {
      log.warn({ err: error }, 'RuleSetExecutor: failed to parse stratificationReport; will recompute');
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

  private loadRuleVersions(ids: string[]): { prepared: PreparedRule[]; ruleVersions: PersistedRuleVersion[] } {
    const prepared: PreparedRule[] = [];
    const ruleVersions: PersistedRuleVersion[] = [];
    for (const id of ids) {
      const entity = getCacheCoordinator().get(id);
      if (!entity) {
        log.warn({ ruleVersionId: id }, 'RuleSetExecutor: RuleVersion not found in cache; skipping');
        continue;
      }

      // Validate entity type to catch configuration errors
      const entityType = entity['@type'];
      if (entityType !== 'RuleVersion') {
        log.error(
          { id, entityType },
          'RuleSetExecutor: expected a RuleVersion; RuleSets must reference RuleVersions, not Rules',
        );
        throw new Error(`Invalid entity type for ${id}: expected RuleVersion, got ${entityType}. RuleSets must reference version entities for immutable execution.`);
      }

      const ruleVersion = entity as PersistedRuleVersion;
      ruleVersions.push(ruleVersion);
      const preparedRule = this.prepareRule(ruleVersion);
      if (preparedRule) {
        prepared.push(preparedRule);
      }
    }
    return { prepared, ruleVersions };
  }

  private prepareRule(ruleVersion: PersistedRuleVersion): PreparedRule | null {
    // A rule saved with the rule-aggregates extension on keeps its compiled
    // program after the flag goes off. Refuse it by name rather than running a
    // program this deployment no longer offers, or dropping it silently.
    if (!ruleAggregatesAllowed() && usesRuleAggregates(ruleVersion.ruleString ?? '')) {
      throw new Error(`RuleVersion ${ruleVersion.$id} ${RULE_AGGREGATES_DISABLED_MESSAGE}`);
    }
    // Tuple rules must be compiled from source: their program carries VALUES
    // placeholders plus read/write metadata that a stored `normalizedInsert`
    // cannot express.
    const tupleCompiled = this.compileTupleRule(ruleVersion);
    if (tupleCompiled) return tupleCompiled;

    const normalized = this.normalizeRuleContent(ruleVersion.ruleString, ruleVersion.normalizedInsert);
    if (!normalized) {
      log.warn({ ruleVersionId: ruleVersion.$id }, 'RuleSetExecutor: RuleVersion has no executable content; skipping');
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
  private compileTupleRule(ruleVersion: PersistedRuleVersion): PreparedRule | null {
    const source = (ruleVersion.ruleString ?? '').trim();
    if (!source || !/\bTUPLE\s*\(/i.test(source)) return null;
    try {
      const ruleSet = expandIris(parseSrl(source, { tuples: true, aggregates: ruleAggregatesAllowed() }));
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
      log.warn(
        { err: error, ruleVersionId: ruleVersion.$id },
        'RuleSetExecutor: RuleVersion looks like a tuple rule but failed to compile',
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
function declaredRuleIri(ruleVersion: PersistedRuleVersion): string | undefined {
  const source = (ruleVersion.ruleString ?? '').trim();
  if (!source) return undefined;
  try {
    return expandIris(parseSrl(source, { tuples: true, aggregates: ruleAggregatesAllowed() })).rules[0]?.name;
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

