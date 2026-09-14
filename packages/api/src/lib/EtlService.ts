/**
 * ETL Service
 *
 * Handles ETL job management, column mapping, and execution orchestration.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toError } from './toError.js';
import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import {
  beginEtlExecution,
  completeEtlExecution,
  failEtlExecution,
  recordEtlExecutionProgress,
} from './etlRunLog.js';
import { ImmutableEntityError } from './immutability.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { duckDbService, mapDuckDbTypeToXsd, type DuckDbColumn, type PreviewResult } from './DuckDbService.js';
import type { LdkitEtlJob } from '../persistence/schemas/EtlJobSchema.js';
import type { LdkitEtlJobVersion } from '../persistence/schemas/EtlJobVersionSchema.js';
import type { LdkitEtlColumnMapping } from '../persistence/schemas/EtlColumnMappingSchema.js';
import type { LdkitEtlColumnMappingVersion, ColumnDefinition } from '../persistence/schemas/EtlColumnMappingVersionSchema.js';
import type { LdkitEtlExecution, EtlExecutionStatus } from '../persistence/schemas/EtlExecutionSchema.js';
import type { SparqlBinding } from './query-chaining.js';
import { SparqlQueryParser } from './parser.js';
import { ExecutorFactory } from './orchestration/ExecutorFactory.js';
import type { ISparqlExecutor } from '../server/ISparqlExecutor.js';
import type { ArgumentSet } from './orchestration/types.js';

/**
 * The lexical form of a DuckDB value for the literal it is mapped to.
 *
 * `DuckDbService` hands rows over as JSON values, so almost everything is
 * already the string the literal wants. The one shape that is not is DuckDB's
 * TIMESTAMP, whose JSON form separates date and time with a space —
 * `2020-01-02 03:04:05` — while `xsd:dateTime` requires `T`. Without this the
 * ETL emitted a literal that is ill-typed against the datatype it declares
 * (issue #200). The rewrite is scoped to columns actually mapped to
 * `xsd:dateTime`, so a VARCHAR column that happens to look like a timestamp is
 * left as it was sent.
 */
const XSD_DATE_TIME = 'http://www.w3.org/2001/XMLSchema#dateTime';
const DUCKDB_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

export function toLexicalForm(value: unknown, datatypeIri?: string): string {
  const lexical = String(value);
  if (datatypeIri === XSD_DATE_TIME && DUCKDB_TIMESTAMP.test(lexical)) {
    return lexical.replace(' ', 'T');
  }
  return lexical;
}

// Input/Output types

export interface EtlJobInput {
  name: string;
  description?: string;
  libraryId: string;
}

export interface EtlJobVersionInput {
  sql: string;
  sparqlTemplate: string;
  backendId: string;
  chunkSize?: number;
  comment?: string;
  immutable?: boolean;
}

export interface ColumnMappingInput {
  name: string;
  description?: string;
  columns: ColumnDefinition[];
}

export interface ColumnMappingVersionInput {
  columns: ColumnDefinition[];
  comment?: string;
  immutable?: boolean;
}

export interface ExecutionInput {
  etlJobVersionId?: string; // If not provided, uses currentVersion
  columnMappingVersionId?: string; // If not provided, uses currentColumnMappingVersion
  chunkSize?: number; // Override default chunkSize
  maxRows?: number; // Limit total rows processed
  dryRun?: boolean; // Only process chunk 0
}

export interface PreviewInput {
  sql: string;
  limit?: number;
}

/** One run of the chunk loop: rows in, constructed RDF out. */
export interface EtlPipelineRun {
  sql: string;
  sparqlTemplate: string;
  columnDefs: ColumnDefinition[];
  /**
   * Where the template runs.
   *
   * A job execution passes the executor for the version's `backendId`; a test
   * passes an ephemeral store, so the run has no side effect on anything shared.
   */
  executor: ISparqlExecutor;
  chunkSize: number;
  /** Statements run before `sql`, on a database private to this run. */
  fixtureSql?: string | null;
  maxRows?: number;
  /**
   * What `maxRows` means. `stop` (the default, and what a job execution wants)
   * ends the run at the next chunk boundary; `fail` throws, for a caller whose
   * result is only meaningful whole.
   */
  maxRowsPolicy?: 'stop' | 'fail';
  dryRun?: boolean;
  /**
   * Where each chunk's CONSTRUCT result goes, as soon as it exists.
   *
   * The pipeline holds no output of its own. A source of ten million rows
   * constructs tens of gigabytes of RDF, and a loop that kept every chunk's
   * result in an array to join at the end ran out of memory long before it
   * reached the last one. So the caller supplies the sink — a file for a job
   * execution, an array for a test whose rows are capped — and the loop hands
   * over one chunk at a time and forgets it.
   */
  onOutput: (rdf: string, chunk: EtlOutputChunk) => Promise<void>;
  /** Progress, after each chunk. A job execution records it; a test does not. */
  onChunk?: (progress: { completedChunks: number; totalRows: number }) => Promise<void>;
}

