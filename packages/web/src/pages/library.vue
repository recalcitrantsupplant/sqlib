<template>
  <div class="library-layout">
    <AppNavRail active-section="library" @select="handleRailSelect" @home="goHome" />

    <NotebookContents
      v-if="queries.length > 0"
      v-model:search="search"
      v-model:grouping="grouping"
      :queries="queries"
      :visible="visibleSlugs"
      :skipped="skipped"
      :tags="libraryTags"
    />

    <main class="page">
      <!--
        A measure, not the pane.

        The page is a column of prose, a signature and one query pane per cell
        — a document, and a document set to the full width of a 1600px monitor
        is a document nobody finishes a line of. The pane keeps the scroll and
        the background; this holds the reading column, so the header actions
        stay with the text they belong to rather than flying to the far edge.
      -->
      <div class="page-measure">
        <!-- §2.2.1 Header block: the librarian's own words open the page. -->
        <header class="page-header">
          <div class="header-top">
            <!--
              The page's own title already names the library; switching happens
              once, at the head of the nav rail, rather than a second time here.
            -->

            <div class="header-actions">
              <span v-if="backendLabel" class="backend" :title="`Runs go to ${backendLabel}`">
                <span class="backend__dot" aria-hidden="true"></span>
                {{ backendLabel }} <span class="backend__note">· library default</span>
              </span>
              <Button size="sm" variant="outline" :disabled="exporting || !libraryId" @click="exportHtml">
                <Download :size="12" /> {{ exporting ? 'Exporting…' : 'Export as HTML' }}
              </Button>
              <Button
                size="sm"
                variant="outline"
                :disabled="!bundle"
                title="The compiled queries this page runs: canonical text, parameter spans, signatures and examples. Paste it into an app that uses @sparql-query-lib/runtime."
                @click="copyBundle"
              >
                <Check v-if="bundleCopied" :size="12" />
                <Copy v-else :size="12" />
                Copy bundle JSON
              </Button>
              <NuxtLink :to="buildLink" class="header-link"><Sparkles :size="12" /> Build</NuxtLink>
            </div>
          </div>

          <h1 class="page-title">{{ activeLibrary?.name ?? 'Library' }}</h1>
          <p v-if="activeLibrary?.description" class="page-standfirst">
            {{ activeLibrary.description }}
          </p>

          <div class="page-meta">
            <span>{{ queries.length }} {{ queries.length === 1 ? 'query' : 'queries' }}</span>
            <template v-if="libraryTags.length > 0">
              <span class="page-meta__label">filter by tag</span>
              <button
                v-for="tag in libraryTags"
                :key="tag.id"
                type="button"
                class="tag-filter"
                :class="{ active: activeTags.has(tag.id) }"
                :style="activeTags.has(tag.id) ? { background: tag.color, color: tag.ink } : undefined"
                @click="toggleTag(tag.id)"
              >
                {{ tag.name }}
              </button>
              <button v-if="filtering" type="button" class="clear" @click="clearFilters">clear</button>
            </template>
          </div>
        </header>

        <!--
          An export or clipboard failure is a banner, not a state: the document is
          still there and still readable, and replacing it with the error would
          lose the thing the reader came for.
        -->
        <p v-if="exportError" class="notice notice--error" data-testid="library-action-error">
          {{ exportError }}
        </p>

        <p v-if="loading" class="notice">Loading the library…</p>
        <p v-else-if="error" class="notice notice--error">{{ error }}</p>

        <template v-else-if="queries.length > 0">
          <p v-if="visibleQueries.length === 0" class="notice">
            Nothing matches those filters.
            <button type="button" class="link-button" @click="clearFilters">Clear them</button>.
          </p>

          <NotebookCell
            v-for="entry in visibleQueries"
            :key="entry.slug"
            :slug="entry.slug"
            :query="entry.query"
            :can-write="canWrite"
            :tags-by-id="tagsById"
            :preview="preview"
            :execute="execute"
            @save-as-test="openSaveDialog"
          />
        </template>

        <EmptyState
          v-else
          title="This library has no exportable queries yet"
          description="A query needs a saved version before it can be run from here."
        />
      </div>
    </main>

    <SaveAsTestDialog
      v-model:open="saveDialogOpen"
      :library-id="libraryId"
      :query-id="saveTarget?.queryId ?? null"
      :query-name="saveTarget?.slug ?? ''"
      :query-type="saveTarget?.queryType ?? null"
      :payload="saveTarget?.payload ?? null"
      :result="saveTarget?.result ?? null"
      :backend-id="defaultBackendId"
      @created="onTestCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
