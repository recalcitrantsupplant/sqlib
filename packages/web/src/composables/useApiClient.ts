// @ts-ignore - Nuxt auto-imports
import { useRuntimeConfig, createError } from '#imports';
import { z } from 'zod';
import { useAuth } from './useAuth';
import { clientId } from '../lib/clientId';
import { debug } from '../lib/debug';
import { filenameFromDisposition } from '../lib/downloadFile';
import { discoverQueryVersionPrefixes } from '../lib/queryVersionPrefixes';
import { useBrowserBackends } from './useBrowserBackends';
import { executeOnBrowserBackend, looksLikeUpdate } from '../lib/browserBackendExecution';
import {
  backendSchema,
  backendCreateSchema,
  backendUpdateSchema,
  type Backend,
  type BackendCreate,
  type BackendUpdate,
  librarySchema,
  libraryCreateSchema,
  libraryUpdateSchema,
  type Library,
  type LibraryCreateInput,
  type LibraryUpdateInput,
  querySchema,
  queryCreateSchema,
  queryUpdateSchema,
  type Query,
  type QueryCreateInput,
  type QueryUpdateInput,
  queryVersionSchema,
  queryVersionForQueryCreateSchema,
  queryVersionExpandedSchema,
  queryVersionExpandedWithIriMapSchema,
  queryVersionPatchSchema,
  type QueryVersion,
  type QueryVersionForQueryCreateInput,
  type QueryVersionExpanded,
  type QueryVersionExpandedWithIriMap,
  type QueryVersionPatchInput,
  queryGroupSchema,
  queryGroupCreateSchema,
  queryGroupUpdateSchema,
  type QueryGroup,
  type QueryGroupCreateInput,
  type QueryGroupUpdateInput,
  queryGroupVersionSchema,
  queryGroupVersionForGroupCreateSchema,
  queryGroupVersionExpandedSchema,
  queryGroupVersionExpandedWithIriMapSchema,
  queryGroupVersionPatchSchema,
  type QueryGroupVersion,
  type QueryGroupVersionForGroupCreateInput,
  type QueryGroupVersionExpanded,
  type QueryGroupVersionExpandedWithIriMap,
  type QueryGroupVersionPatchInput,
  detectQueryRequestSchema,
  detectInputsResponseSchema,
  detectOutputsResponseSchema,
  validateQueryResponseSchema,
  type DetectInputsResponse,
  type DetectOutputsResponse,
  type ValidateQueryResponse,
  validateRuleDataRequestSchema,
  validateRuleDataResponseSchema,
  type ValidateRuleDataRequest,
  type ValidateRuleDataResponse,
  formatRequestSchema,
  formatResponseSchema,
  type FormatRequest,
  type FormatResponse,
  executionRequestSchema,
  type ExecutionRequest,
  type ExecutionResponse,
  sparqlRequestSchema,
  sparqlResponseSchema,
  type SparqlRequest,
  type SparqlResponse,
  ruleSchema,
  ruleCreateSchema,
  ruleUpdateSchema,
  type Rule,
  type RuleCreateInput,
  type RuleUpdateInput,
  ruleSetSchema,
  ruleSetCreateSchema,
  ruleSetUpdateSchema,
  type RuleSet,
  type RuleSetCreateInput,
  type RuleSetUpdateInput,
  ruleSetVersionSchema,
  dataBlockSchema,
  dataBlockCreateSchema,
  dataBlockUpdateSchema,
  type DataBlock,
  type DataBlockCreateInput,
  type DataBlockUpdateInput,
  dataGraphSchema,
  dataGraphCreateSchema,
  dataGraphUpdateSchema,
  type DataGraph,
  type DataGraphCreateInput,
  type DataGraphUpdateInput,
  tupleSetSchema,
  tupleSetCreateSchema,
  tupleSetUpdateSchema,
  type TupleSet,
  type TupleSetCreateInput,
  type TupleSetUpdateInput,
  testSchema,
  testCreateSchema,
  testUpdateSchema,
  type Test,
  type TestCreateInput,
  type TestUpdateInput,
  tagSchema,
  tagCreateSchema,
  tagUpdateSchema,
  type Tag,
  type TagCreateInput,
  type TagUpdateInput,
  ruleSetVersionExpandedSchema,
  ruleSetVersionForRuleSetCreateSchema,
  ruleSetVersionPatchSchema,
  type RuleSetVersionExpanded,
  type RuleSetVersionForRuleSetCreateInput,
  type RuleSetVersionPatchInput,
  type RuleSetVersion as ContractRuleSetVersion,
  ruleSetExecutionResponseSchema,
  type RuleSetExecutionResponse,
  type RuleSetExecutionRequest,
  type DataBlockExecution,
  type RuleExecutionRecord,
  type IterationRecord,
  benchmarkExperimentSchema,
  benchmarkExperimentCreateSchema,
  benchmarkExperimentUpdateSchema,
  benchmarkExperimentVersionSchema,
  benchmarkExperimentVersionCreateSchema,
  benchmarkExperimentVersionUpdateSchema,
  benchmarkIterationObservationSchema,
  benchmarkNodeObservationSchema,
  benchmarkObservationSchema,
  benchmarkRunSchema,
  benchmarkRunResponseSchema,
  type BenchmarkExperiment,
  type BenchmarkExperimentCreate,
  type BenchmarkExperimentUpdate,
  type BenchmarkExperimentVersion,
  type BenchmarkExperimentVersionCreate,
  type BenchmarkExperimentVersionUpdate,
  type BenchmarkNodeObservation,
  type BenchmarkObservation,
  type BenchmarkRun,
  type BenchmarkRunResponse,
} from '@sparql-query-lib/contracts';
import type { FeatureFlagKey } from '@sparql-query-lib/types';
import { PATCH_MEDIA_TYPES } from '@sparql-query-lib/types';
import type { ExportBundle } from '@sparql-query-lib/runtime';
import { useFeatureFlags } from './useFeatureFlags.js';
import {
  TUPLE_SOURCE_FORMATS,
  type TupleSourceFormat,
  SUGGESTED_COLUMN_TYPES,
  type SuggestedColumnType,
} from '../types/tuple-sets';