/** What is known about one chunk's CONSTRUCT result besides its text. */
export interface EtlOutputChunk {
  /** Zero-based position of the chunk in the run. */
  index: number;
  /** The Content-Type the executor reported for this result, if it did. */
  contentType?: string;
}

export interface EtlPipelineResult {
  totalRows: number;
  completedChunks: number;
}

// Detail types

export interface EtlJobDetail {
  id: string;
  name: string;
  description?: string;
  currentVersionId?: string;
  libraryIds: string[];
  dateCreated?: string;
  dateModified?: string;
}

export interface EtlJobVersionDetail {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean;
  sql: string;
  sparqlTemplate: string;
  backendId: string;
  currentColumnMappingVersionId?: string;
  chunkSize?: number;
  comment?: string;
  dateCreated?: string;
  dateModified?: string;
}

export interface ColumnMappingDetail {
  id: string;
  name: string;
  description?: string;
  currentVersionId?: string;
  etlJobVersionId: string;
  dateCreated?: string;
  dateModified?: string;
}

export interface ColumnMappingVersionDetail {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean;
  columns: ColumnDefinition[];
  comment?: string;
  dateCreated?: string;
  dateModified?: string;
}

export interface ExecutionDetail {
  id: string;
  etlJobVersionId: string;
  columnMappingVersionId: string;
  status: EtlExecutionStatus;
  startedAt: string;
  completedAt?: string;
  totalChunks?: number;
  completedChunks?: number;
  totalRows?: number;
  errorMessage?: string;
  errorChunk?: number;
  outputFormat?: string;
  outputLocation?: string;
  /** The tuple set version a tabular run ended at, when it was that sink (#211). */
  outputTupleSetVersionId?: string;
  /** True when that version already held these rows, so the run cut none. */
  outputReused?: boolean;
  executionConfig?: string;
}

export interface InferredMapping {
  columns: ColumnDefinition[];
}

export interface PreviewOutput extends PreviewResult {
  inferredMapping: InferredMapping;
}

export interface ExecutionResult {
  executionId: string;
  status: EtlExecutionStatus;
  /** The Content-Type of the written output, when any chunk produced one. */
  outputFormat?: string;
  /**
   * The file the run's RDF was written to, when any chunk produced output.
   *
   * The output is not returned in the result: it is written a chunk at a time
   * (see `EtlPipelineRun.onOutput`) and can be as large as the source, so the
   * caller reads it from here — `GET /etl-jobs/executions/:id/output` streams
   * it back.
   */
  outputLocation?: string;
  errorMessage?: string;
  totalChunks?: number;
  completedChunks?: number;
  totalRows?: number;
}

/**
 * Where job executions write their RDF. Read per run rather than at load, so
 * a deployment (or a test) that sets it after this module is imported is
 * still the one that decides.
 */
export function etlOutputDir(): string {
  return path.resolve(process.env.ETL_OUTPUT_DIR || './storage/etl-output');
}

/** What a writability preflight found, so callers can log it their own way. */
export type EtlOutputDirCheck = {
  dir: string;
  writable: boolean;
  /** The failure, when the directory could not be created or written to. */
  error?: string;
  /** Advice specific to the failure, when there is any worth giving. */
  hint?: string;
};

/**
 * Can this deployment write ETL output at all?
 *
 * Checked at boot rather than at the end of the first chunk, because the
 * failure it catches is a deployment one and shows up late otherwise: a fresh
 * container's `/app/packages/api/storage` was root-owned while the process runs
 * as uid 1000, so `mkdir storage/etl-output` failed with EACCES only once
 * somebody had built a job and run it (issue #466). The image now creates that
 * directory owned by `node`, but a host bind mount or a volume seeded by an
 * older image still carries whatever ownership it was given, and nothing in the
 * image can repair those.
 *
 * It creates the directory — the same `recursive: true` the output file does —
 * and writes and removes a probe file, since a directory that exists is not yet
 * a directory this uid may write to. Never throws: a deployment that cannot
 * write output should still boot and serve everything else, and say so loudly
 * in the log.
 */
export async function checkEtlOutputDir(dir: string = etlOutputDir()): Promise<EtlOutputDirCheck> {
  const probe = path.join(dir, `.write-probe-${process.pid}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(probe, '');
    await fs.rm(probe, { force: true });
    return { dir, writable: true };
  } catch (error__u: unknown) {
    const error = toError(error__u) as NodeJS.ErrnoException;
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    const hint = error.code === 'EACCES' || error.code === 'EPERM'
      ? `Not writable by uid ${uid ?? 'unknown'}. `
        + `Give the mounted storage that ownership (\`chown -R ${uid ?? 1000}:${uid ?? 1000}\` on the host `
        + 'path or volume), or point ETL_OUTPUT_DIR at a directory this user owns. '
        + 'See "Where a job execution\'s output goes" in docs/guides/etl.md.'
      : undefined;
    return { dir, writable: false, error: error.message, ...(hint ? { hint } : {}) };
  }
}

/** The file extension for the formats a CONSTRUCT comes back in. */
const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  'text/turtle': 'ttl',
  'application/n-triples': 'nt',
  'application/n-quads': 'nq',
  'application/trig': 'trig',
  'application/rdf+xml': 'rdf',
  'application/ld+json': 'jsonld',
};