// @ts-ignore - Nuxt auto-import
import { useRoute, useRouter } from '#imports';
import { fuzzyMatches } from '../lib/fuzzy';
import { Check, Copy, Download, Sparkles } from '@lucide/vue';
import { toExecutionParameters } from '@sparql-query-lib/runtime';
import { defineArgsElement } from '@sparql-query-lib/runtime/args-element';
import AppNavRail from '../components/AppNavRail.vue';
import NotebookCell from '../components/library-notebook/NotebookCell.vue';
import NotebookContents, { type Grouping } from '../components/library-notebook/NotebookContents.vue';
import SaveAsTestDialog from '../components/library-notebook/SaveAsTestDialog.vue';
import EmptyState from '../components/shared/EmptyState.vue';
import { Button } from '../components/ui/button';
import { useApiClient } from '../composables/useApiClient';
import { useBackendsStore } from '../composables/useBackendsStore';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useLibrariesStore } from '../composables/useLibrariesStore';
import { useLibraryNotebook, type NotebookQuery } from '../composables/useLibraryNotebook';
import { useTagsStore } from '../composables/useTagsStore';
import { decorateTag, type DecoratedTag } from '../lib/tagPalette';
import { isScreenSection, SCREEN_SECTION_PATHS, type RailSection } from '../lib/railSections';

/**
 * The library page: a library as a runnable notebook.
 *
 * The same document the export writes, with the app's chrome instead of a file's.
 * It reads the export route, previews with the runtime in the browser, and runs
 * through `POST /execute` so the server does the canonical substitution and the
 * access control. It never edits: every editing affordance is a backlink, and
 * the one write is "save as test".
 */

const route = useRoute();
const router = useRouter();
const apiClient = useApiClient();
const librariesStore = useLibrariesStore();
const backendsStore = useBackendsStore();
const tagsStore = useTagsStore();
const { isEnabled } = useFeatureFlags();

/*
 * One switcher, one selection: the rail's control sets the active library and
 * every screen reads it. The `?library=` in the URL is still honoured on
 * arrival so a link into this screen lands on the library it names. It is read
 * once, here, because the watch below rewrites the URL from the selection.
 */
const requestedLibraryId = ((route.query.library as string) || null);
const { activeLibraryId: libraryId, activeLibrary, setActiveLibrary } = useActiveLibrary();
const search = ref('');
const grouping = ref<Grouping>('kind');
const activeTags = ref<Set<string>>(new Set());
const bundleCopied = ref(false);
const exporting = ref(false);
const exportError = ref<string | null>(null);

const { bundle, queries, skipped, tags, loading, error, preview } = useLibraryNotebook(libraryId);

const defaultBackendId = computed(() => activeLibrary.value?.defaultBackend ?? null);
const backendLabel = computed(
  () =>
    backendsStore.backends.value.find((backend) => backend.id === defaultBackendId.value)?.name ??
    null,
);

/*
 * Tags arrive as IRIs on the bundle and as records from the store; a chip needs
 * both halves plus a readable foreground, so they are resolved once here and
 * handed down. Without this a chip renders its IRI's hash, which is what
 * shipped.
 */
