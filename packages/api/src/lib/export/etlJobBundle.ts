/**
 * Adding a library's ETL jobs to an export bundle.
 *
 * A job travels as its SQL, its column mapping, and its CONSTRUCT template
 * compiled the way a query's is. What runs it — the `sqlib` CLI, in a
 * container — supplies the DuckDB the SQL runs in and the store the RDF goes
 * to; the job's stored backend names a server's backend, so it stays behind.
 *
 * A job that cannot be carried is skipped with its reason, as a query is: a
 * draft job should not stop the rest of the library being exported.
 */

import {
  InvalidBundleError,
  assertValidBundle,
  hashTemplateText,
  type ExportBundle,
  type ExportedEtlColumn,
  type ExportedEtlJob,
} from '@sparql-query-lib/runtime';
import { TemplateCompileError, compileQueryTemplate } from '@sparql-query-lib/compiler';
import { SparqlQueryParser } from '../parser.js';
import type { PersistedEtlJob } from '../../persistence/schemas/EtlJobSchema.js';
import type { PersistedEtlJobVersion } from '../../persistence/schemas/EtlJobVersionSchema.js';
import type { PersistedEtlColumnMappingVersion } from '../../persistence/schemas/EtlColumnMappingVersionSchema.js';
import type { EntityRepositories } from '../EntityRepositories.js';
import type { SkippedQuery } from './collectLibraryQueries.js';
import { reserveKey } from './queryBundle.js';

/** The entity reads this module needs, so a script can supply them too. */
export interface LibraryEtlJobSource {
  listEtlJobs(): PersistedEtlJob[];
  getEtlJobVersion(id: string): PersistedEtlJobVersion | null;
  getColumnMappingVersion(id: string): PersistedEtlColumnMappingVersion | null;
}

/** The source over a set of entity repositories: a request's, or a script's. */
export function etlJobSource(
  repos: Pick<EntityRepositories, 'EtlJob' | 'EtlJobVersion' | 'EtlColumnMappingVersion'>,
): LibraryEtlJobSource {
  return {
    listEtlJobs: () => repos.EtlJob.list() as PersistedEtlJob[],
    getEtlJobVersion: (id) => repos.EtlJobVersion.get(id) as PersistedEtlJobVersion | null,
    getColumnMappingVersion: (id) =>
      repos.EtlColumnMappingVersion.get(id) as PersistedEtlColumnMappingVersion | null,
  };
}

export interface AttachEtlJobsOptions {
  /**
   * Tag IRIs the export is filtered by. ETL jobs carry no tags, so a filtered
   * export carries no jobs: the filter asks for a subset, and no job is in it.
   */
  tags?: readonly string[];
  parser?: SparqlQueryParser;
}

class EtlJobExportError extends Error {}

async function compileJob(
  job: PersistedEtlJob,
  source: LibraryEtlJobSource,
  parser: SparqlQueryParser,
): Promise<ExportedEtlJob> {
  if (!job.currentVersion) throw new EtlJobExportError('The job has no current version.');
  const version = source.getEtlJobVersion(job.currentVersion);
  if (!version) throw new EtlJobExportError(`Its current version ${job.currentVersion} could not be found.`);
  if (!version.sql?.trim()) throw new EtlJobExportError('Its current version has no SQL.');
  if (!version.sparqlTemplate?.trim()) throw new EtlJobExportError('Its current version has no template.');
  if (!version.currentColumnMappingVersion) throw new EtlJobExportError('Its current version has no column mapping.');
  const mapping = source.getColumnMappingVersion(version.currentColumnMappingVersion);
  if (!mapping) {
    throw new EtlJobExportError(`Its column mapping version ${version.currentColumnMappingVersion} could not be found.`);
  }
  let columns: ExportedEtlColumn[];
  try {
    columns = JSON.parse(mapping.columns) as ExportedEtlColumn[];
  } catch {
    throw new EtlJobExportError('Its column mapping is not valid JSON.');
  }

  let compiled;
  try {
    compiled = compileQueryTemplate(version.sparqlTemplate, { name: job.name, parser });
  } catch (error) {
    if (error instanceof TemplateCompileError) throw new EtlJobExportError(error.message);
    throw error;
  }
  if (compiled.queryType !== 'CONSTRUCT') {
    throw new EtlJobExportError(`Its template is a ${compiled.queryType}, not a CONSTRUCT.`);
  }

  return {
    template: compiled.template,
    textHash: await hashTemplateText(compiled.template.text),
    sql: version.sql,
    columns,
    ...(version.chunkSize ? { chunkSize: version.chunkSize } : {}),
    name: job.name,
    ...(job.description ? { description: job.description } : {}),
    sourceJob: job.$id,
    sourceVersion: version.$id,
    sourceColumnMappingVersion: mapping.$id,
  };
}

/**
 * Add a library's ETL jobs to a bundle. Mutates and returns it, as
 * `attachGroupsToBundle` does.
 */
export async function attachEtlJobsToBundle(
  bundle: ExportBundle,
  source: LibraryEtlJobSource,
  libraryId: string,
  options: AttachEtlJobsOptions = {},
): Promise<{ bundle: ExportBundle; skipped: SkippedQuery[] }> {
  if ((options.tags ?? []).length > 0) return { bundle, skipped: [] };
  const parser = options.parser ?? new SparqlQueryParser();
  const jobs = source
    .listEtlJobs()
    .filter((job) => job.isPartOf?.includes(libraryId))
    // Sorted so an unchanged library re-exports byte for byte.
    .sort((a, b) => (a.name ?? a.$id).localeCompare(b.name ?? b.$id));

  const exported: Record<string, ExportedEtlJob> = {};
  const keys = new Set<string>();
  const skipped: SkippedQuery[] = [];
  for (const job of jobs) {
    const name = job.name ?? job.$id;
    try {
      const entry = await compileJob(job, source, parser);
      // The runtime's own validator decides what a carried job must be, so the
      // export cannot write one a reader would refuse.
      assertValidBundle({ version: 1, library: bundle.library, queries: {}, etlJobs: { [name]: entry } });
      exported[reserveKey(name, keys)] = entry;
    } catch (error) {
      if (error instanceof EtlJobExportError || error instanceof InvalidBundleError) {
        skipped.push({ id: job.$id, name, reason: error.message });
        continue;
      }
      throw error;
    }
  }
  if (Object.keys(exported).length > 0) bundle.etlJobs = exported;
  return { bundle, skipped };
}