function extensionFor(contentType: string): string {
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  return EXTENSION_BY_MEDIA_TYPE[mediaType] ?? 'rdf';
}

/**
 * The sink a job execution writes to: one file, appended a chunk at a time.
 *
 * Each `append` is awaited before the next chunk is constructed, so the run
 * never holds more than one chunk's RDF in memory whatever the source's size.
 * Chunks are concatenated, not merged, which is what the old `join('\n')` did
 * too: N-Triples and N-Quads are line-based, and Turtle permits a prefix to be
 * declared again, so the concatenation of well-formed chunks is well-formed.
 */
class EtlOutputFile {
  private handle: fs.FileHandle | null = null;
  private location: string | null = null;
  private contentType: string | null = null;

  /** @param basePath The file's path without its extension. */
  constructor(private readonly basePath: string) {}

  async append(rdf: string, contentType?: string): Promise<void> {
    if (!this.handle) {
      this.contentType = contentType || 'text/turtle';
      this.location = `${this.basePath}.${extensionFor(this.contentType)}`;
      await fs.mkdir(path.dirname(this.location), { recursive: true });
      this.handle = await fs.open(this.location, 'w');
    }
    await this.handle.write(rdf.endsWith('\n') ? rdf : `${rdf}\n`);
  }

  /** Flushes and closes; what was written, or null when nothing was. */
  async close(): Promise<{ location: string; contentType: string } | null> {
    if (!this.handle || !this.location || !this.contentType) {
      return null;
    }
    await this.handle.close();
    this.handle = null;
    return { location: this.location, contentType: this.contentType };
  }

  /**
   * Closes and removes whatever was written. Never throws: it runs on the
   * failure path, where the error worth reporting is the run's, not this one.
   */
  async discard(): Promise<void> {
    try {
      const written = await this.close();
      if (written) {
        await fs.rm(written.location, { force: true });
      }
    } catch (error__u: unknown) {
      console.warn(`Could not remove partial ETL output ${this.location}: ${toError(error__u).message}`);
    }
  }
}

export class EtlService {
  /**
   * Convert short ID to full URN
   */
  private toUrn(shortId: string, kind?: string): string {
    if (shortId.startsWith('urn:sqlib:')) return shortId;
    if (kind) return mintId(kind, shortId);
    return `urn:sqlib:${shortId}`;
  }

  /**
   * Convert full URN to short ID
   */
  private toShortId(urn: string): string {
    return urn.replace(/^urn:sqlib:[^:]+:/, '');
  }

  /**
   * Create a new ETL job
   */
  async createEtlJob(input: EtlJobInput): Promise<EtlJobDetail> {
    const cacheCoordinator = getCacheCoordinator();
    const id = mintId('etlJob');
    const now = new Date().toISOString();

    const ldkitEtlJob: LdkitEtlJob = {
      $id: id,
      name: input.name,
      description: input.description,
      isPartOf: [this.toUrn(input.libraryId, 'library')],
      dateCreated: now,
      dateModified: now,
    };

    await cacheCoordinator.create('EtlJob', ldkitEtlJob);

    return {
      id: this.toShortId(id),
      name: input.name,
      description: input.description,
      libraryIds: [input.libraryId],
      dateCreated: now,
      dateModified: now,
    };
  }

  /**
   * Rename an ETL job, or change its description.
   *
   * Name and description are properties of the job rather than of a version,
   * so they are edited in place — the same split queries and groups have, and
   * what lets the Details tab save them as you type.
   */
  async updateEtlJob(id: string, input: { name?: string; description?: string | null }): Promise<EtlJobDetail | null> {
    const etlJobUrn = this.toUrn(id, 'etlJob');
    const cacheCoordinator = getCacheCoordinator();
    const existing = cacheCoordinator.get(etlJobUrn) as LdkitEtlJob | null;
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const patch: Partial<LdkitEtlJob> & { dateModified: string } = { dateModified: now };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description ?? undefined;

    await cacheCoordinator.update('EtlJob', etlJobUrn, patch);

    return {
      id,
      name: patch.name ?? existing.name,
      description: (patch.description ?? existing.description) || undefined,
      currentVersionId: existing.currentVersion ? this.toShortId(existing.currentVersion) : undefined,
      libraryIds: existing.isPartOf.map((iri) => this.toShortId(iri)),
      dateCreated: existing.dateCreated || undefined,
      dateModified: now,
    };
  }

