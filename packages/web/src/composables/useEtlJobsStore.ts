/**
 * Saved ETL pipelines.
 *
 * ETL was the one section with nothing behind it: a pipeline lived in the
 * browser and stayed there, because the screen had never been wired to the
 * `/etl-jobs` endpoints that were already on the server. This is that wiring —
 * an EtlJob with versions, exactly the shape queries and groups have, which is
 * what lets the ETL sidebar grow a Saved cluster and the ETL screen grow the
 * same Save button as everything else.
 *
 * Plain `fetch` rather than `useApiClient`, matching the ETL screen's other
 * calls: the generated contract client has no ETL surface yet, and inventing a
 * half-typed one here would be a second place for the shapes to drift.
 */
import { computed, reactive } from 'vue';
// @ts-ignore - Nuxt auto-imports
import { useRuntimeConfig } from '#imports';
import { deriveIfMatchToken, sendGuarded } from './createVersionedEntityStore';
import { authorizedFetch } from './authorizedFetch';

/** A column of the SQL result, and the RDF term it becomes. */
export interface EtlColumnMapping {
  columnName: string;
  targetVariable: string;
  termType: 'uri' | 'literal';
  datatypeIri?: string;
  lang?: string;
  iriTemplate?: string;
  nullPolicy: 'undef' | 'skipRow';
}

export interface EtlJob {
  id: string;
  name: string;
  description?: string;
  currentVersionId?: string;
  /** Full backend IRI a run defaults to; absent means the in-memory store. */
  defaultBackend?: string;
  libraryIds: string[];
  dateCreated?: string;
  dateModified?: string;
}

export interface EtlJobVersion {
  id: string;
  isPartOf: string;
  version: number;
  sql: string;
  /** The template text. For a linked template, the text of the query version it resolves to now. */
  sparqlTemplate: string;
  /** The saved query the template comes from: a query version (pinned) or a query (latest). */
  templateQuery?: string;
  /** The query version `templateQuery` resolves to now. */
  templateQueryVersion?: string;
  backendId: string;
  currentColumnMappingVersionId?: string;
  chunkSize?: number;
  comment?: string;
  dateCreated?: string;
  dateModified?: string;
}

interface EtlJobsState {
  items: EtlJob[];
  loading: boolean;
  error: string | null;
  versions: Record<string, EtlJobVersion[]>;
  /** If-Match tokens per job, for the guarded PATCH. */
  concurrency: Record<string, string | null>;
}

const state = reactive<EtlJobsState>({
  items: [],
  loading: false,
  error: null,
  versions: {},
  concurrency: {},
});

/** What `POST /etl-jobs/:id/execute` answers with. */
export interface EtlJobRunResult {
  status: string;
  executionId?: string;
  outputFormat?: string;
  outputLocation?: string;
  /** The RDF itself, on a read-only deployment, which writes no file. */
  output?: string;
  errorMessage?: string;
  totalChunks?: number;
  completedChunks?: number;
  totalRows?: number;
  /** The row cap a read-only deployment held the run to, when it applied one. */
  rowLimitApplied?: number;
}

async function requestWithEtag<T>(url: string, init?: RequestInit): Promise<{ data: T; etag: string | null }> {
  const response = await authorizedFetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    // The API answers `{ error }` on every failure path here; anything else is
    // a proxy or a crash, and the status is the only honest thing to report.
    const body = await response.json().catch(() => null) as { error?: string } | null;
    // The status travels with the error so a lost race reads as one.
    throw Object.assign(new Error(body?.error ?? `Request failed with ${response.status}`), {
      statusCode: response.status,
    });
  }
  return { data: await response.json() as T, etag: response.headers.get('etag') };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return (await requestWithEtag<T>(url, init)).data;
}

const LIBRARY_IRI_PREFIX = 'urn:sqlib:library:';

/**
 * The API names a job's libraries by short id on reads and echoes the caller's
 * spelling on create. Every other entity, and the active library, uses the
 * full IRI, so a job is brought to that spelling once, here, before any list
 * compares it.
 */
export function withLibraryIris(job: EtlJob): EtlJob {
  const libraryIds = (job.libraryIds ?? []).map((id) =>
    id.startsWith('urn:') ? id : `${LIBRARY_IRI_PREFIX}${id}`);
  return { ...job, libraryIds };
}