const tagsById = computed(
  () => new Map<string, DecoratedTag>(
    [...tagsStore.tagsById.value.values()].map((tag) => [tag.id, decorateTag(tag)]),
  ),
);

/** Only the tags the bundle's queries actually carry, in name order. */
const libraryTags = computed(() =>
  tags.value
    .map((id) => tagsById.value.get(id))
    .filter((tag): tag is DecoratedTag => !!tag)
    .sort((a, b) => a.name.localeCompare(b.name)),
);

/*
 * The app has no per-library permission model yet, so "can write" is read from
 * the feature flag that decides whether tests exist at all. When permissions
 * arrive this is the single place that has to learn about them (§2.5).
 */
const canWrite = computed(() => isEnabled('tests'));

const buildLink = computed(() => ({
  path: '/build',
  query: libraryId.value ? { library: libraryId.value } : {},
}));

const filtering = computed(() => search.value.trim().length > 0 || activeTags.value.size > 0);

function isVisible(entry: NotebookQuery): boolean {
  if (activeTags.value.size > 0) {
    const carried = entry.query.tags ?? [];
    // `any`, matching the export's tag filter.
    if (!carried.some((tag) => activeTags.value.has(tag))) return false;
  }
  // Fuzzy on the slug, substring on the description — `lib/fuzzy` states why.
  return fuzzyMatches(search.value, entry.slug, entry.query.description);
}

const visibleQueries = computed(() => queries.value.filter(isVisible));
const visibleSlugs = computed(() => new Set(visibleQueries.value.map((entry) => entry.slug)));