  /**
   * Create a new version of an ETL job
   */
  async createEtlJobVersion(etlJobId: string, input: EtlJobVersionInput): Promise<EtlJobVersionDetail> {
    const etlJobUrn = this.toUrn(etlJobId, 'etlJob');
    const cacheCoordinator = getCacheCoordinator();
    const etlJob = cacheCoordinator.get(etlJobUrn) as LdkitEtlJob | null;
    if (!etlJob) {
      throw new Error(`ETL job not found: ${etlJobId}`);
    }

    // Get existing versions to determine next version number
    const allVersions = cacheCoordinator.list('EtlJobVersion') as LdkitEtlJobVersion[];
    const existingVersions = allVersions.filter((v) => v.isPartOf === etlJobUrn);

    const nextVersion = existingVersions.length + 1;
    const versionId = mintId('etlJobVersion');
    const now = new Date().toISOString();

    const ldkitVersion: LdkitEtlJobVersion = {
      $id: versionId,
      isPartOf: etlJobUrn,
      version: nextVersion,
      // Frozen on create (issue #192): a version is a snapshot, so it is never
      // created in a state where it could still change.
      immutable: true,
      sql: input.sql,
      sparqlTemplate: input.sparqlTemplate,
      backendId: this.toUrn(input.backendId, 'backend'),
      chunkSize: input.chunkSize,
      comment: input.comment,
      dateCreated: now,
      dateModified: now,
    };

    await cacheCoordinator.create('EtlJobVersion', ldkitVersion);

    // Update parent's currentVersion
    await cacheCoordinator.update('EtlJob', etlJobUrn, {
      currentVersion: versionId,
      dateModified: now,
    });

    return {
      id: this.toShortId(versionId),
      isPartOf: etlJobId,
      version: nextVersion,
      immutable: true,
      sql: input.sql,
      sparqlTemplate: input.sparqlTemplate,
      backendId: input.backendId,
      chunkSize: input.chunkSize,
      comment: input.comment,
      dateCreated: now,
      dateModified: now,
    };
  }

  /**
   * Create column mapping for an ETL job version
   */
  async createColumnMapping(etlJobVersionId: string, input: ColumnMappingInput): Promise<ColumnMappingDetail> {
    const etlJobVersionUrn = this.toUrn(etlJobVersionId, 'etlJobVersion');
    const cacheCoordinator = getCacheCoordinator();
    const etlJobVersion = cacheCoordinator.get(etlJobVersionUrn) as LdkitEtlJobVersion | null;
    if (!etlJobVersion) {
      throw new Error(`ETL job version not found: ${etlJobVersionId}`);
    }

    const mappingId = mintId('etlColumnMapping');
    const now = new Date().toISOString();

    const ldkitMapping: LdkitEtlColumnMapping = {
      $id: mappingId,
      name: input.name,
      description: input.description,
      etlJobVersion: etlJobVersionUrn,
      dateCreated: now,
      dateModified: now,
    };

    await cacheCoordinator.create('EtlColumnMapping', ldkitMapping);

    // Create initial version
    const versionId = mintId('etlColumnMappingVersion');
    const ldkitMappingVersion: LdkitEtlColumnMappingVersion = {
      $id: versionId,
      isPartOf: mappingId,
      version: 1,
      columns: JSON.stringify(input.columns),
      dateCreated: now,
      dateModified: now,
    };

    await cacheCoordinator.create('EtlColumnMappingVersion', ldkitMappingVersion);

    // Update mapping's currentVersion
    await cacheCoordinator.update('EtlColumnMapping', mappingId, {
      currentVersion: versionId,
      dateModified: now,
    });

    // Update job version's currentColumnMappingVersion
    await cacheCoordinator.update('EtlJobVersion', etlJobVersionUrn, {
      currentColumnMappingVersion: versionId,
      dateModified: now,
    });

    return {
      id: this.toShortId(mappingId),
      name: input.name,
      description: input.description,
      currentVersionId: this.toShortId(versionId),
      etlJobVersionId,
      dateCreated: now,
      dateModified: now,
    };
  }

  /**
   * Preview SQL and infer default mappings
   */
  async preview(input: PreviewInput): Promise<PreviewOutput> {
    if (!duckDbService.isAvailable()) {
      throw new Error('DuckDB is not available. Install @duckdb/node-api package to enable ETL features.');
    }

    const previewResult = await duckDbService.preview(input.sql, input.limit || 10);

    // Infer default mappings from schema
    const inferredColumns: ColumnDefinition[] = previewResult.schema.map((col) => ({
      columnName: col.columnName,
      targetVariable: col.columnName, // Use column name as variable name by default
      termType: 'literal' as const,
      datatypeIri: mapDuckDbTypeToXsd(col.duckdbType),
      nullPolicy: 'undef' as const,
    }));

    return {
      ...previewResult,
      inferredMapping: {
        columns: inferredColumns,
      },
    };
  }

