/**
 * An ETL job's libraries, in the spelling the rest of the app compares.
 *
 * `GET /etl-jobs` names a job's libraries by short id, while every other
 * entity and the active library use the full IRI. Before the store brought the
 * two together, a job never matched its library and was missing from that
 * library's lists, though the API listed it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isInLibrary } from '@/composables/useEntityKinds';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/composables/authorizedFetch', () => ({ authorizedFetch: fetchMock }));

const SHORT = 'c5395c8cd3bc4aeaaf0db863004c4ddc';
const LIBRARY = `urn:sqlib:library:${SHORT}`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let useEtlJobsStore: typeof import('@/composables/useEtlJobsStore')['useEtlJobsStore'];

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  ({ useEtlJobsStore } = await import('@/composables/useEtlJobsStore'));
});

describe('ETL job library ids', () => {
  it('expands the short ids a listing returns to library IRIs', async () => {
    fetchMock.mockResolvedValue(json([{ id: 'job1', name: 'x', libraryIds: [SHORT] }]));
    const store = useEtlJobsStore();

    await store.loadEtlJobs();

    const [job] = store.etlJobs.value;
    expect(job?.libraryIds).toEqual([LIBRARY]);
    expect(isInLibrary({ isPartOf: job?.libraryIds }, LIBRARY)).toBe(true);
  });

  it('keeps a full IRI as it is, as a create from the web app echoes it', async () => {
    fetchMock.mockResolvedValue(json({ id: 'job2', name: 'y', libraryIds: [LIBRARY] }, 201));
    const store = useEtlJobsStore();

    const created = await store.createEtlJob({ name: 'y', libraryId: LIBRARY });

    expect(created.libraryIds).toEqual([LIBRARY]);
    expect(store.etlJobs.value[0]?.libraryIds).toEqual([LIBRARY]);
  });

  it('expands the short ids a single read returns', async () => {
    fetchMock.mockResolvedValue(json({ id: 'job1', name: 'x', libraryIds: [SHORT] }));
    const store = useEtlJobsStore();

    const job = await store.fetchEtlJob('job1');

    expect(job.libraryIds).toEqual([LIBRARY]);
  });
});