/** What `GET /libraries/:id/export-bundle` answers with. */
export interface LibraryNotebookPayload {
  bundle: ExportBundle;
  /** Queries and tests the export could not carry, each with its reason. */
  skipped: Array<{ id: string; name: string; reason: string }>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

type ApiResult<T> = {
  data: T;
  etag: string | null;
  lastModified: string | null;
  /**
   * The response's status code, for the handful of calls whose answer is the
   * status rather than the body. `POST /tuple-sets/:id/versions/from-etl` is
   * the first: 201 cut a version, 200 means the run produced what the current
   * version already held (#211's version churn), and the body is that version
   * either way.
   */
  status: number;
};

type ExecuteTargetResult = {
  body: string;
  contentType: string | null;
  timing?: {
    header?: string | null;
    breakdown?: {
      backendMs?: number;
      appMs?: number;
      serverTotalMs?: number;
      clientTotalMs?: number;
      networkMs?: number;
    };
  };
};

/** A run's report, as the caller receives it. */
export type TestReportExport = {
  body: string;
  contentType: string;
  /** What to save it as — the server's name for it, not a guess. */
  filename: string;
};

function buildUrl(path: string) {
  const config = useRuntimeConfig();
  const baseUrl = config.public.apiBaseUrl.endsWith('/')
    ? config.public.apiBaseUrl
    : `${config.public.apiBaseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, '');
  // No trace here: every caller of this passes the URL straight to `request`,
  // `executeTarget` or `postForBody`, each of which reports it with the method
  // and the outcome beside it. This one said the URL twice and the result never.
  return new URL(normalizedPath, baseUrl).toString();
}

async function parseResponse<T>(response: Response, schema?: (payload: unknown) => T): Promise<T> {
  if (!schema) {
    return undefined as T;
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && trimmed.length > 0) {
    console.error('API Response is not JSON. Raw content:', trimmed);
  }

  const payload = trimmed ? JSON.parse(trimmed) : undefined;
  return schema(payload);
}

function normalizeHeaderValue(value: string | null): string | null {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseServerTiming(
  header: string | null,
  clientTotalMs?: number
): { header?: string | null; breakdown?: NonNullable<ExecuteTargetResult['timing']>['breakdown'] } {
  if (!header) {
    return {};
  }

  const metrics: Record<string, number> = {};
  header.split(',').forEach((part) => {
    const trimmed = part.trim();
    const match = trimmed.match(/^([^;]+);dur=([\d.]+)/);
    if (match) {
      const key = match[1].trim();
      const value = Number.parseFloat(match[2]);
      if (!Number.isNaN(value)) {
        metrics[key] = value;
      }
    }
  });

  const backendMs = metrics.db ?? metrics.backend;
  const appMs = metrics.app;
  const serverTotalCandidate = metrics.total ?? ((backendMs ?? 0) + (appMs ?? 0));
  const serverTotalMs = Number.isFinite(serverTotalCandidate) ? serverTotalCandidate : undefined;
  let networkMs: number | undefined;
  if (typeof clientTotalMs === 'number' && typeof serverTotalMs === 'number') {
    networkMs = Math.max(0, clientTotalMs - serverTotalMs);
  }

  return {
    header,
    breakdown: {
      backendMs,
      appMs,
      serverTotalMs,
      clientTotalMs,
      networkMs,
    },
  };
}

const ruleVersionSchema = z.object({
  id: z.string(),
  isPartOf: z.string(),
  version: z.number(),
  ruleString: z.string(),
  comment: z.string().nullable().optional(),
  normalizedInsert: z.string().nullable().optional(),
  defaultBackend: z.string().nullable().optional(),
  grammarValid: z.boolean().nullable().optional(),
  validationError: z.string().nullable().optional(),
  dateCreated: z.string().nullable().optional(),
  dateModified: z.string().nullable().optional(),
});

const dataBlockVersionSchema = z.object({
  id: z.string(),
  isPartOf: z.string(),
  version: z.number(),
  dataString: z.string(),
  normalizedInsertData: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  defaultBackend: z.string().nullable().optional(),
  grammarValid: z.boolean().nullable().optional(),
  validationError: z.string().nullable().optional(),
  dateCreated: z.string().nullable().optional(),
  dateModified: z.string().nullable().optional(),
});

/*
 * A data graph version. `tripleCount` and `byteSize` are computed by the
 * server from the parsed content, so they are read-only facts about the
 * version rather than anything a client sends.
 */
const dataGraphVersionSchema = z.object({
  id: z.string(),
  isPartOf: z.string(),
  version: z.number(),
  immutable: z.boolean().nullable().optional(),
  contentString: z.string(),
  contentFormat: z.string(),
  tripleCount: z.number().nullable().optional(),
  byteSize: z.number().nullable().optional(),
  grammarValid: z.boolean().nullable().optional(),
  validationError: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  dateCreated: z.string().nullable().optional(),
  dateModified: z.string().nullable().optional(),
});

const detectTupleFormatSchema = z.object({
  suggested: z.enum(TUPLE_SOURCE_FORMATS),
});

/**
 * What content *would* become, without storing it.
 *
 * Mirrors what a version carries, because it is the same parse — the editor
 * uses it to preview unsaved rows and to convert pasted content into the row
 * builder, both of which need the typed interpretation only the server's
 * parser can give.
 */
const columnTypeSuggestionSchema = z.object({
  column: z.string(),
  suggested: z.enum(SUGGESTED_COLUMN_TYPES),
});

const previewTupleContentSchema = z.object({
  contentString: z.string(),
  tupleColumns: z.array(z.string()),
  rowCount: z.number(),
  byteSize: z.number(),
  columnTypeSuggestions: z.array(columnTypeSuggestionSchema),
});

/**
 * A tuple set version.
 *
 * `contentString` is always a SPARQL Results JSON document, whatever
 * `sourceFormat` says — that field is provenance, recording which dialect the
 * rows arrived in, not an instruction for reading them back. The server
 * normalises on import precisely so a pinned version cannot change meaning
 * when the reading code does (`docs/concepts.md`).
 *
 * `tupleColumns` is `head.vars` in order, lifted onto the version so a listing
 * can show arity and a compatibility verdict can be computed without parsing a
 * megabyte of content.
 */
const tupleSetVersionSchema = z.object({
  id: z.string(),
  isPartOf: z.string(),
  version: z.number(),
  immutable: z.boolean().nullable().optional(),
  contentString: z.string(),
  sourceFormat: z.enum(TUPLE_SOURCE_FORMATS).nullable().optional(),
  tupleColumns: z.array(z.string()).nullable().optional(),
  rowCount: z.number().nullable().optional(),
  byteSize: z.number().nullable().optional(),
  // Present only on a version the ETL sink materialized (#211): what produced
  // the rows, recorded on the snapshot rather than followed.
  sourceEtlJobVersion: z.string().nullable().optional(),
  sourceColumnMappingVersion: z.string().nullable().optional(),
  sourceExecutedAt: z.string().nullable().optional(),
  sourceResultHash: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  dateCreated: z.string().nullable().optional(),
  dateModified: z.string().nullable().optional(),
});

/*
 * A test version: the invocation inputs plus the expectation. `expected` is
 * text whatever the kind — JSON for bindings, "true"/"false" for boolean, RDF
 * for graph — because the comparator that reads it is chosen by
 * `expectationKind`, not by the field's type.
 */
/**
 * One parametrised case: its inputs, and what is correct given them.
 *
 * The expectation is on the case rather than the version because changing the
 * arguments changes what is correct. A test with one case is the ordinary
 * single test; N cases is `@pytest.mark.parametrize`.
 */
const testCaseSchema = z.object({
  id: z.string(),
  isPartOf: z.string(),
  position: z.number(),
  name: z.string().nullable().optional(),
  argumentSetVersion: z.string().nullable().optional(),
  dataGraphVersion: z.string().nullable().optional(),
  tupleSeeds: z.string().nullable().optional(),
  /** DuckDB statements run before an ETL subject's own SQL — the rows it reads. */
  sqlFixture: z.string().nullable().optional(),
  expected: z.string().nullable().optional(),
  expectedFormat: z.string().nullable().optional(),
  ordered: z.boolean().nullable().optional(),
  dateCreated: z.string().nullable().optional(),
  dateModified: z.string().nullable().optional(),
});

const testVersionSchema = z.object({
  id: z.string(),
  isPartOf: z.string(),
  version: z.number(),
  immutable: z.boolean().nullable().optional(),
  expectationKind: z.string(),
  // Inlined by the server, in position order — a case has no endpoint of its own.
  cases: z.array(testCaseSchema).default([]),
  subjectVersion: z.string().nullable().optional(),
  backend: z.string().nullable().optional(),
  maxIterations: z.number().nullable().optional(),
  timeoutMs: z.number().nullable().optional(),
  comment: z.string().nullable().optional(),
  dateCreated: z.string().nullable().optional(),
  dateModified: z.string().nullable().optional(),
});

const comparisonDetailSchema = z
  .object({
    missing: z.array(z.string()).optional(),
    unexpected: z.array(z.string()).optional(),
    matched: z.number().optional(),
  })
  .nullable()
  .optional();

/**
 * One case's verdict.
 *
 * The diff is here rather than at the top level because it belongs to the case
 * that produced it — one flattened diff across N cases would be a diff of
 * nothing in particular.
 */
const testCaseRunResultSchema = z.object({
  caseId: z.string(),
  name: z.string(),
  position: z.number(),
  passed: z.boolean(),
  message: z.string(),
  detail: comparisonDetailSchema,
  /** What the subject produced, capped server-side. The pane shows it beside the diff. */
  result: z.string().nullable().optional(),
  resultTruncated: z.boolean().nullable().optional(),
  inputs: z
    .object({
      argumentSetVersion: z.string().nullable().optional(),
      dataGraphVersion: z.string().nullable().optional(),
    })
    .optional(),
  durationMs: z.number(),
});

/** One verdict per case, plus the summary across them. */
const testRunResultSchema = z.object({
  testId: z.string(),
  testVersionId: z.string(),
  passed: z.boolean(),
  message: z.string(),
  expectationKind: z.string(),
  hermetic: z.boolean(),
  durationMs: z.number(),
  subjectVersionId: z.string().nullable().optional(),
  ranAt: z.string(),
  cases: z.array(testCaseRunResultSchema).default([]),
  passedCount: z.number().default(0),
  failedCount: z.number().default(0),
});

/**
 * The answer to a run-by-tag: the tally, and every verdict behind it.
 *
 * `requested` is how many tests the tags selected — always `results.length`,
 * and present so "no test carries this tag" is a fact a caller can read rather
 * than infer from an empty array.
 */
const taggedTestRunSchema = z.object({
  tags: z.array(z.string()),
  match: z.string(),
  requested: z.number(),
  passed: z.number(),
  failed: z.number(),
  results: z.array(testRunResultSchema).default([]),
  reportGraph: z.string().nullable().optional(),
  reportError: z.string().nullable().optional(),
});

/** `any` unions the tags, `all` intersects them. The API defaults to `any`. */
export type TagMatchMode = 'any' | 'all';

export type TaggedTestRun = z.infer<typeof taggedTestRunSchema>;

export type TestCase = z.infer<typeof testCaseSchema>;
export type TestCaseRunResult = z.infer<typeof testCaseRunResultSchema>;
export type TestVersion = z.infer<typeof testVersionSchema>;
export type TestRunResult = z.infer<typeof testRunResultSchema>;

export type RuleVersion = z.infer<typeof ruleVersionSchema>;
export type DataBlockVersion = z.infer<typeof dataBlockVersionSchema>;
export type DataGraphVersion = z.infer<typeof dataGraphVersionSchema>;
export type TupleSetVersion = z.infer<typeof tupleSetVersionSchema>;

/*
 * Backend observations — what the server saw when it last asked the store for
 * its service description. Never persisted, so a fresh server legitimately has
 * nothing to say about a backend that has existed for months.
 */
const backendProbeSchema = z.object({
  backendId: z.string(),
  health: z.enum(['healthy', 'slow', 'unreachable']),
  latencyMs: z.number().nullable(),
  product: z.string().nullable(),
  probedAt: z.string(),
  error: z.string().nullable(),
  /** What the endpoint answered with, when it answered. Null when nothing did. */
  httpStatus: z.number().nullable().optional().default(null),
  /**
   * Whether the store exposes its own prefix map, and whether we may write it.
   * Null when the probe could not establish it — an unreachable store, an
   * in-process one, or detection switched off server-side — which is not the
   * same as `read: null`, which means we asked and found nothing.
   */
  prefixes: z
    .object({
      read: z.enum(['jena-prefixes', 'turtle-scrape']).nullable(),
      write: z.literal('jena-prefixes').nullable(),
      readEndpoint: z.string().nullable(),
      writeEndpoint: z.string().nullable(),
      count: z.number().nullable(),
    })
    .nullable()
    .optional()
    .default(null),
});

const remotePrefixesSchema = z.object({
  mappings: z.array(z.object({ prefix: z.string(), namespace: z.string() })),
  source: z.enum(['jena-prefixes', 'turtle-scrape']),
  readOnly: z.boolean(),
  endpoint: z.string().nullable(),
});

const prefixPushSchema = z.object({
  results: z.array(z.object({
    prefix: z.string(),
    action: z.enum(['upsert', 'delete']),
    status: z.enum(['ok', 'failed']),
    error: z.string().optional(),
  })),
  applied: z.number(),
  failed: z.number(),
});

const backendEnvSchema = z.object({
  authEnvKey: z.string().nullable(),
  variables: z.array(z.object({
    name: z.string(),
    role: z.string(),
    // Presence only. A value never crosses this boundary.
    set: z.boolean(),
  })),
});

const backendUsageGroupSchema = z.object({
  count: z.number(),
  sample: z.array(z.object({ id: z.string(), name: z.string() })),
});

const backendUsageSchema = z.object({
  queries: backendUsageGroupSchema,
  queryGroups: backendUsageGroupSchema,
  benchmarks: backendUsageGroupSchema,
  libraries: backendUsageGroupSchema,
});

export type BackendProbe = z.infer<typeof backendProbeSchema>;
export type BackendPrefixCapability = NonNullable<BackendProbe['prefixes']>;
export type RemotePrefixes = z.infer<typeof remotePrefixesSchema>;
export type PrefixPushResult = z.infer<typeof prefixPushSchema>;
export type BackendEnv = z.infer<typeof backendEnvSchema>;
export type BackendUsage = z.infer<typeof backendUsageSchema>;

// Schema for serialized errors
const serializedErrorSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
});

export type RuleSetVersion = ContractRuleSetVersion;
export { type RuleSetExecutionResponse, type DataBlockExecution, type IterationRecord, type RuleExecutionRecord };

/** A rule that would be detached by an SRL re-import (never deleted). */
export interface RuleSetSrlDetached {
  ruleVersionId: string;
  ruleId: string;
  /** How many other rule sets still reference this rule version. */
  otherRuleSets: number;
  /** True when nothing else references it — it becomes an orphan. */
  orphaned: boolean;
}

/** A data block that would be detached by an SRL re-import (never deleted). */
export interface RuleSetSrlDataDetached {
  dataBlockVersionId: string;
  otherRuleSets: number;
  orphaned: boolean;
}

export interface RuleSetSrlPreview {
  warnings: string[];
  created: Array<{ label: string; named: boolean; text: string }>;
  updated: Array<{ ruleVersionId: string; changed: boolean; text: string }>;
  detached: RuleSetSrlDetached[];
  unchangedCount: number;
  /** DATA blocks in the same document, reconciled the same way. */
  data: {
    created: Array<{ label: string; text: string }>;
    unchangedCount: number;
    detached: RuleSetSrlDataDetached[];
  };
  /** What the initial-named-tuples box declares: values vs. inputs. */
  tupleSeeds: {
    rows: number;
    declarations: Array<{ arity: number; terms: string[] }>;
  };
}

export interface RuleSetSrlExport {
  srl: string;
  ruleCount: number;
  dataBlockCount: number;
  /** The ruleset's initial named tuples, as a TUPLE(…) document. */
  tupleSeeds: string;
  /** Whether this version opts into the rule-tuples extension. */
  tuplesEnabled: boolean;
  /** Parts of the ruleset that have no SRL form and were left out. */
  warnings: string[];
}

export interface RuleSetSrlImportResult {
  ruleSetVersionId: string;
  version: number;
  created: string[];
  updated: string[];
  detached: string[];
  ruleCount: number;
  dataCreated: string[];
  dataDetached: string[];
  dataBlockCount: number;
  tuplesEnabled: boolean;
}

/** One rule of a document, compiled to the SPARQL it is equivalent to. */
export interface RuleSetSrlCompiledRule {
  index: number;
  name: string | null;
  label: string;
  srl: string;
  sparql: string;
  producesTuples: boolean;
  tupleReads: number;
  /** Why the SPARQL is not standalone-equivalent, when it isn't. */
  caveats: string[];
}

/**
 * Which SPARQL form the compile route emitted.
 *
 * `insert` is what the engine runs; `construct` is the same rule read
 * non-destructively — one pass, returning the triples instead of writing them.
 * Both are computed from the posted document; neither is stored.
 */
export type RuleSetSrlCompileFlavour = 'insert' | 'construct';

export interface RuleSetSrlCompileResult {
  rules: RuleSetSrlCompiledRule[];
  dataBlocks: Array<{ index: number; label: string; srl: string; sparql: string }>;
  /** Echoed by the route, so a late response can be told from the current one. */
  flavour: RuleSetSrlCompileFlavour;
}

/** One reason a query did not convert cleanly, or did not convert at all. */
export interface SparqlImportIssue {
  severity: 'error' | 'warning';
  code: string;
  /** The SPARQL construct at fault, upper-cased as it is written. */
  construct?: string;
  message: string;
}

/** A PREFIX the imported query declared. */
export interface SparqlImportPrefix {
  prefix: string;
  namespace: string;
  /** True when the target document binds this label to a different namespace. */
  conflicts: boolean;
}

/** Which SPARQL form the rule was read out of. */
export type SparqlImportForm = 'construct' | 'insert';

/**
 * A CONSTRUCT or INSERT … WHERE converted to a rule.
 *
 * `rule` is null whenever any issue is an error — the conversion is all or
 * nothing, because a rule missing one of its patterns does not fail, it infers
 * the wrong triples.
 */
export interface SparqlImportResult {
  rule: string | null;
  /** Null when the query is neither form, including when it did not parse. */
  form: SparqlImportForm | null;
  issues: SparqlImportIssue[];
  prefixes: SparqlImportPrefix[];
  /** True when the rule would be evaluated once rather than to a fixpoint. */
  runOnce: boolean;
}

/** One rule or DATA block of a document, as the editor draws it. */
export interface SrlDocumentBlock {
  kind: 'rule' | 'data';
  index: number;
  id: string;
  label: string;
  name: string | null;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** 0-based, as the stratifier reports it; see `stratumLabel`. */
  stratum: number | null;
  monotonicity: 'monotone' | 'negation' | null;
  /** The spec's `SL.once` — run exactly once, not to fixpoint. Null for DATA. */
  runOnce: boolean | null;
  triples: number | null;
}

export interface SrlStratificationSummary {
  strata: Record<string, number>;
  monotonicity: Record<string, 'monotone' | 'negation'>;
  runOnce: Record<string, boolean>;
  edges: Array<{
    from: string;
    to: string;
    /** `closed` is a positive dependency promoted because the reader runs once. */
    label?: 'positive' | 'negative' | 'closed';
    reasons?: Array<{
      body?: { subject?: string; predicate?: string; object?: string };
      head?: { subject?: string; predicate?: string; object?: string };
    }>;
  }>;
  issues: string[];
  strataCount: number;
  negationCount: number;
  runOnceCount: number;
  stratified: boolean;
}

export interface RuleSetSrlAnalysis {
  valid: boolean;
  error: string | null;
  ruleCount: number;
  dataBlockCount: number;
  blocks: SrlDocumentBlock[];
  stratification: SrlStratificationSummary;
  wellFormedness: Array<{ category: string; ruleIndex: number; ruleName?: string; message: string }>;
}

/*
 * Module scope, not inside the composable.
 *
 * These are re-exported at the bottom of the file, which a type declared in the
 * function body cannot satisfy — the export saw no such name and the file
 * carried three TS2304s. A type nested in a composable is also unreachable to
 * any caller, which is the opposite of what an exported one is for. See #52.
 */
type ValidationIssue = {
  level: 'error' | 'warning';
  message: string;
  entityType?: string;
  entityId?: string | null;
  code?: string | null;
};

type ValidationResponse = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues?: ValidationIssue[];
};

type IdResponse = {
  id: string;
};

export function useApiClient() {
  const auth = useAuth();

  /**
   * One place attaches the bearer token, so no call site can forget it.
   * Returns the init unchanged but for the headers when auth is disabled.
   *
   * `cache: 'no-store'` for the same reason the API now sends
   * `Cache-Control: no-store`: entity reads carry an `ETag`/`Last-Modified`
   * pair for `If-Match`, and a browser reads a validator with no cache
   * directive as licence to guess a freshness lifetime — which is how a query
   * whose new version had just been made current came back from the cache
   * still naming the old one. The server header stops caches filling up with
   * such responses; this stops the ones already holding one from answering
   * with it, so the fix does not wait for a stale entry to age out.
   */
  const authorized = async (init: RequestInit): Promise<RequestInit> => {
    const token = await auth.accessToken();
    return {
      ...init,
      cache: init.cache ?? 'no-store',
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        // Stamped on every request so the change feed can tell this tab which
        // frames are echoes of its own writes.
        'x-sqlib-client-id': clientId(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    };
  };

  const request = async <T>(
    input: RequestInfo | URL,
    init: RequestInit,
    schema?: (payload: unknown) => T
  ): Promise<ApiResult<T>> => {
    debug('useApiClient', 'request', { url: input.toString(), method: init.method });
    try {
      const response = await fetch(input, await authorized(init));
      debug('useApiClient', 'response', {
        url: input.toString(),
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: {
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          contentType: response.headers.get('content-type')
        }
      });

      if (!response.ok) {
        if (response.status === 412) {
          const payload = await response.json().catch(() => ({}));
          console.error('[useApiClient] 412 Precondition Failed:', payload);
          throw createError({
            statusCode: 412,
            statusMessage: (payload as { error?: string }).error ?? 'Precondition Failed',
            data: payload,
          });
        }

        const payload = await response.json().catch(() => ({}));
        console.error('[useApiClient] Request failed:', {
          status: response.status,
          statusText: response.statusText,
          payload
        });
        throw createError({ statusCode: response.status, statusMessage: (payload as { error?: string }).error ?? response.statusText, data: payload });
      }
      
      const data = await parseResponse(response, schema);
      const result = {
        data,
        etag: normalizeHeaderValue(response.headers.get('etag')),
        lastModified: normalizeHeaderValue(response.headers.get('last-modified')),
        status: response.status,
      };
      debug('useApiClient', 'request succeeded', {
        url: input.toString(),
        hasData: !!data,
        etag: result.etag,
        lastModified: result.lastModified
      });
      return result;
    } catch (error) {
      console.error('[useApiClient] Request exception:', {
        url: input.toString(),
        error: error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  };

  const executeRulesPlayground = (input: RuleSetExecutionRequest) => {
    ensureFeatureEnabled('playgroundRules');
    const body: Record<string, unknown> = {
      dataBlocks: input.dataBlocks ?? [],
      rules: input.rules ?? [],
    };
    // A rule set is one SRL document; the server splits it. The arrays above
    // stay for callers that already hold split parts.
    if (input.srl) body.srl = input.srl;
    if (input.tuples) body.tuples = true;
    if (input.tupleSeeds) body.tupleSeeds = input.tupleSeeds;
    if (input.inferenceFormat !== undefined) {
      body.inferenceFormat = input.inferenceFormat;
    }
    if (input.maxIterations !== undefined && input.maxIterations !== null) {
      body.maxIterations = input.maxIterations;
    }
    // The data graph, if the author supplied one. Sent only when set, so an
    // unset box is indistinguishable from a request that predates the feature.
    if (input.dataGraphVersionId) body.dataGraphVersionId = input.dataGraphVersionId;
    if (input.dataGraphInline) {
      body.dataGraphInline = input.dataGraphInline;
      if (input.dataGraphInlineFormat) body.dataGraphInlineFormat = input.dataGraphInlineFormat;
    }

    return requestData(
      buildUrl('/playground/rules/execute'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      },
      (payload) => {
        // No trace of the payload here: it printed the whole response body on
        // every successful run. What it was for is the parse below failing, and
        // that branch already prints the payload, with the error that makes it
        // worth reading.
        try {
          return ruleSetExecutionResponseSchema.parse(payload);
        } catch (err) {
          console.error('[executeRulesPlayground] Schema parse error:', err);
          console.error('[executeRulesPlayground] Payload was:', JSON.stringify(payload, null, 2));
          throw err;
        }
      },
    );
  };

  /**
   * A run answered as a document rather than as JSON.
   *
   * Separate from `request` because none of that path applies: there is no
   * schema to parse against, the body may be XML, CSV or Turtle, and the name
   * to save it under is the server's `Content-Disposition` rather than
   * something the SPA invents.
   */
  const requestReport = async (
    url: string,
    body: unknown,
    accept: string,
    fallbackFilename: string,
  ): Promise<TestReportExport> => {
    const response = await fetch(url, await authorized({
      method: 'POST',
      headers: { ...JSON_HEADERS, accept },
      body: JSON.stringify(body),
    }));

    if (!response.ok) {
      // Errors stay JSON whatever was negotiated, so a failed export reads
      // exactly like every other failed request.
      const payload = await response.json().catch(() => ({}));
      throw createError({
        statusCode: response.status,
        statusMessage: (payload as { error?: string }).error ?? response.statusText,
        data: payload,
      });
    }

    return {
      body: await response.text(),
      contentType: response.headers.get('content-type') ?? 'text/plain',
      filename: filenameFromDisposition(response.headers.get('content-disposition')) ?? fallbackFilename,
    };
  };

  const requestData = async <T>(
    input: RequestInfo | URL,
    init: RequestInit,
    schema?: (payload: unknown) => T
  ): Promise<T> => {
    const { data } = await request<T>(input, init, schema);
    return data;
  };

  const applyIfMatchHeader = (headers: Record<string, string>, token?: string | null) => {
    if (!token || typeof token !== 'string') {
      return;
    }
    if (token === '*') {
      headers['If-Match'] = '*';
      return;
    }
    const trimmed = token.trim();
    if (!trimmed) {
      return;
    }
    const sanitized = trimmed.replace(/"/g, '');
    headers['If-Match'] = `"${sanitized}"`;
  };

  const listBackends = () =>
    requestData(buildUrl('/backends'), { method: 'GET' }, (payload) => backendSchema.array().parse(payload));

  const getBackend = (id: string) =>
    request(buildUrl(`/backends/${encodeURIComponent(id)}`), { method: 'GET' }, backendSchema.parse);

  const createBackend = (input: BackendCreate) =>
    request(
      buildUrl('/backends'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(backendCreateSchema.parse(input)) },
      backendSchema.parse,
    );

  const updateBackend = (id: string, input: BackendUpdate, options?: { ifMatch?: string | null }) => {
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/backends/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(backendUpdateSchema.parse(input)) },
      backendSchema.parse,
    );
  };

  const getBackendReferences = async (id: string): Promise<{ libraries: Array<{ id: string; name: string }>; queries: Array<{ id: string; name: string }> }> => {
    return requestData(buildUrl(`/backends/${encodeURIComponent(id)}/references`), { method: 'GET' }, (payload) => {
      const schema = z.object({
        libraries: z.array(z.object({ id: z.string(), name: z.string() })),
        queries: z.array(z.object({ id: z.string(), name: z.string() })),
      });
      return schema.parse(payload);
    });
  };

  const deleteBackend = async (id: string) => {
    await requestData(buildUrl(`/backends/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  /*
   * The record page's three reads. A probe is an observation the server holds
   * in memory, not a stored field, so it arrives beside the backend rather
   * than on it — which is also why `listBackendProbes` exists: the sidebar
   * wants six dots, not six probes.
   */
  const listBackendProbes = () =>
    requestData(
      buildUrl('/backends/probes'),
      { method: 'GET' },
      (payload) => z.object({ probes: z.array(backendProbeSchema) }).parse(payload).probes,
    );

  const probeAllBackends = () =>
    requestData(
      buildUrl('/backends/probes'),
      { method: 'POST' },
      (payload) => z.object({ probes: z.array(backendProbeSchema) }).parse(payload).probes,
    );

  const probeBackend = (id: string) =>
    requestData(
      buildUrl(`/backends/${encodeURIComponent(id)}/probe`),
      { method: 'POST' },
      (payload) => backendProbeSchema.parse(payload),
    );

  const getBackendProbeHistory = (id: string) =>
    requestData(
      buildUrl(`/backends/${encodeURIComponent(id)}/probe-history`),
      { method: 'GET' },
      (payload) => z.object({ probes: z.array(backendProbeSchema) }).parse(payload).probes,
    );

  /*
   * The store's own prefix map, and pushing to it.
   *
   * Both go through the API rather than the browser: the credentials live in
   * the server's environment, and a customer's Fuseki is under no obligation
   * to send us CORS headers. A push is one call per prefix on the far side
   * with no transaction across them, so the reply is per item and a partial
   * application is a normal outcome to render, not an error to throw.
   */
  const getBackendPrefixes = (id: string) =>
    requestData(
      buildUrl(`/backends/${encodeURIComponent(id)}/prefixes`),
      { method: 'GET' },
      (payload) => remotePrefixesSchema.parse(payload),
    );

  const pushBackendPrefixes = (
    id: string,
    batch: { upserts?: Array<{ prefix: string; namespace: string }>; deletes?: string[] },
  ) =>
    requestData(
      buildUrl(`/backends/${encodeURIComponent(id)}/prefixes`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upserts: batch.upserts ?? [], deletes: batch.deletes ?? [] }),
      },
      (payload) => prefixPushSchema.parse(payload),
    );

  const getBackendEnv = (id: string) =>
    requestData(
      buildUrl(`/backends/${encodeURIComponent(id)}/env`),
      { method: 'GET' },
      (payload) => backendEnvSchema.parse(payload),
    );

  const getBackendUsage = (id: string) =>
    requestData(
      buildUrl(`/backends/${encodeURIComponent(id)}/usage`),
      { method: 'GET' },
      (payload) => backendUsageSchema.parse(payload),
    );

  const listLibraries = () =>
    requestData(buildUrl('/libraries'), { method: 'GET' }, (payload) => librarySchema.array().parse(payload));

  const getLibrary = (id: string) =>
    request(buildUrl(`/libraries/${encodeURIComponent(id)}`), { method: 'GET' }, librarySchema.parse);

  /**
   * The library as a runnable notebook: every query compiled, with the tests
   * that fit it carried along as examples.
   *
   * The Library screen and `sqlib export --html` read the same route, so the
   * tab and the file it exports are the same document with different chrome.
   * The payload is not schema-parsed here: `fromBundle` validates it in the
   * runtime, with the messages that know what a parameter slot is.
   */
  const getLibraryExportBundle = (
    id: string,
    options: { examples?: 'all' | 'first' | 'none'; expected?: boolean } = {},
  ) => {
    const search = new URLSearchParams();
    if (options.examples) search.set('examples', options.examples);
    if (options.expected) search.set('expected', 'true');
    const suffix = search.toString();
    return requestData(
      buildUrl(`/libraries/${encodeURIComponent(id)}/export-bundle${suffix ? `?${suffix}` : ''}`),
      { method: 'GET' },
      (payload) => payload as LibraryNotebookPayload,
    );
  };

  /**
   * The same library as a self-contained HTML page, fetched rather than linked.
   *
   * A bare `<a href>` to this route would be a browser navigation, and a
   * navigation carries no `Authorization` header — so with auth enabled the
   * export 401s while every other call on the page succeeds. Fetching it here
   * puts it through the one code path that attaches the bearer token, and the
   * caller saves the string as a file.
   */
  const getLibraryExportHtml = async (
    id: string,
    options: { examples?: 'all' | 'first' | 'none'; expected?: boolean } = {},
  ): Promise<string> => {
    const search = new URLSearchParams({ format: 'html' });
    if (options.examples) search.set('examples', options.examples);
    if (options.expected) search.set('expected', 'true');
    const url = buildUrl(
      `/libraries/${encodeURIComponent(id)}/export-bundle?${search.toString()}`,
    );

    const token = await auth.accessToken();
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'text/html',
        'x-sqlib-client-id': clientId(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      throw createError({
        statusCode: response.status,
        statusMessage: response.statusText || 'Export failed',
      });
    }
    return response.text();
  };

  const createLibrary = (input: LibraryCreateInput) =>
    request(
      buildUrl('/libraries'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(libraryCreateSchema.parse(input)) },
      librarySchema.parse,
    );

  const updateLibrary = (id: string, input: LibraryUpdateInput, options?: { ifMatch?: string | null }) => {
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/libraries/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(libraryUpdateSchema.parse(input)) },
      librarySchema.parse,
    );
  };

  const deleteLibrary = async (id: string) => {
    await requestData(buildUrl(`/libraries/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  const { isEnabled, labelFor } = useFeatureFlags();

  const ensureFeatureEnabled = (key: FeatureFlagKey) => {
    if (!isEnabled(key)) {
      const message = `${labelFor(key)} feature is disabled`;
      throw createError({ statusCode: 404, statusMessage: message, message });
    }
  };

  const ensureQueriesEnabled = () => ensureFeatureEnabled('queries');
  const ensureQueryGroupsEnabled = () => ensureFeatureEnabled('queryGroups');
  const ensureRulesSuiteEnabled = () => ensureFeatureEnabled('rulesSuite');
  /*
   * The SRL rule-tuples extension, gated separately from the rules suite it
   * belongs to: a build can offer rules and withhold the extension, which is
   * the default. Called only where a request would carry the extension, never
   * on a plain rules call, so refusing it never takes rules away.
   */
  const ensureRuleTuplesEnabled = () => ensureFeatureEnabled('ruleTuples');

  const ensurePlaygroundOrLibraryQueriesEnabled = () => {
    if (!isEnabled('queries') && !isEnabled('playgroundQueries')) {
      const message = 'Feature is disabled because Queries and Playground Queries features are off';
      throw createError({ statusCode: 404, statusMessage: message, message });
    }
  };

  const ensurePlaygroundOrLibraryRulesEnabled = () => {
    if (!isEnabled('rulesSuite') && !isEnabled('playgroundRules')) {
      const message = 'Feature is disabled because Rules and Playground Rules features are off';
      throw createError({ statusCode: 404, statusMessage: message, message });
    }
  };

  const ensureFormattingEnabled = () => {
    if (!isEnabled('queries') && !isEnabled('rulesSuite') && !isEnabled('playgroundQueries') && !isEnabled('playgroundRules')) {
      const message = 'Formatting is disabled because Queries and Rules features are off';
      throw createError({ statusCode: 404, statusMessage: message, message });
    }
  };

  const listQueries = () => {
    ensureQueriesEnabled();
    return requestData(buildUrl('/queries'), { method: 'GET' }, (payload) => querySchema.array().parse(payload));
  };

  const getQuery = (id: string) => {
    ensureQueriesEnabled();
    return request(buildUrl(`/queries/${encodeURIComponent(id)}`), { method: 'GET' }, querySchema.parse);
  };

  const createQuery = (input: QueryCreateInput) => {
    ensureQueriesEnabled();
    return request(
      buildUrl('/queries'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(queryCreateSchema.parse(input)) },
      querySchema.parse,
    );
  };

  const updateQuery = (id: string, input: QueryUpdateInput, options?: { ifMatch?: string | null }) => {
    ensureQueriesEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/queries/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(queryUpdateSchema.parse(input)) },
      querySchema.parse,
    );
  };

  const deleteQuery = async (id: string) => {
    ensureQueriesEnabled();
    await requestData(buildUrl(`/queries/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  const listQueryVersions = async (queryId: string) => {
    ensureQueriesEnabled();
    const versions = await requestData(
      buildUrl(`/queries/${encodeURIComponent(queryId)}/v`),
      { method: 'GET' },
      (payload) => queryVersionSchema.array().parse(payload),
    );
    discoverQueryVersionPrefixes(versions, queryId);
    return versions;
  };

  const getQueryVersion = async (queryId: string, version: number | string) => {
    ensureQueriesEnabled();
    const result = await request(
      buildUrl(`/queries/${encodeURIComponent(queryId)}/v/${encodeURIComponent(String(version))}`),
      { method: 'GET' },
      queryVersionExpandedSchema.parse,
    );
    discoverQueryVersionPrefixes(result.data, queryId);
    return result;
  };

  const createQueryVersion = async (queryId: string, input: QueryVersionForQueryCreateInput) => {
    ensureQueriesEnabled();
    const result = await request(
      buildUrl(`/queries/${encodeURIComponent(queryId)}/v`),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(queryVersionForQueryCreateSchema.parse(input)),
      },
      queryVersionExpandedWithIriMapSchema.parse,
    );
    discoverQueryVersionPrefixes(result.data, queryId);
    return result;
  };

  const patchQueryVersion = async (queryId: string, version: number | string, input: QueryVersionPatchInput, options?: { ifMatch?: string | null }) => {
    ensureQueriesEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    const result = await request(
      buildUrl(`/queries/${encodeURIComponent(queryId)}/v/${encodeURIComponent(String(version))}`),
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(queryVersionPatchSchema.parse(input)),
      },
      queryVersionExpandedSchema.parse,
    );
    discoverQueryVersionPrefixes(result.data, queryId);
    return result;
  };

  const listQueryGroups = () => {
    ensureQueryGroupsEnabled();
    return requestData(buildUrl('/query-groups'), { method: 'GET' }, (payload) => queryGroupSchema.array().parse(payload));
  };

  const getQueryGroup = (id: string) => {
    ensureQueryGroupsEnabled();
    return request(buildUrl(`/query-groups/${encodeURIComponent(id)}`), { method: 'GET' }, queryGroupSchema.parse);
  };

  const createQueryGroup = (input: QueryGroupCreateInput) => {
    ensureQueryGroupsEnabled();
    return request(
      buildUrl('/query-groups'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(queryGroupCreateSchema.parse(input)) },
      queryGroupSchema.parse,
    );
  };

  const updateQueryGroup = (id: string, input: QueryGroupUpdateInput, options?: { ifMatch?: string | null }) => {
    ensureQueryGroupsEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/query-groups/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(queryGroupUpdateSchema.parse(input)) },
      queryGroupSchema.parse,
    );
  };

  const deleteQueryGroup = async (id: string) => {
    ensureQueryGroupsEnabled();
    await requestData(buildUrl(`/query-groups/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  const listQueryGroupVersions = (groupId: string) => {
    ensureQueryGroupsEnabled();
    return requestData(
      buildUrl(`/query-groups/${encodeURIComponent(groupId)}/v`),
      { method: 'GET' },
      (payload) => queryGroupVersionSchema.array().parse(payload),
    );
  };

  const getQueryGroupVersion = (groupId: string, version: number | string) => {
    ensureQueryGroupsEnabled();
    return request(
      buildUrl(`/query-groups/${encodeURIComponent(groupId)}/v/${encodeURIComponent(String(version))}`),
      { method: 'GET' },
      queryGroupVersionExpandedSchema.parse,
    );
  };

  const createQueryGroupVersion = (groupId: string, input: QueryGroupVersionForGroupCreateInput) => {
    ensureQueryGroupsEnabled();
    return request(
      buildUrl(`/query-groups/${encodeURIComponent(groupId)}/v`),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(queryGroupVersionForGroupCreateSchema.parse(input)),
      },
      queryGroupVersionExpandedWithIriMapSchema.parse,
    );
  };

  const patchQueryGroupVersion = (
    groupId: string,
    version: number | string,
    input: QueryGroupVersionPatchInput,
    options?: { ifMatch?: string | null }
  ) => {
    ensureQueryGroupsEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/query-groups/${encodeURIComponent(groupId)}/v/${encodeURIComponent(String(version))}`),
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(queryGroupVersionPatchSchema.parse(input)),
      },
      queryGroupVersionExpandedSchema.parse,
    );
  };

  const idResponseSchema = z.object({ id: z.string() });
  const validationIssueSchema = z.object({
    level: z.enum(['error', 'warning']),
    message: z.string(),
    entityType: z.string().optional(),
    entityId: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
  });

  const validationResponseSchema = z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    issues: z.array(validationIssueSchema).optional(),
  });

  /**
   * Validate query group version
   */
  const validateQueryGroupVersion = (groupId: string, version: number | string) => {
    ensureQueryGroupsEnabled();
    return requestData(
      buildUrl(`/query-groups/${encodeURIComponent(groupId)}/v/${encodeURIComponent(String(version))}/validate`),
      { method: 'GET' },
      validationResponseSchema.parse,
    );
  };

  const listRules = () => {
    ensureRulesSuiteEnabled();
    return requestData(buildUrl('/rules'), { method: 'GET' }, (payload) => ruleSchema.array().parse(payload));
  };

  const getRule = (id: string) => {
    ensureRulesSuiteEnabled();
    return request(buildUrl(`/rules/${encodeURIComponent(id)}`), { method: 'GET' }, ruleSchema.parse);
  };

  const createRule = (input: RuleCreateInput) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl('/rules'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(ruleCreateSchema.parse(input)) },
      ruleSchema.parse,
    );
  };

  const updateRule = (id: string, input: RuleUpdateInput, options?: { ifMatch?: string | null }) => {
    ensureRulesSuiteEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/rules/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(ruleUpdateSchema.parse(input)) },
      ruleSchema.parse,
    );
  };

  const deleteRule = async (id: string) => {
    ensureRulesSuiteEnabled();
    await requestData(buildUrl(`/rules/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  const listRuleSets = () => {
    ensureRulesSuiteEnabled();
    return requestData(buildUrl('/rule-sets'), { method: 'GET' }, (payload) => ruleSetSchema.array().parse(payload));
  };

  const getRuleSet = (id: string) => {
    ensureRulesSuiteEnabled();
    return request(buildUrl(`/rule-sets/${encodeURIComponent(id)}`), { method: 'GET' }, ruleSetSchema.parse);
  };

  const createRuleSet = (input: RuleSetCreateInput) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl('/rule-sets'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(ruleSetCreateSchema.parse(input)) },
      ruleSetSchema.parse,
    );
  };

  const updateRuleSet = (id: string, input: RuleSetUpdateInput, options?: { ifMatch?: string | null }) => {
    ensureRulesSuiteEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/rule-sets/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(ruleSetUpdateSchema.parse(input)) },
      ruleSetSchema.parse,
    );
  };

  const deleteRuleSet = async (id: string) => {
    ensureRulesSuiteEnabled();
    await requestData(buildUrl(`/rule-sets/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  const listRuleSetVersions = (ruleSetId: string) => {
    ensureRulesSuiteEnabled();
    return requestData(
      buildUrl(`/rule-sets/${encodeURIComponent(ruleSetId)}/versions`),
      { method: 'GET' },
      (payload) => ruleSetVersionSchema.array().parse(payload),
    );
  };

  const getRuleSetVersion = (ruleSetId: string, version: number | string) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl(`/rule-sets/${encodeURIComponent(ruleSetId)}/versions/${encodeURIComponent(String(version))}`),
      { method: 'GET' },
      ruleSetVersionExpandedSchema.parse,
    );
  };

  const createRuleSetVersion = (ruleSetId: string, input: RuleSetVersionForRuleSetCreateInput) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl(`/rule-sets/${encodeURIComponent(ruleSetId)}/versions`),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(ruleSetVersionForRuleSetCreateSchema.parse(input)),
      },
      ruleSetVersionExpandedSchema.parse,
    );
  };

  const patchRuleSetVersion = (
    ruleSetId: string,
    version: number | string,
    input: RuleSetVersionPatchInput,
    options?: { ifMatch?: string | null },
  ) => {
    ensureRulesSuiteEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/rule-sets/${encodeURIComponent(ruleSetId)}/versions/${encodeURIComponent(String(version))}`),
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(ruleSetVersionPatchSchema.parse(input)),
      },
      ruleSetVersionExpandedSchema.parse,
    );
  };

  // --- Ruleset-as-text (SRL document) authoring -----------------------------

  /** Export a rule set as a single SRL document. `prologue` is presentation only. */
  const exportRuleSetSrl = (
    ruleSetId: string,
    input?: { version?: number | null; prologue?: string | null },
  ) => {
    ensureRulesSuiteEnabled();
    const params = new URLSearchParams();
    if (input?.version !== undefined && input.version !== null) params.set('version', String(input.version));
    if (input?.prologue) params.set('prologue', input.prologue);
    const query = params.toString() ? `?${params.toString()}` : '';
    return requestData(
      buildUrl(`/rule-sets/${encodeURIComponent(ruleSetId)}/srl${query}`),
      { method: 'GET' },
      // A parser is mandatory: parseResponse returns undefined without one.
      (payload) => payload as RuleSetSrlExport,
    );
  };

  /** Dry-run an SRL import: what would be created, updated, or detached. */
  const previewRuleSetSrl = (
    ruleSetId: string,
    srl: string,
    version?: number | null,
    options?: { tuples?: boolean; tupleSeeds?: string | null },
  ) => {
    ensureRulesSuiteEnabled();
    const body: Record<string, unknown> = { srl };
    if (version !== undefined && version !== null) body.version = String(version);
    if (options?.tuples) body.tuples = true;
    if (options?.tupleSeeds) body.tupleSeeds = options.tupleSeeds;
    return requestData(
      buildUrl(`/rule-sets/${encodeURIComponent(ruleSetId)}/srl/preview`),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
      (payload) => payload as RuleSetSrlPreview,
    );
  };

  /**
   * Compile each rule of a document to the SPARQL it is equivalent to.
   *
   * Not scoped to a rule set: it reads only the text it is given, so an unsaved
   * draft can use it too.
   */
  const compileRuleSetSrl = (
    srl: string,
    options?: { tuples?: boolean; flavour?: RuleSetSrlCompileFlavour },
  ) => {
    ensureRulesSuiteEnabled();
    const body: Record<string, unknown> = { srl };
    if (options?.tuples) body.tuples = true;
    if (options?.flavour === 'construct') body.flavour = 'construct';
    return requestData(
      buildUrl('/rule-sets/srl/compile'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
      (payload) => payload as RuleSetSrlCompileResult,
    );
  };

  /**
   * Convert a CONSTRUCT or INSERT … WHERE query into a rule.
   *
   * Like analyze, an unconvertible query is a successful response carrying the
   * reasons rather than a rejected request — pasting a SELECT is a state the
   * import dialog renders, not a transport failure.
   */
  const ruleFromSparql = (
    query: string,
    options?: { targetPrologue?: string; name?: string },
  ) => {
    ensureRulesSuiteEnabled();
    return requestData(
      buildUrl('/rule-sets/srl/from-sparql'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          query,
          targetPrologue: options?.targetPrologue ?? '',
          ...(options?.name ? { name: options.name } : {}),
        }),
      },
      (payload) => payload as SparqlImportResult,
    );
  };

  /**
   * Analyze a document: block spans, stratification, well-formedness.
   *
   * Runs while the document is being typed, so a syntax error comes back as
   * `valid: false` rather than as a rejected request — see the route.
   */
  const analyzeRuleSetSrl = (srl: string, options?: { tuples?: boolean }) => {
    ensureRulesSuiteEnabled();
    if (options?.tuples === true) ensureRuleTuplesEnabled();
    return requestData(
      buildUrl('/rule-sets/srl/analyze'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ srl, tuples: options?.tuples === true }),
      },
      (payload) => payload as RuleSetSrlAnalysis,
    );
  };

  /** Apply an SRL import, creating a new rule set version. */
  const importRuleSetSrl = (
    ruleSetId: string,
    srl: string,
    input?: {
      version?: number | null;
      comment?: string | null;
      tuples?: boolean;
      tupleSeeds?: string | null;
    },
  ) => {
    ensureRulesSuiteEnabled();
    if (input?.tuples === true || (input?.tupleSeeds ?? '').trim()) ensureRuleTuplesEnabled();
    const body: Record<string, unknown> = { srl };
    if (input?.version !== undefined && input.version !== null) body.version = String(input.version);
    if (input?.comment) body.comment = input.comment;
    if (input?.tuples) body.tuples = true;
    if (input?.tupleSeeds) body.tupleSeeds = input.tupleSeeds;
    return requestData(
      buildUrl(`/rule-sets/${encodeURIComponent(ruleSetId)}/srl`),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
      (payload) => payload as RuleSetSrlImportResult,
    );
  };

  const executeRuleSet = (
    ruleSetId: string,
    input?: {
      version?: number | null;
      maxIterations?: number | null;
      inferenceFormat?: string | null;
      dataGraphVersionId?: string | null;
      /**
       * The graph itself, floating to its current version — the same three ways
       * in the route takes (`lib/dataGraphInput.ts`). It was missing here while
       * the other two were carried, so a caller holding a graph id had to look
       * its version up first to run rules over it.
       */
      dataGraphId?: string | null;
      dataGraphInline?: string | null;
      dataGraphInlineFormat?: string | null;
    },
  ) => {
    ensureRulesSuiteEnabled();
    const body: Record<string, unknown> = {};
    if (input?.version !== undefined && input.version !== null) {
      body.version = input.version;
    }
    if (input?.maxIterations !== undefined && input.maxIterations !== null) {
      body.maxIterations = input.maxIterations;
    }
    if (input?.inferenceFormat !== undefined && input.inferenceFormat !== null) {
      body.inferenceFormat = input.inferenceFormat;
    }
    if (input?.dataGraphVersionId) body.dataGraphVersionId = input.dataGraphVersionId;
    if (input?.dataGraphId) body.dataGraphId = input.dataGraphId;
    if (input?.dataGraphInline) {
      body.dataGraphInline = input.dataGraphInline;
      if (input.dataGraphInlineFormat) body.dataGraphInlineFormat = input.dataGraphInlineFormat;
    }
    return requestData(
      buildUrl(`/rule-sets/${encodeURIComponent(ruleSetId)}/execute`),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      },
      (payload) => ruleSetExecutionResponseSchema.parse(payload),
    );
  };

  const listRuleVersions = (ruleId: string) => {
    ensureRulesSuiteEnabled();
    return requestData(
      buildUrl(`/rules/${encodeURIComponent(ruleId)}/versions`),
      { method: 'GET' },
      (payload) => ruleVersionSchema.array().parse(payload),
    );
  };

  const getRuleVersion = (ruleId: string, version: number | string) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl(`/rules/${encodeURIComponent(ruleId)}/versions/${encodeURIComponent(String(version))}`),
      { method: 'GET' },
      ruleVersionSchema.parse,
    );
  };

  const createRuleVersion = (
    ruleId: string,
    input: { ruleString: string; comment?: string | null; defaultBackend?: string | null; allowInvalidSave?: boolean }
  ) => {
    ensureRulesSuiteEnabled();
    const body: Record<string, unknown> = {
      ruleString: input.ruleString,
    };
    if (input.comment !== undefined) {
      body.comment = input.comment;
    }
    if (input.defaultBackend !== undefined) {
      body.defaultBackend = input.defaultBackend;
    }
    if (input.allowInvalidSave !== undefined) {
      body.allowInvalidSave = input.allowInvalidSave;
    }
    return request(
      buildUrl(`/rules/${encodeURIComponent(ruleId)}/versions`),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      },
      ruleVersionSchema.parse,
    );
  };

  /**
   * Annotate a rule version. A version is a snapshot (issue #192): its
   * content is what a reference to it means, so only the comment is writable.
   */
  const annotateRuleVersion = (
    ruleId: string,
    version: number | string,
    input: { comment?: string | null }
  ) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl(`/rules/${encodeURIComponent(ruleId)}/versions/${encodeURIComponent(String(version))}`),
      {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ comment: input.comment ?? null }),
      },
      ruleVersionSchema.parse,
    );
  };

  /*
   * Data graphs — the input a rule set runs against, distinct from its DATA
   * blocks. Registered in the library like anything else, so a run can name a
   * version id and be reproducible.
   */
  const listDataGraphs = () => {
    ensureRulesSuiteEnabled();
    return requestData(buildUrl('/data-graphs'), { method: 'GET' }, (payload) => dataGraphSchema.array().parse(payload));
  };

  const getDataGraph = (id: string) => {
    ensureRulesSuiteEnabled();
    return request(buildUrl(`/data-graphs/${encodeURIComponent(id)}`), { method: 'GET' }, dataGraphSchema.parse);
  };

  const createDataGraph = (input: DataGraphCreateInput) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl('/data-graphs'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(dataGraphCreateSchema.parse(input)) },
      dataGraphSchema.parse,
    );
  };

  const updateDataGraph = (id: string, input: DataGraphUpdateInput, options?: { ifMatch?: string | null }) => {
    ensureRulesSuiteEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/data-graphs/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(dataGraphUpdateSchema.parse(input)) },
      dataGraphSchema.parse,
    );
  };

  const deleteDataGraph = async (id: string) => {
    ensureRulesSuiteEnabled();
    await requestData(buildUrl(`/data-graphs/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  const listDataGraphVersions = (dataGraphId: string) => {
    ensureRulesSuiteEnabled();
    return requestData(
      buildUrl(`/data-graphs/${encodeURIComponent(dataGraphId)}/versions`),
      { method: 'GET' },
      (payload) => dataGraphVersionSchema.array().parse(payload),
    );
  };

  const getDataGraphVersion = (dataGraphId: string, version: number | string) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl(`/data-graphs/${encodeURIComponent(dataGraphId)}/versions/${encodeURIComponent(String(version))}`),
      { method: 'GET' },
      dataGraphVersionSchema.parse,
    );
  };

  /**
   * A version's note, and nothing else.
   *
   * The version's content is a snapshot and the API refuses to rewrite it
   * (issue #192); the comment is the one field a PATCH may carry, which is
   * what makes annotating a version from the Details list possible at all.
   */
  const annotateDataGraphVersion = (
    dataGraphId: string,
    version: number | string,
    comment: string | null,
  ) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl(`/data-graphs/${encodeURIComponent(dataGraphId)}/versions/${encodeURIComponent(String(version))}`),
      { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ comment }) },
      dataGraphVersionSchema.parse,
    );
  };

  const createDataGraphVersion = (
    dataGraphId: string,
    input: { contentString: string; contentFormat?: string | null; comment?: string | null },
  ) => {
    ensureRulesSuiteEnabled();
    const body: Record<string, unknown> = { contentString: input.contentString };
    if (input.contentFormat) body.contentFormat = input.contentFormat;
    if (input.comment !== undefined) body.comment = input.comment;
    return request(
      buildUrl(`/data-graphs/${encodeURIComponent(dataGraphId)}/versions`),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
      dataGraphVersionSchema.parse,
    );
  };

  /*
   * Tuple sets — the tabular sibling of data graphs.
   *
   * Where a data graph is the RDF a rule set runs *against*, a tuple set is the
   * rows a query's VALUES clause or a rule set's TUPLE(…) declaration is
   * *filled with*. Both are library-scoped static assets, so they get the same
   * shape of client; what differs is that content is normalised to SPARQL
   * Results JSON on import, which is why creating a version states the source
   * format rather than the content type.
   *
   * **Reading one is not gated, and the four reads below say so by omission.**
   * `tupleSets` draws a rail section; it does not decide whether a tuple set
   * exists. The server registers `/tuple-sets` without consulting the flag, in
   * as many words — "gating it would leave argument sets referencing versions
   * nothing could resolve" — and a browser that refuses the same reads produces
   * exactly the state that comment set out to prevent. It is not merely an
   * empty picker: `useArgumentSets.referenceRows` sends *values* for a draft
   * run and contributes nothing for a reference it could not resolve, so with
   * the section off a clause backed by a tuple set ran against fewer rows and
   * said nothing about it. See `docs/reference/feature-flags.md`.
   *
   * Writing one still is. Creating, editing, deleting or importing a tuple set
   * is authoring a record in the section — and where a screen outside the
   * section offers that, the control is absent rather than refused, which is
   * what leaves this refusal as a backstop rather than the gate.
   */
  const ensureTupleSetsEnabled = () => ensureFeatureEnabled('tupleSets');

  const listTupleSets = (filter?: { library?: string | null }) => {
    const search = new URLSearchParams();
    if (filter?.library) search.set('library', filter.library);
    const suffix = search.toString();
    return requestData(
      buildUrl(`/tuple-sets${suffix ? `?${suffix}` : ''}`),
      { method: 'GET' },
      (payload) => tupleSetSchema.array().parse(payload),
    );
  };

  const getTupleSet = (id: string) => {
    return request(buildUrl(`/tuple-sets/${encodeURIComponent(id)}`), { method: 'GET' }, tupleSetSchema.parse);
  };

  const createTupleSet = (input: TupleSetCreateInput) => {
    ensureTupleSetsEnabled();
    return request(
      buildUrl('/tuple-sets'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(tupleSetCreateSchema.parse(input)) },
      tupleSetSchema.parse,
    );
  };

  const updateTupleSet = (id: string, input: TupleSetUpdateInput, options?: { ifMatch?: string | null }) => {
    ensureTupleSetsEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/tuple-sets/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(tupleSetUpdateSchema.parse(input)) },
      tupleSetSchema.parse,
    );
  };

  const deleteTupleSet = async (id: string) => {
    ensureTupleSetsEnabled();
    await requestData(buildUrl(`/tuple-sets/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  const listTupleSetVersions = (tupleSetId: string) => {
    return requestData(
      buildUrl(`/tuple-sets/${encodeURIComponent(tupleSetId)}/versions`),
      { method: 'GET' },
      (payload) => tupleSetVersionSchema.array().parse(payload),
    );
  };

  const getTupleSetVersion = (tupleSetId: string, version: number | string) => {
    return request(
      buildUrl(`/tuple-sets/${encodeURIComponent(tupleSetId)}/versions/${encodeURIComponent(String(version))}`),
      { method: 'GET' },
      tupleSetVersionSchema.parse,
    );
  };

  /** The note on a tuple set version; its content is immutable. */
  const annotateTupleSetVersion = (
    tupleSetId: string,
    version: number | string,
    comment: string | null,
  ) => {
    ensureTupleSetsEnabled();
    return request(
      buildUrl(`/tuple-sets/${encodeURIComponent(tupleSetId)}/versions/${encodeURIComponent(String(version))}`),
      { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ comment }) },
      tupleSetVersionSchema.parse,
    );
  };

  /**
   * `sourceFormat` is required and has no default, deliberately: plain TSV and
   * SPARQL Results TSV share an extension and mean very different things — one
   * takes every cell as a string, the other as a typed RDF term — so guessing
   * would type or un-type a whole dataset invisibly.
   */
  const createTupleSetVersion = (
    tupleSetId: string,
    input: {
      contentString: string;
      sourceFormat: TupleSourceFormat;
      comment?: string | null;
      /** Column-type suggestions the author accepted (issue #208), by column name. */
      columnTypes?: Record<string, SuggestedColumnType>;
    },
  ) => {
    ensureTupleSetsEnabled();
    const body: Record<string, unknown> = {
      contentString: input.contentString,
      sourceFormat: input.sourceFormat,
    };
    if (input.comment !== undefined) body.comment = input.comment;
    if (input.columnTypes && Object.keys(input.columnTypes).length > 0) {
      body.columnTypes = input.columnTypes;
    }
    return request(
      buildUrl(`/tuple-sets/${encodeURIComponent(tupleSetId)}/versions`),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
      tupleSetVersionSchema.parse,
    );
  };

  /**
   * Save an ETL job's rows as a version, by naming the job rather than the rows.
   *
   * The one version-creating call that sends no content: the server runs the
   * job version's SQL, types the columns through its mapping, and snapshots
   * what came back (`lib/tupleSetFromEtl.ts`, issue #211). So there is nothing
   * for the browser to serialise, and nothing it could type differently.
   *
   * `columnMappingVersionId` is left out by callers that want the job version's
   * own mapping, which is the one the screen is showing — it is a pin for
   * re-snapshotting an older typing, not a field the editor fills in.
   */
  const createTupleSetVersionFromEtl = (
    tupleSetId: string,
    input: {
      etlJobVersionId: string;
      columnMappingVersionId?: string | null;
      comment?: string | null;
    },
  ) => {
    ensureTupleSetsEnabled();
    const body: Record<string, unknown> = { etlJobVersionId: input.etlJobVersionId };
    if (input.columnMappingVersionId) body.columnMappingVersionId = input.columnMappingVersionId;
    if (input.comment !== undefined) body.comment = input.comment;
    return request(
      buildUrl(`/tuple-sets/${encodeURIComponent(tupleSetId)}/versions/from-etl`),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
      tupleSetVersionSchema.parse,
    );
  };

  /**
   * Parse without storing, so the editor can show real rows before a save.
   *
   * Deliberately a round trip rather than a client-side parser: interpretation
   * is part of a version's meaning, and two parsers that can disagree is the
   * drift normalising on import exists to prevent. `columnTypes` carries any
   * suggestions the author has already accepted, so the preview reflects the
   * outcome a save would produce.
   */
  const previewTupleContent = (
    contentString: string,
    sourceFormat: TupleSourceFormat,
    columnTypes?: Record<string, SuggestedColumnType>,
  ) => {
    ensureTupleSetsEnabled();
    const body: Record<string, unknown> = { contentString, sourceFormat };
    if (columnTypes && Object.keys(columnTypes).length > 0) body.columnTypes = columnTypes;
    return requestData(
      buildUrl('/tuple-sets/preview'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      },
      (payload) => previewTupleContentSchema.parse(payload),
    );
  };

  /** Advisory only — pre-selects a default in the import dialog. */
  const detectTupleFormat = (contentString: string) => {
    ensureTupleSetsEnabled();
    return requestData(
      buildUrl('/tuple-sets/detect-format'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ contentString }) },
      (payload) => detectTupleFormatSchema.parse(payload).suggested,
    );
  };

  /*
   * Tests. `subject` narrows the list to one callable, which is what the Tests
   * tab on a record page is — the same list, filtered, so the two views cannot
   * disagree about what exists.
   */
  const listTests = (filter?: {
    subject?: string | null;
    subjectKind?: string | null;
    /** Tag IRIs. Sent comma-separated, which is the one spelling the API takes. */
    tags?: string[] | null;
    match?: TagMatchMode | null;
  }) => {
    ensureFeatureEnabled('tests');
    const params = new URLSearchParams();
    if (filter?.subject) params.set('subject', filter.subject);
    if (filter?.subjectKind) params.set('subjectKind', filter.subjectKind);
    if (filter?.tags?.length) params.set('tags', filter.tags.join(','));
    if (filter?.match) params.set('match', filter.match);
    const query = params.toString() ? `?${params.toString()}` : '';
    return requestData(buildUrl(`/tests${query}`), { method: 'GET' }, (payload) => testSchema.array().parse(payload));
  };

  const getTest = (id: string) => {
    ensureFeatureEnabled('tests');
    return request(buildUrl(`/tests/${encodeURIComponent(id)}`), { method: 'GET' }, testSchema.parse);
  };

  const createTest = (input: TestCreateInput) => {
    ensureFeatureEnabled('tests');
    return request(
      buildUrl('/tests'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(testCreateSchema.parse(input)) },
      testSchema.parse,
    );
  };

  const updateTest = (id: string, input: TestUpdateInput, options?: { ifMatch?: string | null }) => {
    ensureFeatureEnabled('tests');
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/tests/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(testUpdateSchema.parse(input)) },
      testSchema.parse,
    );
  };

  const deleteTest = async (id: string) => {
    ensureFeatureEnabled('tests');
    await requestData(buildUrl(`/tests/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  /*
   * Tags — classification within a library, behind no feature flag because
   * every section's list can group by them and a flag would make that grouping
   * appear and disappear per section.
   *
   * `library` narrows the list server-side. It is always passed in practice:
   * a tag only means anything inside its own library, so the unscoped list is
   * of no use to any screen.
   */
  const listTags = (library?: string | null) => {
    const suffix = library ? `?library=${encodeURIComponent(library)}` : '';
    return requestData(buildUrl(`/tags${suffix}`), { method: 'GET' }, (payload) => tagSchema.array().parse(payload));
  };

  const getTag = (id: string) => request(buildUrl(`/tags/${encodeURIComponent(id)}`), { method: 'GET' }, tagSchema.parse);

  const createTag = (input: TagCreateInput) =>
    request(
      buildUrl('/tags'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(tagCreateSchema.parse(input)) },
      tagSchema.parse,
    );

  const updateTag = (id: string, input: TagUpdateInput, options?: { ifMatch?: string | null }) => {
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/tags/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(tagUpdateSchema.parse(input)) },
      tagSchema.parse,
    );
  };

  /** Deleting a tag unlabels what carried it; the server sweeps, nothing cascades. */
  const deleteTag = async (id: string) => {
    await requestData(buildUrl(`/tags/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  const listTestVersions = (testId: string) => {
    ensureFeatureEnabled('tests');
    return requestData(
      buildUrl(`/tests/${encodeURIComponent(testId)}/versions`),
      { method: 'GET' },
      (payload) => testVersionSchema.array().parse(payload),
    );
  };

  const createTestVersion = (testId: string, input: Record<string, unknown>) => {
    ensureFeatureEnabled('tests');
    return request(
      buildUrl(`/tests/${encodeURIComponent(testId)}/versions`),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
      testVersionSchema.parse,
    );
  };

  /** The note on a test version; its content is immutable. */
  const annotateTestVersion = (testId: string, version: number | string, comment: string | null) => {
    ensureFeatureEnabled('tests');
    return request(
      buildUrl(`/tests/${encodeURIComponent(testId)}/versions/${encodeURIComponent(String(version))}`),
      { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ comment }) },
      testVersionSchema.parse,
    );
  };

  const runTest = (testId: string, input?: { version?: number | null }) => {
    ensureFeatureEnabled('tests');
    const body: Record<string, unknown> = {};
    if (input?.version !== undefined && input.version !== null) body.version = input.version;
    return requestData(
      buildUrl(`/tests/${encodeURIComponent(testId)}/run`),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
      (payload) => testRunResultSchema.parse(payload),
    );
  };

  /**
   * Run every test carrying one or more tags, server-side.
   *
   * One request rather than the rail's loop of N: the server holds the
   * selection, so "run the negation tests" means the same thing to the SPA, to
   * a script and to CI. The verdicts come back in the order they ran, so a
   * caller can write them into a store as-is.
   */
  const runTestsByTags = (input: { tags: string[]; match?: TagMatchMode }) => {
    ensureFeatureEnabled('tests');
    return requestData(
      buildUrl('/tests/run'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ tags: input.tags, ...(input.match ? { match: input.match } : {}) }),
      },
      (payload) => taggedTestRunSchema.parse(payload),
    );
  };

  /**
   * Run tests and take the report away, in whatever format was asked for.
   *
   * Deliberately the same routes the SPA already runs tests through: export is
   * content negotiation on a run, not a second endpoint over stored results —
   * the library holds no run to fetch later. So an export *is* a run, and the
   * verdicts it reports are the ones it just produced rather than whatever this
   * tab last saw.
   */
  const exportTestRun = (
    testId: string,
    input: { accept: string; filename: string; version?: number | null },
  ) => {
    ensureFeatureEnabled('tests');
    const body: Record<string, unknown> = {};
    if (input.version !== undefined && input.version !== null) body.version = input.version;
    return requestReport(
      buildUrl(`/tests/${encodeURIComponent(testId)}/run`),
      body,
      input.accept,
      input.filename,
    );
  };

  const exportTaggedTestRun = (
    input: { tags: string[]; match?: TagMatchMode; accept: string; filename: string },
  ) => {
    ensureFeatureEnabled('tests');
    return requestReport(
      buildUrl('/tests/run'),
      { tags: input.tags, ...(input.match ? { match: input.match } : {}) },
      input.accept,
      input.filename,
    );
  };

  /**
   * The same suite run, for a set of tests the caller names.
   *
   * What a tag cannot express: the whole list, one heading of it, the failures
   * of the last run. One request, so the report describes a single run of the
   * whole selection rather than a stapled-together pile of one-test reports.
   */
  const exportSelectedTestRun = (
    input: { tests: string[]; accept: string; filename: string },
  ) => {
    ensureFeatureEnabled('tests');
    return requestReport(
      buildUrl('/tests/run'),
      { tests: input.tests },
      input.accept,
      input.filename,
    );
  };

  const listDataBlocks = () => {
    ensureRulesSuiteEnabled();
    return requestData(buildUrl('/data-blocks'), { method: 'GET' }, (payload) => dataBlockSchema.array().parse(payload));
  };

  const getDataBlock = (id: string) => {
    ensureRulesSuiteEnabled();
    return request(buildUrl(`/data-blocks/${encodeURIComponent(id)}`), { method: 'GET' }, dataBlockSchema.parse);
  };

  const createDataBlock = (input: DataBlockCreateInput) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl('/data-blocks'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(dataBlockCreateSchema.parse(input)) },
      dataBlockSchema.parse,
    );
  };

  const updateDataBlock = (id: string, input: DataBlockUpdateInput, options?: { ifMatch?: string | null }) => {
    ensureRulesSuiteEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/data-blocks/${encodeURIComponent(id)}`),
      { method: 'PUT', headers, body: JSON.stringify(dataBlockUpdateSchema.parse(input)) },
      dataBlockSchema.parse,
    );
  };

  const deleteDataBlock = async (id: string) => {
    ensureRulesSuiteEnabled();
    await requestData(buildUrl(`/data-blocks/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return true;
  };

  const listDataBlockVersions = (dataBlockId: string) => {
    ensureRulesSuiteEnabled();
    return requestData(
      buildUrl(`/data-blocks/${encodeURIComponent(dataBlockId)}/versions`),
      { method: 'GET' },
      (payload) => dataBlockVersionSchema.array().parse(payload),
    );
  };

  const getDataBlockVersion = (dataBlockId: string, version: number | string) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl(`/data-blocks/${encodeURIComponent(dataBlockId)}/versions/${encodeURIComponent(String(version))}`),
      { method: 'GET' },
      dataBlockVersionSchema.parse,
    );
  };

  const createDataBlockVersion = (
    dataBlockId: string,
    input: { dataString: string; comment?: string | null; defaultBackend?: string | null; allowInvalidSave?: boolean }
  ) => {
    ensureRulesSuiteEnabled();
    const body: Record<string, unknown> = {
      dataString: input.dataString,
    };
    if (input.comment !== undefined) {
      body.comment = input.comment;
    }
    if (input.defaultBackend !== undefined) {
      body.defaultBackend = input.defaultBackend;
    }
    if (input.allowInvalidSave !== undefined) {
      body.allowInvalidSave = input.allowInvalidSave;
    }
    return request(
      buildUrl(`/data-blocks/${encodeURIComponent(dataBlockId)}/versions`),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      },
      dataBlockVersionSchema.parse,
    );
  };

  /**
   * Annotate a data block version. A version is a snapshot (issue #192): its
   * content is what a reference to it means, so only the comment is writable.
   */
  const annotateDataBlockVersion = (
    dataBlockId: string,
    version: number | string,
    input: { comment?: string | null }
  ) => {
    ensureRulesSuiteEnabled();
    return request(
      buildUrl(`/data-blocks/${encodeURIComponent(dataBlockId)}/versions/${encodeURIComponent(String(version))}`),
      {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ comment: input.comment ?? null }),
      },
      dataBlockVersionSchema.parse,
    );
  };

  const detectInputs = (query: string) => {
    ensurePlaygroundOrLibraryQueriesEnabled();
    return requestData(
      buildUrl('/detect-inputs'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(detectQueryRequestSchema.parse({ query })),
      },
      detectInputsResponseSchema.parse,
    );
  };

  const detectOutputs = (query: string) => {
    ensurePlaygroundOrLibraryQueriesEnabled();
    return requestData(
      buildUrl('/detect-outputs'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(detectQueryRequestSchema.parse({ query })),
      },
      detectOutputsResponseSchema.parse,
    );
  };

  const validateQuery = (query: string): Promise<ValidateQueryResponse> => {
    ensurePlaygroundOrLibraryQueriesEnabled();
    return requestData(
      buildUrl('/validate'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(detectQueryRequestSchema.parse({ query })),
      },
      validateQueryResponseSchema.parse,
    );
  };

  const validateRuleData = (ruleOrData: string): Promise<ValidateRuleDataResponse> => {
    ensurePlaygroundOrLibraryRulesEnabled();
    return requestData(
      buildUrl('/validate-rule-data'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(validateRuleDataRequestSchema.parse({ ruleOrData })),
      },
      validateRuleDataResponseSchema.parse,
    );
  };

  const formatCode = (code: string): Promise<FormatResponse> => {
    ensureFormattingEnabled();
    return requestData(
      buildUrl('/format'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(formatRequestSchema.parse({ code })),
      },
      formatResponseSchema.parse,
    );
  };

  const executeTarget = async (payload: ExecutionRequest, acceptMediaType?: string): Promise<ExecuteTargetResult> => {
    ensureQueriesEnabled();
    const url = buildUrl('/execute');
    const requestBody = JSON.stringify(executionRequestSchema.parse(payload));
    debug('useApiClient', 'executeTarget request', { url, payload, acceptMediaType });

    const headers: Record<string, string> = { ...JSON_HEADERS };
    if (acceptMediaType) {
      headers['Accept'] = acceptMediaType;
    }

    try {
      const startTime = performance.now();
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: requestBody,
      });
      const endTime = performance.now();
      const clientTotalMs = endTime - startTime;

      const contentType = normalizeHeaderValue(response.headers.get('content-type'));
      const serverTimingHeader = normalizeHeaderValue(response.headers.get('server-timing'));
      const text = await response.text();
      const timing = parseServerTiming(serverTimingHeader, clientTotalMs);

      debug('useApiClient', 'executeTarget response', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        contentType,
        serverTimingHeader,
        clientTotalMs: clientTotalMs.toFixed(2),
      });

      if (!response.ok) {
        let statusMessage = response.statusText || 'Execution failed';
        let parsedBody: ExecutionResponse | string | null = null;

        if (contentType && contentType.includes('application/json') && text) {
          try {
            const jsonPayload = JSON.parse(text);
            parsedBody = jsonPayload;
            if (jsonPayload && typeof jsonPayload === 'object' && 'error' in jsonPayload) {
              statusMessage = (jsonPayload as { error?: string }).error ?? statusMessage;
            }
          } catch {
            parsedBody = text;
          }
        } else {
          parsedBody = text || null;
        }

        throw createError({
          statusCode: response.status,
          statusMessage,
          data: parsedBody,
        });
      }

      return {
        body: text,
        contentType,
        timing,
      };
    } catch (error) {
      console.error('[useApiClient] executeTarget exception:', {
        url,
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  };

  /**
   * POST something and hand back the body as text, with timing.
   *
   * The execution surfaces answer in whatever format was asked for — SPARQL
   * results, an RDF serialisation, an RDF Patch document — so the client cannot
   * parse for the caller; it returns the bytes and the content type and lets
   * the caller decide. Shared so every one of them reports errors and timing
   * the same way.
   */
  const postForBody = async (
    url: string,
    body: unknown,
    acceptMediaType: string | undefined,
    label: string,
  ): Promise<ExecuteTargetResult> => {
    const requestBody = JSON.stringify(body);
    debug('useApiClient', `${label} request`, { url, payload: body, acceptMediaType });

    const headers: Record<string, string> = { ...JSON_HEADERS };
    if (acceptMediaType) {
      headers['Accept'] = acceptMediaType;
    }

    try {
      const startTime = performance.now();
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: requestBody,
      });
      const endTime = performance.now();
      const clientTotalMs = endTime - startTime;

      const contentType = normalizeHeaderValue(response.headers.get('content-type'));
      const serverTimingHeader = normalizeHeaderValue(response.headers.get('server-timing'));
      const text = await response.text();
      const timing = parseServerTiming(serverTimingHeader, clientTotalMs);

      debug('useApiClient', `${label} response`, {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        contentType,
        serverTimingHeader,
        clientTotalMs: clientTotalMs.toFixed(2),
      });

      if (!response.ok) {
        let statusMessage = response.statusText || 'SPARQL execution failed';
        let parsedBody: unknown = null;

        if (contentType && contentType.includes('application/json') && text) {
          try {
            const jsonPayload = JSON.parse(text);
            parsedBody = jsonPayload;
            if (jsonPayload && typeof jsonPayload === 'object' && 'error' in jsonPayload) {
              statusMessage = (jsonPayload as { error?: string }).error ?? statusMessage;
            }
          } catch {
            parsedBody = text;
          }
        } else {
          parsedBody = text || null;
        }

        throw createError({
          statusCode: response.status,
          statusMessage,
          data: parsedBody,
        });
      }

      return {
        body: text,
        contentType,
        timing,
      };
    } catch (error) {
      console.error(`[useApiClient] ${label} exception:`, {
        url,
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  };

  /**
   * Apply arguments to a query and get the text back, without running it.
   *
   * `POST /substitute` — the server half of a browser-side run. Finding a
   * parameter's span needs a parser and a named argument set needs the store,
   * so the substitution stays here; where the result runs does not have to.
   */
  const substituteQuery = (payload: {
    query: string;
    arguments?: SparqlRequest['arguments'];
    limits?: SparqlRequest['limits'];
    offsets?: SparqlRequest['offsets'];
    argumentSetIds?: string[];
  }) =>
    requestData(
      buildUrl('/substitute'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) },
      (body) => body as { query: string; operation: 'query' | 'update' },
    );

  /**
   * Run it in the tab, when the chosen backend is one this browser holds.
   *
   * Returns `null` when the backend is not a browser backend, so the caller
   * falls through to the server exactly as before — the check is on the id, and
   * nothing else about the payload changes shape.
   *
   * The two halves are deliberately split: sqlib substitutes, the browser
   * executes. A query with nothing to substitute skips the round trip entirely,
   * which is the common case on a demo and the one where the endpoint never
   * learns that sqlib was involved at all.
   */
  const runOnBrowserBackend = async (
    payload: SparqlRequest,
    acceptMediaType?: string,
  ): Promise<ExecuteTargetResult | null> => {
    const backend = useBrowserBackends().get(payload.backendId ?? null);
    if (!backend) return null;

    const needsSubstitution = Boolean(
      payload.arguments?.length ||
        payload.limits?.length ||
        payload.offsets?.length ||
        payload.argumentSetIds?.length,
    );

    let query = payload.query;
    let operation: 'query' | 'update' = looksLikeUpdate(query) ? 'update' : 'query';
    if (needsSubstitution) {
      const substituted = await substituteQuery({
        query: payload.query,
        arguments: payload.arguments,
        limits: payload.limits,
        offsets: payload.offsets,
        argumentSetIds: payload.argumentSetIds,
      });
      query = substituted.query;
      operation = substituted.operation;
    }

    return executeOnBrowserBackend({ backend, query, acceptMediaType, operation });
  };

  const executeSparqlDirect = async (
    payload: SparqlRequest,
    acceptMediaType?: string
  ): Promise<ExecuteTargetResult> => {
    ensurePlaygroundOrLibraryQueriesEnabled();
    const inBrowser = await runOnBrowserBackend(payload, acceptMediaType);
    if (inBrowser) return inBrowser;
    const parsedPayload = sparqlRequestSchema.parse(payload);
    return postForBody(buildUrl('/sparql'), parsedPayload, acceptMediaType, 'executeSparqlDirect');
  };

  /**
   * The diff an unsaved update would make, as an RDF Patch document.
   *
   * An update query's output is its patch (#290), and a saved one gets it from
   * `/execute`. A draft has no version to name, so it asks the surface that
   * takes the SPARQL directly — `POST /patches/preview`, which is read-only by
   * construction. Deliberately *not* the raw `/sparql` proxy: that one runs the
   * update, and the whole point of this format is that nothing is written.
   */
  const previewUpdatePatch = async (
    payload: { updateString: string; backendId: string },
  ): Promise<ExecuteTargetResult> => {
    ensurePlaygroundOrLibraryQueriesEnabled();
    return postForBody(buildUrl('/patches/preview'), payload, PATCH_MEDIA_TYPES.RDF_PATCH, 'previewUpdatePatch');
  };

  const runSparql = async (payload: SparqlRequest) => {
    ensurePlaygroundOrLibraryQueriesEnabled();
    const inBrowser = await runOnBrowserBackend(payload);
    if (inBrowser) {
      // The browser path hands back the endpoint's own bytes; this caller wants
      // them parsed, and the same schema decides what counts as a result.
      return sparqlResponseSchema.parse(JSON.parse(inBrowser.body)) as SparqlResponse;
    }
    return requestData(
      buildUrl('/sparql'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(sparqlRequestSchema.parse(payload)),
      },
      (body) => sparqlResponseSchema.parse(body) as SparqlResponse,
    );
  };

  // ========================================================================
  // Argument Sets API
  // ========================================================================

  const argumentSetVersionSchema = z.object({
    id: z.string(),
    isPartOf: z.string(),
    version: z.number(),
    tupleBindings: z.array(z.any()),
    scalarBindings: z.array(z.any()),
    graphBindings: z.array(z.any()).optional(),
    dateCreated: z.string(),
    dateModified: z.string(),
  });

  const argumentSetSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    // Provenance, and null on a set composed from the rail rather than made on
    // a callable's screen. Nullable here as well as on the server, or the rail
    // listing would fail to parse exactly the rows it exists to show.
    scope: z.enum(['query', 'queryGroup']).nullable().optional(),
    targetId: z.string().nullable().optional(),
    libraryId: z.string().optional(),
    currentVersionId: z.string().nullable().optional(),
    currentVersion: argumentSetVersionSchema.nullable().optional(),
    tupleBindings: z.array(z.any()),
    scalarBindings: z.array(z.any()),
    graphBindings: z.array(z.any()).optional(),
    dateCreated: z.string(),
    dateModified: z.string(),
  });

  /**
   * Every argument set in a library, whatever callable it was made for.
   *
   * The listing the rail section needs, and the switcher's "elsewhere in the
   * library". `listArgumentSets` above is scoped to one target, so enumerating
   * a library through it was one request per query.
   */
  const listLibraryArgumentSets = (libraryId: string) => {
    ensureQueriesEnabled();
    return requestData(
      buildUrl(`/argument-sets?libraryId=${encodeURIComponent(libraryId)}`),
      { method: 'GET' },
      (payload) => z.array(argumentSetSchema).parse(payload),
    );
  };

  /** Create a set that names its own library — the rail's `+ New`. */
  const createStandaloneArgumentSet = (input: {
    name: string;
    description?: string;
    libraryId: string;
    scope?: 'query' | 'queryGroup' | null;
    targetId?: string | null;
    tupleBindings?: unknown[];
    scalarBindings?: unknown[];
    graphBindings?: unknown[];
  }) => {
    ensureQueriesEnabled();
    return request(
      buildUrl('/argument-sets'),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
      (payload) => argumentSetSchema.parse(payload),
    );
  };

  const buildArgumentSetsPath = (scope: 'query' | 'queryGroup', targetId: string) =>
    scope === 'query'
      ? `/queries/${encodeURIComponent(targetId)}/argument-sets`
      : `/query-groups/${encodeURIComponent(targetId)}/argument-sets`;

  /**
   * List all argument sets for a query or query group
   */
  const listArgumentSets = (targetId: string, scope: 'query' | 'queryGroup' = 'query') => {
    ensureQueriesEnabled();
    return requestData(
      buildUrl(buildArgumentSetsPath(scope, targetId)),
      { method: 'GET' },
      (payload) => {
        // Parse as array of argument sets
        return z.array(argumentSetSchema).parse(payload);
      }
    );
  };

  /**
   * Get a single argument set by ID
   */
  const getArgumentSet = (setId: string) => {
    ensureQueriesEnabled();
    return request(
      buildUrl(`/argument-sets/${encodeURIComponent(setId)}`),
      { method: 'GET' },
      (payload) => {
        return argumentSetSchema.parse(payload);
      }
    );
  };

  /**
   * Create a new argument set for a query or query group
   */
  const createArgumentSet = (targetId: string, input: {
    name: string;
    description?: string;
    tupleBindings?: unknown[];
    scalarBindings?: unknown[];
    graphBindings?: unknown[];
  }, scope: 'query' | 'queryGroup' = 'query') => {
    ensureQueriesEnabled();
    return request(
      buildUrl(buildArgumentSetsPath(scope, targetId)),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      },
      (payload) => {
        return argumentSetSchema.parse(payload);
      }
    );
  };

  /**
   * Rename a set, or reword its description.
   *
   * Entity metadata, so it writes no version: the bindings stay where they
   * are, on the versions that hold them, and nothing that pinned one is
   * disturbed. The name used to have no door but the save bar, whose version
   * body carries no name and dropped it.
   */
  const updateArgumentSet = (
    setId: string,
    input: { name?: string; description?: string | null },
    options?: { ifMatch?: string | null },
  ) => {
    ensureQueriesEnabled();
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/argument-sets/${encodeURIComponent(setId)}`),
      { method: 'PUT', headers, body: JSON.stringify(input) },
      (payload) => argumentSetSchema.parse(payload),
    );
  };

  /**
   * Delete an argument set
   */
  const deleteArgumentSet = async (setId: string, options?: { ifMatch?: string | null }) => {
    ensureQueriesEnabled();
    const headers: Record<string, string> = {};
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    await requestData(
      buildUrl(`/argument-sets/${encodeURIComponent(setId)}`),
      { method: 'DELETE', headers }
    );
    return true;
  };

  /**
   * Export an argument set as the execution-ready payload.
   *
   * `id` may name an `ArgumentSet` — answered from its current version — or an
   * `ArgumentSetVersion`, answered from that one. Callers that pinned a version
   * want the second: a test case runs the version it names, and the run bar
   * copies the payload it is about to send, neither of which is "whatever the
   * set says now".
   */
  const exportArgumentSet = (id: string) => {
    ensureQueriesEnabled();
    return requestData(
      buildUrl(`/argument-sets/${encodeURIComponent(id)}/export`),
      { method: 'GET' },
      (payload) => {
        const schema = z.object({
          arguments: z.array(z.any()),
          limits: z.array(z.object({ name: z.string(), value: z.number() })),
          offsets: z.array(z.object({ name: z.string(), value: z.number() })),
        });
        return schema.parse(payload);
      }
    );
  };

  /** Alias, named for what the two run-bar callers use it for. */
  const exportArgumentSetPayload = (id: string) => exportArgumentSet(id);

  const listArgumentSetVersions = (setId: string) => {
    ensureQueriesEnabled();
    return requestData(
      buildUrl(`/argument-sets/${encodeURIComponent(setId)}/v`),
      { method: 'GET' },
      (payload) => z.array(argumentSetVersionSchema).parse(payload),
    );
  };

  const getArgumentSetVersion = (setId: string, version: number) => {
    ensureQueriesEnabled();
    return request(
      buildUrl(`/argument-sets/${encodeURIComponent(setId)}/v/${version}`),
      { method: 'GET' },
      (payload) => argumentSetVersionSchema.parse(payload),
    );
  };

  const createArgumentSetVersion = (setId: string, input: {
    tupleBindings?: unknown[];
    scalarBindings?: unknown[];
    graphBindings?: unknown[];
  }) => {
    ensureQueriesEnabled();
    return request(
      buildUrl(`/argument-sets/${encodeURIComponent(setId)}/v`),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      },
      (payload) => argumentSetVersionSchema.parse(payload),
    );
  };

  const patchArgumentSetVersion = (setId: string, version: number, input: {
    tupleBindings?: unknown[];
    scalarBindings?: unknown[];
  }) => {
    ensureQueriesEnabled();
    return request(
      buildUrl(`/argument-sets/${encodeURIComponent(setId)}/v/${version}`),
      {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      },
      (payload) => argumentSetVersionSchema.parse(payload),
    );
  };

  const exportArgumentSetVersion = (setId: string, version: number) => {
    ensureQueriesEnabled();
    return requestData(
      buildUrl(`/argument-sets/${encodeURIComponent(setId)}/v/${version}/export`),
      { method: 'GET' },
      (payload) => {
        const schema = z.object({
          arguments: z.array(z.any()),
          limits: z.array(z.object({ name: z.string(), value: z.number() })),
          offsets: z.array(z.object({ name: z.string(), value: z.number() })),
        });
        return schema.parse(payload);
      }
    );
  };

  // ========================================================================
  // Benchmark API
  // ========================================================================

  const listBenchmarkExperiments = () => {
    return requestData(
      buildUrl('/benchmark-experiments'),
      { method: 'GET' },
      (payload) => z.array(benchmarkExperimentSchema).parse(payload)
    );
  };

  const getBenchmarkExperiment = (id: string) => {
    return request(
      buildUrl(`/benchmark-experiments/${encodeURIComponent(id)}`),
      { method: 'GET' },
      benchmarkExperimentSchema.parse
    );
  };

  const createBenchmarkExperiment = (input: BenchmarkExperimentCreate) => {
    return request(
      buildUrl('/benchmark-experiments'),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(benchmarkExperimentCreateSchema.parse(input)),
      },
      benchmarkExperimentSchema.parse
    );
  };

  const updateBenchmarkExperiment = (
    id: string,
    input: BenchmarkExperimentUpdate,
    options?: { ifMatch?: string | null }
  ) => {
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/benchmark-experiments/${encodeURIComponent(id)}`),
      {
        method: 'PUT',
        headers,
        body: JSON.stringify(benchmarkExperimentUpdateSchema.parse(input)),
      },
      benchmarkExperimentSchema.parse
    );
  };

  const deleteBenchmarkExperiment = async (id: string) => {
    await requestData(
      buildUrl(`/benchmark-experiments/${encodeURIComponent(id)}`),
      { method: 'DELETE' }
    );
    return true;
  };

  const listBenchmarkVersions = (experimentId: string) => {
    return requestData(
      buildUrl(`/benchmark-experiments/${encodeURIComponent(experimentId)}/v`),
      { method: 'GET' },
      (payload) => z.array(benchmarkExperimentVersionSchema).parse(payload)
    );
  };

  const listBenchmarkRuns = (experimentId: string, version: number) => {
    return requestData(
      buildUrl(`/benchmark-experiments/${encodeURIComponent(experimentId)}/v/${version}/runs`),
      { method: 'GET' },
      (payload) => z.array(benchmarkRunSchema).parse(payload)
    );
  };

  const getBenchmarkRun = (runId: string) => {
    return request(
      buildUrl(`/benchmark-experiments/runs/${encodeURIComponent(runId)}`),
      { method: 'GET' },
      benchmarkRunSchema.parse
    );
  };

  const listBenchmarkRunObservations = (runId: string) => {
    return requestData(
      buildUrl(`/benchmark-experiments/runs/${encodeURIComponent(runId)}/observations`),
      { method: 'GET' },
      (payload) => z.array(benchmarkObservationSchema).parse(payload)
    );
  };

  const listBenchmarkRunNodeObservations = (runId: string) => {
    return requestData(
      buildUrl(`/benchmark-experiments/runs/${encodeURIComponent(runId)}/node-observations`),
      { method: 'GET' },
      (payload) => z.array(benchmarkNodeObservationSchema).parse(payload)
    );
  };

  /**
   * The passes of every rule-set request in the run.
   *
   * Sorted by request then by pass on the server, and read back in that order:
   * a sequence out of order says nothing about where the time went.
   */
  const listBenchmarkRunIterationObservations = (runId: string) => {
    return requestData(
      buildUrl(`/benchmark-experiments/runs/${encodeURIComponent(runId)}/iteration-observations`),
      { method: 'GET' },
      (payload) => z.array(benchmarkIterationObservationSchema).parse(payload)
    );
  };

  const getBenchmarkVersion = (experimentId: string, version: number) => {
    return request(
      buildUrl(`/benchmark-experiments/${encodeURIComponent(experimentId)}/v/${version}`),
      { method: 'GET' },
      benchmarkExperimentVersionSchema.parse
    );
  };

  const createBenchmarkVersion = (experimentId: string, input: BenchmarkExperimentVersionCreate) => {
    return request(
      buildUrl(`/benchmark-experiments/${encodeURIComponent(experimentId)}/v`),
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(benchmarkExperimentVersionCreateSchema.parse(input)),
      },
      benchmarkExperimentVersionSchema.parse
    );
  };

  const updateBenchmarkVersion = (
    experimentId: string,
    version: number,
    input: BenchmarkExperimentVersionUpdate,
    options?: { ifMatch?: string | null }
  ) => {
    const headers: Record<string, string> = { ...JSON_HEADERS };
    applyIfMatchHeader(headers, options?.ifMatch ?? null);
    return request(
      buildUrl(`/benchmark-experiments/${encodeURIComponent(experimentId)}/v/${version}`),
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(benchmarkExperimentVersionUpdateSchema.parse(input)),
      },
      benchmarkExperimentVersionSchema.parse
    );
  };

  const freezeBenchmarkVersion = (experimentId: string, version: number) => {
    return request(
      buildUrl(`/benchmark-experiments/${encodeURIComponent(experimentId)}/v/${version}/freeze`),
      { method: 'POST' },
      benchmarkExperimentVersionSchema.parse
    );
  };

  const executeBenchmarkRun = (experimentId: string, version: number) => {
    return requestData(
      buildUrl(`/benchmark-experiments/${encodeURIComponent(experimentId)}/v/${version}/run`),
      {
        method: 'POST',
        headers: JSON_HEADERS,
      },
      benchmarkRunResponseSchema.parse
    );
  };

  return {
    getLibraryExportBundle,
    getLibraryExportHtml,
    listBackends,
    getBackend,
    createBackend,
    updateBackend,
    getBackendReferences,
    listBackendProbes,
    probeAllBackends,
    probeBackend,
    getBackendProbeHistory,
    getBackendPrefixes,
    pushBackendPrefixes,
    getBackendEnv,
    getBackendUsage,
    deleteBackend,
    listLibraries,
    getLibrary,
    createLibrary,
    updateLibrary,
    deleteLibrary,
    listQueries,
    getQuery,
    createQuery,
    updateQuery,
    deleteQuery,
    listQueryVersions,
    getQueryVersion,
    createQueryVersion,
    patchQueryVersion,
    listQueryGroups,
    getQueryGroup,
    createQueryGroup,
    updateQueryGroup,
    deleteQueryGroup,
    listQueryGroupVersions,
    getQueryGroupVersion,
    createQueryGroupVersion,
    patchQueryGroupVersion,
    // Incremental query group building
    validateQueryGroupVersion,
    listRules,
    getRule,
    createRule,
    updateRule,
    deleteRule,
    listRuleSets,
    getRuleSet,
    createRuleSet,
    updateRuleSet,
    deleteRuleSet,
    listRuleSetVersions,
    getRuleSetVersion,
    createRuleSetVersion,
    patchRuleSetVersion,
    executeRuleSet,
    exportRuleSetSrl,
    previewRuleSetSrl,
    compileRuleSetSrl,
    analyzeRuleSetSrl,
    ruleFromSparql,
    importRuleSetSrl,
    executeRulesPlayground,
    listTests,
    getTest,
    createTest,
    updateTest,
    deleteTest,
    listTags,
    getTag,
    createTag,
    updateTag,
    deleteTag,
    listTestVersions,
    createTestVersion,
    annotateTestVersion,
    runTest,
    runTestsByTags,
    exportTestRun,
    exportTaggedTestRun,
    exportSelectedTestRun,
    listDataGraphs,
    getDataGraph,
    createDataGraph,
    updateDataGraph,
    deleteDataGraph,
    listDataGraphVersions,
    getDataGraphVersion,
    createDataGraphVersion,
    annotateDataGraphVersion,
    listTupleSets,
    getTupleSet,
    createTupleSet,
    updateTupleSet,
    deleteTupleSet,
    listTupleSetVersions,
    getTupleSetVersion,
    createTupleSetVersion,
    annotateTupleSetVersion,
    createTupleSetVersionFromEtl,
    detectTupleFormat,
    previewTupleContent,
    previewUpdatePatch,
    listRuleVersions,
    getRuleVersion,
    createRuleVersion,
    annotateRuleVersion,
    listDataBlocks,
    getDataBlock,
    createDataBlock,
    updateDataBlock,
    deleteDataBlock,
    listDataBlockVersions,
    getDataBlockVersion,
    createDataBlockVersion,
    annotateDataBlockVersion,
    detectInputs,
    detectOutputs,
    validateQuery,
    validateRuleData,
    formatCode,
    executeTarget,
    executeSparqlDirect,
    runSparql,
    substituteQuery,
    // Argument Sets
    listArgumentSets,
    listLibraryArgumentSets,
    createStandaloneArgumentSet,
    getArgumentSet,
    createArgumentSet,
    updateArgumentSet,
    deleteArgumentSet,
    exportArgumentSet,
    exportArgumentSetPayload,
    listArgumentSetVersions,
    getArgumentSetVersion,
    createArgumentSetVersion,
    patchArgumentSetVersion,
    exportArgumentSetVersion,
    // Benchmark
    listBenchmarkExperiments,
    getBenchmarkExperiment,
    createBenchmarkExperiment,
    updateBenchmarkExperiment,
    deleteBenchmarkExperiment,
    listBenchmarkVersions,
    listBenchmarkRuns,
    getBenchmarkRun,
    listBenchmarkRunObservations,
    listBenchmarkRunNodeObservations,
    listBenchmarkRunIterationObservations,
    getBenchmarkVersion,
    createBenchmarkVersion,
    updateBenchmarkVersion,
    freezeBenchmarkVersion,
    executeBenchmarkRun,
  };
}

// Export types for external use
export type {
  ValidationResponse,
  IdResponse,
};