  /**
   * List all ETL jobs
   */
  async listEtlJobs(): Promise<EtlJobDetail[]> {
    const allJobs = getCacheCoordinator().list('EtlJob') as LdkitEtlJob[];

    return allJobs.map((ldkitJob) => ({
      id: this.toShortId(ldkitJob.$id),
      name: ldkitJob.name,
      description: ldkitJob.description || undefined,
      currentVersionId: ldkitJob.currentVersion ? this.toShortId(ldkitJob.currentVersion) : undefined,
      libraryIds: ldkitJob.isPartOf.map((iri) => this.toShortId(iri)),
      dateCreated: ldkitJob.dateCreated || undefined,
      dateModified: ldkitJob.dateModified || undefined,
    }));
  }

  /**
   * Get ETL job by ID
   */
  async getEtlJob(id: string): Promise<EtlJobDetail | null> {
    const ldkitJob = getCacheCoordinator().get(this.toUrn(id, 'etlJob')) as LdkitEtlJob | null;
    if (!ldkitJob) {
      return null;
    }

    return {
      id,
      name: ldkitJob.name,
      description: ldkitJob.description || undefined,
      currentVersionId: ldkitJob.currentVersion ? this.toShortId(ldkitJob.currentVersion) : undefined,
      libraryIds: ldkitJob.isPartOf.map((iri) => this.toShortId(iri)),
      dateCreated: ldkitJob.dateCreated || undefined,
      dateModified: ldkitJob.dateModified || undefined,
    };
  }

  /**
   * Every version of one ETL job, newest first.
   *
   * The Details tab lists them the way it lists a query's, so the order is the
   * one that panel reads top-down: the latest version is the one you are
   * looking at, and the older ones are history under it.
   */
  async listEtlJobVersions(etlJobId: string): Promise<EtlJobVersionDetail[]> {
    const etlJobUrn = this.toUrn(etlJobId, 'etlJob');
    const allVersions = getCacheCoordinator().list('EtlJobVersion') as LdkitEtlJobVersion[];
    return allVersions
      .filter((version) => version.isPartOf === etlJobUrn)
      .sort((a, b) => b.version - a.version)
      .map((ldkitVersion) => ({
        id: this.toShortId(ldkitVersion.$id),
        isPartOf: etlJobId,
        version: ldkitVersion.version,
        immutable: ldkitVersion.immutable || undefined,
        sql: ldkitVersion.sql,
        sparqlTemplate: ldkitVersion.sparqlTemplate,
        backendId: this.toShortId(ldkitVersion.backendId),
        currentColumnMappingVersionId: ldkitVersion.currentColumnMappingVersion
          ? this.toShortId(ldkitVersion.currentColumnMappingVersion)
          : undefined,
        chunkSize: ldkitVersion.chunkSize || undefined,
        comment: ldkitVersion.comment || undefined,
        dateCreated: ldkitVersion.dateCreated || undefined,
        dateModified: ldkitVersion.dateModified || undefined,
      }));
  }

  /**
   * Get ETL job version by ID
   */
  async getEtlJobVersion(id: string): Promise<EtlJobVersionDetail | null> {
    const ldkitVersion = getCacheCoordinator().get(this.toUrn(id, 'etlJobVersion')) as LdkitEtlJobVersion | null;
    if (!ldkitVersion) {
      return null;
    }

    return {
      id,
      isPartOf: this.toShortId(ldkitVersion.isPartOf),
      version: ldkitVersion.version,
      immutable: ldkitVersion.immutable || undefined,
      sql: ldkitVersion.sql,
      sparqlTemplate: ldkitVersion.sparqlTemplate,
      backendId: this.toShortId(ldkitVersion.backendId),
      currentColumnMappingVersionId: ldkitVersion.currentColumnMappingVersion
        ? this.toShortId(ldkitVersion.currentColumnMappingVersion)
        : undefined,
      chunkSize: ldkitVersion.chunkSize || undefined,
      comment: ldkitVersion.comment || undefined,
      dateCreated: ldkitVersion.dateCreated || undefined,
      dateModified: ldkitVersion.dateModified || undefined,
    };
  }

  /**
   * Annotate an ETL job version.
   *
   * A version is a snapshot — its SQL, template and backend are what the
   * pipeline was when it was saved — so the comment is the only field a later
   * write may touch. Saving no longer collects one up front, which is what
   * makes annotating afterwards the way a version gets its note at all.
   */
  async annotateEtlJobVersion(id: string, comment: string | null): Promise<EtlJobVersionDetail | null> {
    const versionUrn = this.toUrn(id, 'etlJobVersion');
    const cacheCoordinator = getCacheCoordinator();
    const existing = cacheCoordinator.get(versionUrn) as LdkitEtlJobVersion | null;
    if (!existing) {
      return null;
    }

    /*
     * `null` is what clears a note: the cache coordinator maps null to
     * undefined, which drops the property, while an undefined value is skipped
     * as "not part of this patch" and would leave the old note in place.
     */
    const now = new Date().toISOString();
    await cacheCoordinator.update('EtlJobVersion', versionUrn, {
      comment,
      dateModified: now,
    } as unknown as Partial<LdkitEtlJobVersion>);

    return this.getEtlJobVersion(id);
  }

