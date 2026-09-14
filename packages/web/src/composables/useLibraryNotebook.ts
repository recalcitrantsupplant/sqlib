import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import {
  fromBundle,
  type ExportBundle,
  type ExportedQuery,
  type QueryLibrary,
} from '@sparql-query-lib/runtime';
import { useApiClient, type LibraryNotebookPayload } from './useApiClient';

/**
 * A library, loaded as a runnable notebook.
 *
 * The screen reads the same bundle `sqlib export` writes, from the same route,
 * so the tab and the file it exports are one document with different chrome.
 *
 * The split that matters is *preview locally, execute canonically*:
 *
 * - The substituted query under each cell is computed here, in the browser, by
 *   the runtime — instant, and identical to what an exported page would show
 *   because it is the same code.
 * - **Running** posts the *payload* to `POST /execute` rather than posting the
 *   substituted text to `/sparql`. The server substitutes with that same shared
 *   code, resolves the library's backend and enforces access. So there is no
 *   divergence risk between what was previewed and what ran, and the screen
 *   needs no raw-SPARQL execution right — which is what keeps this the library
 *   surface that is safe to share with someone who may not edit.
 */
export interface NotebookQuery {
  slug: string;
  query: ExportedQuery;
}

export interface UseLibraryNotebookResult {
  bundle: Ref<ExportBundle | null>;
  library: Ref<QueryLibrary | null>;
  queries: Ref<NotebookQuery[]>;
  skipped: Ref<LibraryNotebookPayload['skipped']>;
  tags: Ref<string[]>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  load: () => Promise<void>;
  /** The substituted query for a payload, or the runtime's own error message. */
  preview: (slug: string, payload: unknown) => { text: string | null; error: string | null };
}

export function useLibraryNotebook(libraryId: Ref<string | null>): UseLibraryNotebookResult {
  const apiClient = useApiClient();

  const bundle = shallowRef<ExportBundle | null>(null);
  // Shallow: a loaded library holds compiled handles and closures, and making
  // those deeply reactive buys nothing and costs a walk of every template.
  const library = shallowRef<QueryLibrary | null>(null);
  const skipped = ref<LibraryNotebookPayload['skipped']>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const queries = computed<NotebookQuery[]>(() =>
    bundle.value
      ? Object.entries(bundle.value.queries).map(([slug, query]) => ({ slug, query }))
      : [],
  );

  /** Every tag any exported query carries, for the filter bar. */
  const tags = computed(() => {
    const seen = new Set<string>();
    for (const { query } of queries.value) for (const tag of query.tags ?? []) seen.add(tag);
    return [...seen].sort();
  });

  async function load(): Promise<void> {
    const id = libraryId.value;
    bundle.value = null;
    library.value = null;
    skipped.value = [];
    error.value = null;
    if (!id) return;

    loading.value = true;
    try {
      const payload = await apiClient.getLibraryExportBundle(id, { examples: 'all' });
      // `fromBundle` validates as it loads — a slot span that no longer lands on
      // a VALUES block is caught here rather than at splice time.
      library.value = fromBundle(payload.bundle);
      bundle.value = payload.bundle;
      skipped.value = payload.skipped ?? [];
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  }

  function preview(slug: string, payload: unknown): { text: string | null; error: string | null } {
    if (!library.value) return { text: null, error: null };
    try {
      return { text: library.value.query(slug).text(payload as never), error: null };
    } catch (cause) {
      // The runtime's messages are written for people and match the server's,
      // so they are shown as they are rather than reworded.
      return { text: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  watch(libraryId, () => void load(), { immediate: true });

  return { bundle, library, queries, skipped, tags, loading, error, load, preview };
}