function toggleTag(tag: string) {
  const next = new Set(activeTags.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  activeTags.value = next;
}

function clearFilters() {
  search.value = '';
  activeTags.value = new Set();
}

/**
 * Run a cell.
 *
 * The *payload* goes to `/execute`, not the substituted text to `/sparql`
 * (design §4). The server substitutes with the same shared code the preview
 * used, resolves the library's backend, and enforces access — so nothing this
 * page shows can diverge from what actually ran, and the page needs no
 * raw-SPARQL right.
 */
async function execute(
  slug: string,
  payload: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const query = bundle.value?.queries[slug];
  if (!query?.sourceQuery) {
    return { ok: false, error: 'This query has no saved id, so the server cannot be asked to run it.' };
  }

  const body = payload as
    | {
        arguments?: unknown[];
        limits?: Record<string, number>;
        offsets?: Record<string, number>;
      }
    | null
    | undefined;

  // The element keys limits and offsets by name; `/execute` takes them listed.
  const limits = toExecutionParameters(body?.limits);
  const offsets = toExecutionParameters(body?.offsets);

  try {
    const result = await apiClient.executeTarget({
      targetId: query.sourceQuery,
      ...(body?.arguments?.length ? { arguments: body.arguments as never } : {}),
      ...(limits.length ? { limits } : {}),
      ...(offsets.length ? { offsets } : {}),
    } as never);
    const isJson = (result.contentType ?? '').includes('json');
    return { ok: true, data: isJson ? JSON.parse(result.body) : result.body };
  } catch (cause) {
    const message =
      (cause as { statusMessage?: string })?.statusMessage ??
      (cause instanceof Error ? cause.message : String(cause));
    return { ok: false, error: message };
  }
}

/* ---------------------------------------------------------------- *
 * Save as test — the page's one write (§2.4).
 * ---------------------------------------------------------------- */

interface SaveTarget {
  slug: string;
  queryId: string | null;
  queryType: string | null;
  payload: never;
  result: unknown;
}

const saveDialogOpen = ref(false);
const saveTarget = ref<SaveTarget | null>(null);

function openSaveDialog(value: { slug: string; payload: unknown; result: unknown }) {
  const query = bundle.value?.queries[value.slug];
  saveTarget.value = {
    slug: value.slug,
    queryId: query?.sourceQuery ?? null,
    queryType: query?.queryType ?? null,
    payload: value.payload as never,
    result: value.result,
  };
  saveDialogOpen.value = true;
}

function onTestCreated({ testId }: { testId: string }) {
  router.push({ path: '/', query: { section: 'tests', item: testId } });
}

/** Fetched with the bearer token, then handed to the browser as a download. */
async function exportHtml() {
  if (!libraryId.value) return;
  exporting.value = true;
  exportError.value = null;
  try {
    const html = await apiClient.getLibraryExportHtml(libraryId.value, { examples: 'all' });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(activeLibrary.value?.name ?? 'library').replace(/[^\w.-]+/g, '-')}.html`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (cause) {
    exportError.value =
      (cause as { statusMessage?: string })?.statusMessage ??
      (cause instanceof Error ? cause.message : String(cause));
  } finally {
    exporting.value = false;
  }
}

async function copyBundle() {
  if (!bundle.value) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(bundle.value, null, 2));
    bundleCopied.value = true;
    setTimeout(() => (bundleCopied.value = false), 1500);
  } catch (cause) {
    // Silence here reads as "copied" — the one thing that did not happen.
    exportError.value =
      cause instanceof Error
        ? `Could not copy the bundle: ${cause.message}`
        : 'Could not copy the bundle.';
  }
}

/** The mark at the head of the rail: back to the splash. */
function goHome() {
  router.push({ path: '/' });
}

function handleRailSelect(section: RailSection) {
  if (section === 'library') return;
  if (isScreenSection(section)) {
    router.push({
      path: SCREEN_SECTION_PATHS[section],
      query: libraryId.value ? { library: libraryId.value } : {},
    });
    return;
  }
  router.push({ path: '/', query: { section } });
}

// The argument builder is a custom element shared with the exported page; it
// registers itself once, on the client, before any cell renders.
defineArgsElement();

onMounted(async () => {
  await Promise.all([librariesStore.loadLibraries(), backendsStore.loadBackends()]);
  if (requestedLibraryId && requestedLibraryId !== libraryId.value) {
    setActiveLibrary(requestedLibraryId);
  }
});

watch(
  libraryId,
  (id) => {
    // Only once there is a selection: replacing with an empty query before the
    // libraries have loaded would strip the `?library=` this screen arrived on.
    if (id) router.replace({ path: '/library', query: { library: id } });
    void tagsStore.ensureLoaded(id);
  },
  { immediate: true },
);
</script>

<style scoped>
.library-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--surface);
}

.page {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: var(--space-6) var(--space-7) var(--space-8);
}

/*
 * 60rem is the widest a cell wants: the query pane holds one full-width
 * document now (see NotebookCell), so nothing inside is being squeezed to buy
 * the measure.
 */
.page-measure {
  max-width: 60rem;
  margin-inline: auto;
}

.page-header { margin-bottom: var(--space-6); }

.header-top {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.backend {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-label);
  color: var(--ink-secondary);
}

.backend__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--success);
}

.backend__note { color: var(--ink-muted); }

.header-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.page-title {
  margin: 0;
  font-size: var(--text-display);
  font-weight: var(--weight-semibold);
  letter-spacing: -0.01em;
}

.page-standfirst {
  margin: var(--space-3) 0 0;
  max-width: 78ch;
  font-size: var(--text-content);
  color: var(--ink-secondary);
}

.page-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin: var(--space-5) 0 0;
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.page-meta__label { color: var(--ink-muted); }

.tag-filter {
  height: 20px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  cursor: pointer;
}

.tag-filter.active { border-color: transparent; }

.clear {
  border: none;
  background: none;
  padding: 0;
  color: var(--action);
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.notice { margin: var(--space-6) 0; color: var(--ink-muted); }
.notice--error { color: var(--danger-ink); }

.link-button {
  border: none;
  background: none;
  padding: 0;
  color: var(--action);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}
</style>