  /**
   * Get column mapping version by ID
   */
  async getColumnMappingVersion(id: string): Promise<ColumnMappingVersionDetail | null> {
    const ldkitVersion = getCacheCoordinator().get(this.toUrn(id, 'etlColumnMappingVersion')) as LdkitEtlColumnMappingVersion | null;
    if (!ldkitVersion) {
      return null;
    }

    return {
      id,
      isPartOf: this.toShortId(ldkitVersion.isPartOf),
      version: ldkitVersion.version,
      immutable: ldkitVersion.immutable || undefined,
      columns: JSON.parse(ldkitVersion.columns),
      comment: ldkitVersion.comment || undefined,
      dateCreated: ldkitVersion.dateCreated || undefined,
      dateModified: ldkitVersion.dateModified || undefined,
    };
  }

  /**
   * Convert DuckDB rows to SPARQL bindings using column mappings
   */
  convertRowsToBindings(rows: Record<string, unknown>[], columnDefs: ColumnDefinition[]): SparqlBinding[] {
    const bindings: SparqlBinding[] = [];

    for (const row of rows) {
      const binding: SparqlBinding = {};
      let skipRow = false;

      for (const colDef of columnDefs) {
        const value = row[colDef.columnName];

        // Handle null values
        if (value === null || value === undefined) {
          if (colDef.nullPolicy === 'skipRow') {
            skipRow = true;
            break;
          }
          // nullPolicy === 'undef': omit from binding (SPARQL UNDEF)
          continue;
        }

        // Convert to SPARQL value
        try {
          if (colDef.termType === 'uri') {
            let iriValue: string;

            if (colDef.iriTemplate) {
              // Apply IRI template
              iriValue = colDef.iriTemplate.replace('{value}', encodeURIComponent(String(value)));
            } else {
              // Use value as-is
              iriValue = String(value);
            }

            // Basic IRI validation
            if (!iriValue.match(/^[a-z][a-z0-9+.-]*:/i)) {
              console.warn(`Invalid IRI generated: ${iriValue}, skipping binding`);
              continue;
            }

            binding[colDef.targetVariable] = {
              type: 'uri',
              value: iriValue,
            };
          } else {
            // Literal
            const literalValue: { type: 'literal'; value: string; datatype?: string; 'xml:lang'?: string } = {
              type: 'literal',
              value: toLexicalForm(value, colDef.datatypeIri),
            };

            if (colDef.datatypeIri) {
              literalValue.datatype = colDef.datatypeIri;
            }

            if (colDef.lang) {
              literalValue['xml:lang'] = colDef.lang;
            }

            binding[colDef.targetVariable] = literalValue;
          }
        } catch (error__u: unknown) {
      const error = toError(error__u);
          console.warn(`Error converting column ${colDef.columnName}: ${error.message}, skipping binding`);
          continue;
        }
      }

      if (!skipRow) {
        bindings.push(binding);
      }
    }

    return bindings;
  }

  /**
   * Convert SPARQL bindings array to ArgumentSet format expected by parser
   */
  private bindingsToArgumentSet(bindings: SparqlBinding[], columnDefs: ColumnDefinition[]): ArgumentSet {
    const vars = columnDefs.map(c => c.targetVariable);
    return {
      head: { vars },
      arguments: { bindings }
    };
  }

  /**
   * The columns a run maps, from the version it pins or the one its job names.
   *
   * The SQL alone does not decide what the rows become — the mapping does — so
   * every caller that runs a job has to resolve one, and resolving it in two
   * places is how a test comes to be typed differently from the job it tests.
   */
  resolveColumnMapping(
    etlJobVersion: LdkitEtlJobVersion,
    columnMappingVersionId?: string,
  ): { versionUrn: string; columns: ColumnDefinition[] } {
    const mappingVersionUrn = columnMappingVersionId
      ? this.toUrn(columnMappingVersionId, 'etlColumnMappingVersion')
      : etlJobVersion.currentColumnMappingVersion;

    if (!mappingVersionUrn) {
      throw new Error(`No column mapping version specified and ETL job version has no current mapping`);
    }

    const mappingVersion = getCacheCoordinator().get(mappingVersionUrn) as LdkitEtlColumnMappingVersion | null;
    if (!mappingVersion) {
      throw new Error(`Column mapping version not found: ${mappingVersionUrn}`);
    }

    return { versionUrn: mappingVersionUrn, columns: JSON.parse(mappingVersion.columns) as ColumnDefinition[] };
  }