export function useEtlJobsStore() {
  const config = useRuntimeConfig();
  const base = () => `${config.public.apiBaseUrl}/etl-jobs`;

  async function loadEtlJobs(): Promise<EtlJob[]> {
    state.loading = true;
    state.error = null;
    try {
      state.items = (await request<EtlJob[]>(base())).map(withLibraryIris);
      return state.items;
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Failed to load pipelines';
      throw error;
    } finally {
      state.loading = false;
    }
  }

  async function fetchEtlJob(id: string): Promise<EtlJob> {
    const { data, etag } = await requestWithEtag<EtlJob>(`${base()}/${encodeURIComponent(id)}`);
    state.concurrency[id] = deriveIfMatchToken(etag, data);
    return withLibraryIris(data);
  }

  async function createEtlJob(input: { name: string; description?: string | null; libraryId: string }): Promise<EtlJob> {
    const created = withLibraryIris(await request<EtlJob>(base(), {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        // The route rejects a null description rather than treating it as
        // absent, so an empty one is omitted instead of sent.
        ...(input.description ? { description: input.description } : {}),
        libraryId: input.libraryId,
      }),
    }));
    state.items = [...state.items.filter((job) => job.id !== created.id), created];
    return created;
  }

  async function updateEtlJob(
    id: string,
    input: { name?: string; description?: string | null; defaultBackend?: string | null },
  ): Promise<EtlJob> {
    // Guarded like every saved entity's write, and a lost race replayed once.
    const updated = await sendGuarded<EtlJob>({
      noun: 'ETL job',
      id,
      token: state.concurrency[id] ?? null,
      readFirst: true,
      readToken: async () => {
        await fetchEtlJob(id);
        return state.concurrency[id] ?? null;
      },
      send: async (ifMatch) => {
        const { data, etag } = await requestWithEtag<EtlJob>(`${base()}/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: ifMatch ? { 'If-Match': ifMatch } : {},
          body: JSON.stringify(input),
        });
        return { data, etag, lastModified: null, status: 200 };
      },
      onToken: (token) => { state.concurrency[id] = token; },
    }).then(withLibraryIris);
    state.items = state.items.map((job) => (job.id === id ? updated : job));
    return updated;
  }

  async function loadEtlJobVersions(id: string): Promise<EtlJobVersion[]> {
    const versions = await request<EtlJobVersion[]>(`${base()}/${encodeURIComponent(id)}/versions`);
    state.versions[id] = versions;
    return versions;
  }

  async function fetchEtlJobVersion(versionId: string): Promise<EtlJobVersion> {
    return await request<EtlJobVersion>(`${base()}/versions/${encodeURIComponent(versionId)}`);
  }

  async function fetchColumnMappingVersion(versionId: string): Promise<{ columns: EtlColumnMapping[] }> {
    return await request<{ columns: EtlColumnMapping[] }>(
      `${base()}/column-mappings/versions/${encodeURIComponent(versionId)}`,
    );
  }

  /**
   * A version and its column mapping, which are one thing to the user and two
   * to the API: the mapping hangs off the version, so it cannot be written
   * until the version exists.
   */
  async function createEtlJobVersion(
    jobId: string,
    input: {
      sql: string;
      sparqlTemplate: string;
      /** A saved query to use as the template. When set, `sparqlTemplate` is not sent. */
      templateQuery?: string | null;
      backendId: string;
      comment?: string | null;
      columnMappings: EtlColumnMapping[];
    },
  ): Promise<EtlJobVersion> {
    const version = await request<EtlJobVersion>(`${base()}/${encodeURIComponent(jobId)}/versions`, {
      method: 'POST',
      body: JSON.stringify({
        sql: input.sql,
        ...(input.templateQuery
          ? { templateQuery: input.templateQuery }
          : { sparqlTemplate: input.sparqlTemplate }),
        backendId: input.backendId,
        ...(input.comment ? { comment: input.comment } : {}),
      }),
    });

    if (input.columnMappings.length > 0) {
      await request(`${base()}/versions/${encodeURIComponent(version.id)}/column-mappings`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Column mapping', columns: input.columnMappings }),
      });
    }

    delete state.versions[jobId];
    return version;
  }

  /**
   * Write (or clear) a version's note.
   *
   * The version's content is frozen, so this is the one field a later write
   * touches — and the only way a version gets a note, since saving asks for
   * nothing. The cached list is patched in place so the Details row shows what
   * was typed without a refetch.
   */
  async function annotateEtlJobVersion(
    jobId: string,
    versionId: string,
    comment: string | null,
  ): Promise<EtlJobVersion> {
    const updated = await request<EtlJobVersion>(
      `${base()}/versions/${encodeURIComponent(versionId)}`,
      { method: 'PATCH', body: JSON.stringify({ comment }) },
    );
    const cached = state.versions[jobId];
    if (cached) {
      state.versions[jobId] = cached.map((entry) => (entry.id === versionId ? updated : entry));
    }
    return updated;
  }

  /**
   * Run a saved version of a job as it is stored: the request carries no SQL,
   * only which version. On a read-only deployment the RDF comes back in
   * `output` and nothing is kept (the API's `EtlService.executeEtlJob`).
   */
  async function executeEtlJob(
    jobId: string,
    input: { etlJobVersionId?: string; maxRows?: number } = {},
  ): Promise<EtlJobRunResult> {
    return await request<EtlJobRunResult>(
      `${base()}/${encodeURIComponent(jobId)}/execute`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  return {
    etlJobs: computed(() => state.items),
    loading: computed(() => state.loading),
    error: computed(() => state.error),
    versionsFor: (id: string) => state.versions[id] ?? [],
    loadEtlJobs,
    fetchEtlJob,
    createEtlJob,
    updateEtlJob,
    loadEtlJobVersions,
    fetchEtlJobVersion,
    fetchColumnMappingVersion,
    createEtlJobVersion,
    annotateEtlJobVersion,
    executeEtlJob,
  };
}
