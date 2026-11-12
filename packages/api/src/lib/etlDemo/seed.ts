/**
 * The ETL examples library: saved ETL jobs that open in the ETL screen's
 * left panel, each ready to run.
 *
 * Idempotent: the library id is minted from a stable slug, and a job whose
 * name the library already holds is left alone. A re-run against a
 * persistent library store writes nothing, and keeps any edits made to the
 * seeded jobs.
 */
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';
import type { PersistedLibrary } from '../../persistence/schemas/LibrarySchema.js';
import type { PersistedEtlJob } from '../../persistence/schemas/EtlJobSchema.js';
import { getEntityRepositories } from '../CacheCoordinatorProvider.js';
import { etlService } from '../EtlService.js';
import { mintId } from '../id.js';
import { ETL_DEMO_JOBS } from './jobs.js';

export const ETL_DEMO_LIBRARY_ID = mintId('library', 'etl-examples');

const LIBRARY_NAME = 'ETL examples';
const LIBRARY_DESCRIPTION =
  'Saved ETL jobs that turn rows into RDF: inline rows, local CSV files and remote CSV and JSON.';

export interface EtlDemoSeedResult {
  libraryId: string;
  /** Jobs written by this call. Zero on a re-run. */
  jobsCreated: number;
  /** Jobs that were already there and were left alone. */
  jobsExisting: number;
}

export async function seedEtlDemo(log: (message: string) => void = () => {}): Promise<EtlDemoSeedResult> {
  const repos = getEntityRepositories();
  if (!repos.Library.get(ETL_DEMO_LIBRARY_ID)) {
    await repos.Library.create({
      $id: ETL_DEMO_LIBRARY_ID,
      name: LIBRARY_NAME,
      description: LIBRARY_DESCRIPTION,
    } as Partial<PersistedLibrary> & { $id: string });
  }

  const existing = new Set(
    (await etlService.listEtlJobs((jobs: PersistedEtlJob[]) =>
      jobs.filter((job) => (job.isPartOf ?? []).includes(ETL_DEMO_LIBRARY_ID))))
      .map((job) => job.name),
  );

  const result: EtlDemoSeedResult = { libraryId: ETL_DEMO_LIBRARY_ID, jobsCreated: 0, jobsExisting: 0 };
  for (const demo of ETL_DEMO_JOBS) {
    if (existing.has(demo.name)) {
      result.jobsExisting += 1;
      continue;
    }
    const job = await etlService.createEtlJob({
      name: demo.name,
      description: demo.description,
      libraryId: ETL_DEMO_LIBRARY_ID,
    });
    const version = await etlService.createEtlJobVersion(job.id, {
      sql: demo.sql,
      sparqlTemplate: demo.sparqlTemplate,
      backendId: EPHEMERAL_BACKEND_ID,
      comment: 'Seeded example',
    });
    await etlService.createColumnMapping(version.id, { name: `${demo.name} columns`, columns: demo.columns });
    result.jobsCreated += 1;
  }

  log(`ETL examples: ${result.jobsCreated} job(s) created, ${result.jobsExisting} already present`);
  return result;
}