  /**
   * The chunk loop, without the bookkeeping around it.
   *
   * Extracted so a test run can have the loop and not the rest. What a test
   * substitutes is exactly one thing — the executor — and what it adds is
   * exactly one — the fixture; everything between the rows and the RDF is the
   * same code the real job runs, which is the only way the verdict is about the
   * job.
   *
   * No `EtlExecution` is written here. A run that was never asked for by a
   * caller of `/etl-jobs/:id/execute` is not an execution of that job, and
   * recording one would put test runs in the job's own history.
   */
  async runPipeline(run: EtlPipelineRun): Promise<EtlPipelineResult> {
    const parser = new SparqlQueryParser();
    // The cap under the `fail` policy, or null when there is none to fail on.
    const rowCap = run.maxRowsPolicy === 'fail' ? run.maxRows ?? null : null;
    let completedChunks = 0;
    let totalRows = 0;

    for await (const { rows } of duckDbService.streamChunks(run.sql, run.chunkSize, {
      fixtureSql: run.fixtureSql,
    })) {
      totalRows += rows.length;

      // Checked before the rows are used rather than at the chunk boundary
      // below: a cap that must fail has to fail on the chunk that broke it, or
      // the run has already paid for what it then refuses to report.
      if (rowCap !== null && totalRows > rowCap) {
        throw new Error(
          `The source query produced more than ${rowCap} rows. `
          + 'This run stops rather than truncating, because a partial result is not the result.',
        );
      }

      const bindings = this.convertRowsToBindings(rows, run.columnDefs);

      if (bindings.length > 0) {
        const argSet = this.bindingsToArgumentSet(bindings, run.columnDefs);
        const query = parser.applyArguments(run.sparqlTemplate, [argSet]);
        const { result, contentType } = await run.executor.constructQueryParsed(query);

        if (typeof result === 'string') {
          await run.onOutput(result, { index: completedChunks, contentType });
        }
      }

      completedChunks++;
      await run.onChunk?.({ completedChunks, totalRows });

      // Dry run: stop after first chunk. Leaving the loop ends the stream and
      // closes its connection; the source query is not read any further.
      if (run.dryRun) {
        break;
      }

      // Max rows: the limit is honoured at a chunk boundary, as before.
      //
      // Not under the `fail` policy, where stopping here is the bug the policy
      // exists to prevent: a source of exactly `maxRows + 1` rows would break
      // out on the boundary and truncate silently, which is the outcome the
      // caller asked to be refused.
      if (rowCap === null && run.maxRows && totalRows >= run.maxRows) {
        break;
      }
    }

    return { totalRows, completedChunks };
  }

  /**
   * Execute an ETL job end-to-end
   */
  async executeEtlJob(etlJobId: string, config: ExecutionInput): Promise<ExecutionResult> {
    const executorFactory = new ExecutorFactory();
    const cacheCoordinator = getCacheCoordinator();

    // 1. Load EtlJobVersion (current or specified)
    const etlJobUrn = this.toUrn(etlJobId, 'etlJob');
    const etlJob = cacheCoordinator.get(etlJobUrn) as LdkitEtlJob | null;
    if (!etlJob) {
      throw new Error(`ETL job not found: ${etlJobId}`);
    }

    const versionUrn = config.etlJobVersionId
      ? this.toUrn(config.etlJobVersionId, 'etlJobVersion')
      : etlJob.currentVersion;

    if (!versionUrn) {
      throw new Error(`No version specified and ETL job ${etlJobId} has no current version`);
    }

    const etlJobVersion = cacheCoordinator.get(versionUrn) as LdkitEtlJobVersion | null;
    if (!etlJobVersion) {
      throw new Error(`ETL job version not found: ${versionUrn}`);
    }

    // 2. Load ColumnMappingVersion (current or specified)
    const mapping = this.resolveColumnMapping(etlJobVersion, config.columnMappingVersionId);
    const columnDefs = mapping.columns;

    // 3. Open the run's record in the job's log (status: 'running'). Shared
    // with the tabular sink — see `etlRunLog.ts` for what belongs in it.
    const chunkSize = config.chunkSize || etlJobVersion.chunkSize || 1000;
    const executionId = await beginEtlExecution({
      etlJobVersionId: versionUrn,
      columnMappingVersionId: mapping.versionUrn,
      startedAt: new Date().toISOString(),
      executionConfig: { chunkSize, maxRows: config.maxRows, dryRun: config.dryRun },
    });

    // 4. The sink: one file per execution, appended a chunk at a time. Opened
    // by the first chunk that has something to write, so a run that constructs
    // nothing leaves no file, and named by the Content-Type that chunk came
    // back in.
    const output = new EtlOutputFile(path.join(etlOutputDir(), this.toShortId(executionId)));

    try {
      // 5. Get executor via ExecutorFactory
      const executor = await executorFactory.getExecutorForBackendId(etlJobVersion.backendId);

      // 6. Chunk loop, over one streamed execution of the source query (#201)
      const { totalRows, completedChunks } = await this.runPipeline({
        sql: etlJobVersion.sql,
        sparqlTemplate: etlJobVersion.sparqlTemplate,
        columnDefs,
        executor,
        chunkSize,
        maxRows: config.maxRows,
        dryRun: config.dryRun,
        onOutput: (rdf, chunk) => output.append(rdf, chunk.contentType),
        onChunk: progress => recordEtlExecutionProgress(executionId, progress),
      });

      const written = await output.close();

      // 7. Mark execution as 'completed', with where its output went
      await completeEtlExecution(executionId, {
        totalChunks: completedChunks,
        outputFormat: written?.contentType,
        outputLocation: written?.location,
      });

      // 8. Return ExecutionResult
      return {
        executionId: this.toShortId(executionId),
        status: 'completed',
        outputFormat: written?.contentType,
        outputLocation: written?.location,
        totalChunks: completedChunks,
        completedChunks,
        totalRows,
      };

    } catch (error__u: unknown) {
      const error = toError(error__u);
      // A partial file is not the result, and recording where it is would
      // invite reading it as one. Same rule as the row cap above.
      await output.discard();

      // Mark execution as 'failed'
      await failEtlExecution(executionId, error);

      throw error;
    }
  }

