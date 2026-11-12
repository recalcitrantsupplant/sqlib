import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ETL_DEMO_JOBS } from '../../src/lib/etlDemo/jobs.js';
import { ETL_DEMO_LIBRARY_ID, seedEtlDemo } from '../../src/lib/etlDemo/seed.js';
import { etlService } from '../../src/lib/EtlService.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from './fixtures/scenario-test-base-unmocked.js';

/**
 * The ETL examples library that `just run-local-etl-demo` seeds: one saved
 * job per example, each with a version and a column mapping, written once.
 */
describe('ETL examples seed', () => {
  let context: ScenarioTestContext;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('etl-demo-seed');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('seeds every job once, each with a version and a column mapping', async () => {
    const first = await seedEtlDemo();
    expect(first).toEqual({ libraryId: ETL_DEMO_LIBRARY_ID, jobsCreated: ETL_DEMO_JOBS.length, jobsExisting: 0 });

    const again = await seedEtlDemo();
    expect(again).toMatchObject({ jobsCreated: 0, jobsExisting: ETL_DEMO_JOBS.length });

    const jobs = (await etlService.listEtlJobs()).filter((job) => job.libraryIds.some((id) => ETL_DEMO_LIBRARY_ID.endsWith(id)));
    expect(jobs.map((job) => job.name).sort()).toEqual(ETL_DEMO_JOBS.map((job) => job.name).sort());

    for (const job of jobs) {
      const versions = await etlService.listEtlJobVersions(job.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].currentColumnMappingVersionId, job.name).toBeTruthy();
    }
  });
});