  /**
   * The output file of a completed execution, ready to be streamed back.
   *
   * Resolved from the execution record rather than from anything the caller
   * sends, and checked to lie under the output directory, so the route that
   * serves it cannot be pointed at another file. Null when the execution does
   * not exist or wrote no output.
   */
  async getExecutionOutput(id: string): Promise<{ location: string; contentType: string } | null> {
    const execution = getCacheCoordinator().get(this.toUrn(id, 'etlExecution')) as LdkitEtlExecution | null;
    if (!execution?.outputLocation) {
      return null;
    }

    const dir = etlOutputDir();
    const location = path.resolve(execution.outputLocation);
    if (path.relative(dir, location).startsWith('..') || path.isAbsolute(path.relative(dir, location))) {
      throw new Error(`Execution ${id} records an output location outside the ETL output directory`);
    }

    return { location, contentType: execution.outputFormat || 'text/plain' };
  }

  /**
   * Get execution details by ID
   */
  async getExecution(id: string): Promise<ExecutionDetail | null> {
    const executionUrn = this.toUrn(id, 'etlExecution');
    const execution = getCacheCoordinator().get(executionUrn) as LdkitEtlExecution | null;
    if (!execution) {
      return null;
    }

    return this.toExecutionDetail(execution);
  }

  /**
   * Every recorded run of one ETL job, newest first.
   *
   * The log is per *version* in the store — a run names the version whose SQL
   * it ran — and per *job* here, because the question an operator asks is
   * "what has this pipeline been doing", and a job whose history stopped at
   * its last version would answer it with the runs of a version nobody has
   * used since.
   *
   * `limit` bounds the answer rather than the store: runs accumulate, and a
   * pipeline on a schedule accumulates them at a rate. Newest first is what
   * makes a bounded list the useful end of the history.
   */
  async listExecutions(etlJobId: string, limit = 50): Promise<ExecutionDetail[]> {
    const cacheCoordinator = getCacheCoordinator();
    const etlJobUrn = this.toUrn(etlJobId, 'etlJob');
    const versionsOfJob = new Set(
      (cacheCoordinator.list('EtlJobVersion') as LdkitEtlJobVersion[])
        .filter((version) => version.isPartOf === etlJobUrn)
        .map((version) => version.$id),
    );

    return (cacheCoordinator.list('EtlExecution') as LdkitEtlExecution[])
      .filter((execution) => versionsOfJob.has(execution.etlJobVersion))
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
      .slice(0, Math.max(0, limit))
      .map((execution) => this.toExecutionDetail(execution));
  }

  /**
   * One stored run as the API reports it.
   *
   * Counts use `??` rather than `||`: a run that read no rows read no rows,
   * and reporting that as "not known" would make the emptiest result — the one
   * worth investigating — indistinguishable from a run too old to have
   * recorded the field. `outputReused` needs the same care for the same
   * reason, since `false` is the ordinary case.
   */
  private toExecutionDetail(execution: LdkitEtlExecution): ExecutionDetail {
    return {
      id: this.toShortId(execution.$id),
      etlJobVersionId: this.toShortId(execution.etlJobVersion),
      columnMappingVersionId: this.toShortId(execution.columnMappingVersion),
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt || undefined,
      totalChunks: execution.totalChunks ?? undefined,
      completedChunks: execution.completedChunks ?? undefined,
      totalRows: execution.totalRows ?? undefined,
      errorMessage: execution.errorMessage || undefined,
      errorChunk: execution.errorChunk ?? undefined,
      outputFormat: execution.outputFormat || undefined,
      outputLocation: execution.outputLocation || undefined,
      outputTupleSetVersionId: execution.outputTupleSetVersion
        ? this.toShortId(execution.outputTupleSetVersion)
        : undefined,
      outputReused: execution.outputReused ?? undefined,
      executionConfig: execution.executionConfig || undefined,
    };
  }
}

export const etlService = new EtlService();
