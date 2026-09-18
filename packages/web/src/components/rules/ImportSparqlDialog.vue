<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="import-dialog">
      <DialogHeader>
        <DialogTitle>Import from SPARQL</DialogTitle>
        <DialogDescription>
          Append a rule built from a CONSTRUCT or an INSERT … WHERE — its template becomes the rule
          head, its WHERE clause the body.
        </DialogDescription>
      </DialogHeader>

      <div class="import-body">
        <div class="source-tabs" role="tablist">
          <button
            v-for="tab in SOURCE_TABS"
            :key="tab.key"
            class="source-tab"
            :class="{ active: source === tab.key }"
            role="tab"
            :aria-selected="source === tab.key"
            :data-testid="`import-source-${tab.key}`"
            @click="source = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <!--
          Paste. The query is not edited here beyond pasting it: this is an
          import, and the place to work on a query is the query editor.
        -->
        <div v-if="source === 'paste'" class="source-pane">
          <textarea
            v-model="pasted"
            class="paste-input"
            data-testid="import-paste"
            spellcheck="false"
            placeholder="PREFIX : &lt;http://example/&gt;&#10;&#10;CONSTRUCT { ?s :grandparent ?g }&#10;WHERE { ?s :parent ?p . ?p :parent ?g }&#10;&#10;# or: INSERT { … } WHERE { … }"
          />
        </div>

        <!--
          Stored queries, filtered to the ones that can actually become a rule.
          A library of mostly-SELECT queries would otherwise be a list of rows
          that all refuse to import.
        -->
        <div v-else class="source-pane">
          <div v-if="loading" class="list-note">Loading queries…</div>
          <div v-else-if="loadError" class="list-note error">{{ loadError }}</div>
          <div v-else-if="importableQueries.length === 0" class="list-note">
            Nothing in this library converts to a rule. A rule is built from a CONSTRUCT or an
            INSERT … WHERE.
          </div>
          <template v-else>
            <!--
              A filter once the list outgrows reading it, fuzzy and ranked the
              way every chooser in the app filters (`lib/fuzzy`).
            -->
            <FilterBox
              v-if="importableQueries.length > FILTER_FROM"
              v-model="queryFilter"
              class="query-filter"
              placeholder="Filter queries…"
              test-id="import-query-filter"
            />
            <div v-if="visibleQueries.length === 0" class="list-note">
              No query here matches “{{ queryFilter }}”.
            </div>
            <ul v-else class="query-list">
              <li v-for="{ item: entry, segments } in visibleQueries" :key="entry.versionId">
                <button
                  class="query-row"
                  :class="{ selected: selectedVersionId === entry.versionId }"
                  :data-testid="`import-query-${entry.versionId}`"
                  @click="selectStored(entry)"
                >
                  <span class="query-name">
                    <template v-for="(segment, index) in segments" :key="index">
                      <mark v-if="segment.matched" class="query-name-hit">{{ segment.text }}</mark>
                      <template v-else>{{ segment.text }}</template>
                    </template>
                  </span>
                  <span class="query-version">v{{ entry.version }}</span>
                  <span class="query-form">{{ entry.form }}</span>
                </button>
              </li>
            </ul>
          </template>
        </div>

        <!--
          The verdict. Errors and the rule are mutually exclusive by
          construction: a query with anything unsupported in it produces no rule
          at all, because a rule missing one of its patterns does not fail — it
          infers the wrong triples.
        -->
        <div class="verdict" data-testid="import-verdict">
          <div v-if="converting" class="list-note">Converting…</div>

          <template v-else-if="result">
            <ul v-if="errors.length" class="issues" data-testid="import-errors">
              <li v-for="(issue, index) in errors" :key="index" class="issue error">
                <TriangleAlert :size="12" class="issue-icon" />
                <span>
                  <strong v-if="issue.construct">{{ issue.construct }}</strong>
                  {{ issue.message }}
                </span>
              </li>
            </ul>

            <template v-else>
              <ul v-if="warnings.length" class="issues" data-testid="import-warnings">
                <li v-for="(issue, index) in warnings" :key="index" class="issue warning">
                  <Info :size="12" class="issue-icon" />
                  <span>
                    <strong v-if="issue.construct">{{ issue.construct }}</strong>
                    {{ issue.message }}
                  </span>
                </li>
              </ul>

              <p v-if="result.runOnce" class="run-once" data-testid="import-run-once">
                <Repeat1 :size="12" />
                This rule is evaluated once rather than to a fixpoint, because it
                {{ runOnceReason }}. That also changes how the set stratifies.
              </p>

              <p v-if="newPrefixes.length" class="prefix-note" data-testid="import-prefixes">
                Adds {{ newPrefixes.length === 1 ? 'prefix' : 'prefixes' }}
                {{ newPrefixes.map((p) => `${p.prefix}:`).join(', ') }} to the document.
              </p>
              <p v-if="conflictingPrefixes.length" class="prefix-note" data-testid="import-prefix-conflicts">
                {{ conflictingPrefixes.map((p) => `${p.prefix}:`).join(', ') }}
                {{ conflictingPrefixes.length === 1 ? 'means' : 'mean' }} something else here — the rule is
                rewritten to use this document's spelling.
              </p>

              <pre class="rule-preview" data-testid="import-preview">{{ result.rule }}</pre>
            </template>
          </template>

          <div v-else class="list-note muted">
            {{ source === 'paste'
              ? 'Paste a CONSTRUCT or INSERT … WHERE query to see the rule it becomes.'
              : 'Pick a query.' }}
          </div>
        </div>
      </div>

      <DialogFooter>
        <button type="button" class="btn-cancel" @click="close">Cancel</button>
        <button
          type="button"
          class="btn-select"
          data-testid="import-append"
          :disabled="!result?.rule"
          @click="append"
        >
          Append rule
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * Import a rule from a CONSTRUCT or INSERT … WHERE query.
 *
 * The conversion itself is server-side, for the same reason the rest of the SRL
 * work is (`useSrlAnalysis`): the grammar is a Traqula extension in
 * `@sparql-query-lib/srl`, and shipping it to the browser to duplicate a route
 * that already exists is not worth the bundle.
 *
 * The dialog previews rather than converts-on-accept, because the interesting
 * outcomes are the ones short of success — a warning that a BIND is about to
 * become a SET, or a list of the constructs that stop the import — and those
 * have to be readable before anything lands in the document.
 */
import { computed, ref, watch } from 'vue';
import { Info, Repeat1, TriangleAlert } from '@lucide/vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { useApiClient, type SparqlImportResult } from '@/composables/useApiClient';
import { useQueriesStore } from '@/composables/useQueriesStore';
import { fuzzyFilter } from '@/lib/fuzzy';
import FilterBox from '@/components/shared/FilterBox.vue';
import { QueryTypeIri } from '@sparql-query-lib/types';
import type { Query } from '@sparql-query-lib/contracts';

const props = defineProps<{
  open: boolean;
  /** Which library's stored queries to offer. */
  libraryId: string | null;
  /** The target document's PREFIX/BASE lines — it wins every prefix conflict. */
  targetPrologue: string;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  /** The rule text to append, plus the PREFIX lines the document still needs. */
  (e: 'append', payload: { rule: string; prefixes: Array<{ prefix: string; namespace: string }> }): void;
}>();

const SOURCE_TABS = [
  { key: 'stored' as const, label: 'Stored query' },
  { key: 'paste' as const, label: 'Paste' },
];

interface StoredImportable {
  versionId: string;
  name: string;
  version: number;
  queryString: string;
  /** How the row is labelled, from the stored query type. */
  form: 'CONSTRUCT' | 'UPDATE';
}

const apiClient = useApiClient();
const queriesStore = useQueriesStore();

const isOpen = ref(props.open);
const source = ref<'stored' | 'paste'>('stored');
const pasted = ref('');
const selectedVersionId = ref<string | null>(null);

const importableQueries = ref<StoredImportable[]>([]);

/** Below this many rows the list is faster to read than to filter. */
const FILTER_FROM = 5;
const queryFilter = ref('');
const visibleQueries = computed(() =>
  fuzzyFilter(queryFilter.value, importableQueries.value, (entry) => entry.name),
);
const loading = ref(false);
const loadError = ref<string | null>(null);

const result = ref<SparqlImportResult | null>(null);
const converting = ref(false);

const errors = computed(() => result.value?.issues.filter((i) => i.severity === 'error') ?? []);
const warnings = computed(() => result.value?.issues.filter((i) => i.severity === 'warning') ?? []);

const newPrefixes = computed(() =>
  (result.value?.prefixes ?? []).filter((p) => !p.conflicts && !targetBinds(p.prefix, p.namespace)),
);
const conflictingPrefixes = computed(() => (result.value?.prefixes ?? []).filter((p) => p.conflicts));

const runOnceReason = computed(() =>
  result.value?.rule?.includes('SET (') ? 'assigns a value' : 'mints a blank node',
);

/**
 * The label for a query type that can hold a rule, or null for one that cannot.
 *
 * A stored UPDATE is only a candidate — most updates are not a lone
 * INSERT … WHERE — which is what the stored flag is for. The type alone still
 * rules out the SELECTs, ASKs and DESCRIBEs without consulting anything.
 */
function importableForm(queryType: string | null | undefined): StoredImportable['form'] | null {
  if (queryType === QueryTypeIri.construct) return 'CONSTRUCT';
  if (queryType === QueryTypeIri.update) return 'UPDATE';
  return null;
}

function targetBinds(prefix: string, namespace: string): boolean {
  for (const match of props.targetPrologue.matchAll(/^\s*PREFIX\s+([^\s:]*):\s*<([^>]*)>/gim)) {
    if (match[1] === prefix && match[2] === namespace) return true;
  }
  return false;
}

watch(() => props.open, async (open) => {
  isOpen.value = open;
  if (!open) return;
  reset();
  if (props.libraryId) await loadImportableQueries();
});

watch(isOpen, (open) => {
  if (!open) emit('update:open', false);
});

function reset() {
  source.value = 'stored';
  pasted.value = '';
  selectedVersionId.value = null;
  result.value = null;
  converting.value = false;
}

/*
 * Debounced, because it fires per keystroke in the paste box and the route
 * parses a whole query. Only the newest response may write — an older one
 * landing late would show a verdict for text that is no longer there.
 */
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

watch([pasted, source], () => {
  if (source.value !== 'paste') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void convert(pasted.value), 350);
});

async function convert(query: string) {
  const current = ++seq;
  if (!query.trim()) {
    result.value = null;
    converting.value = false;
    return;
  }
  converting.value = true;
  try {
    const response = await apiClient.ruleFromSparql(query, { targetPrologue: props.targetPrologue });
    if (current !== seq) return;
    result.value = response;
  } catch (error) {
    if (current !== seq) return;
    result.value = {
      rule: null,
      form: null,
      issues: [{
        severity: 'error',
        code: 'request',
        message: error instanceof Error ? error.message : 'Could not convert the query',
      }],
      prefixes: [],
      runOnce: false,
    };
  } finally {
    if (current === seq) converting.value = false;
  }
}

async function loadImportableQueries() {
  loading.value = true;
  loadError.value = null;
  try {
    await queriesStore.loadQueries();
    const libraryQueries = queriesStore.queries.value.filter((query: Query) => {
      const belongs = Array.isArray(query.isPartOf)
        ? query.isPartOf.includes(props.libraryId!)
        : query.isPartOf === props.libraryId;
      return belongs && !!query.currentVersion;
    });

    const entries: StoredImportable[] = [];
    await Promise.all(libraryQueries.map(async (query: Query) => {
      const versions = await queriesStore.loadQueryVersions(query.id);
      // The current version only: importing a superseded one is a thing to ask
      // for explicitly, not something to bury in a list of near-identical rows.
      const current = versions.find((version) => version.id === query.currentVersion);
      if (!current?.queryString) return;
      const form = importableForm(current.queryType);
      if (!form) return;
      /*
       * `srlImportable` is the server's verdict, decided when the version was
       * written so this list does not have to convert every query in the library
       * just to draw itself. Absent means never computed — a version written
       * before the flag existed, or imported as raw RDF — and those are shown,
       * since the conversion below settles it either way.
       *
       * It is a hint, not the authority: the import always re-runs the
       * converter, so the worst a wrong flag can do is mis-list a row. That
       * matters because the flag can go stale — a version is immutable, so
       * loosening the whitelist cannot correct the `false`s it invalidates.
       * `scripts/backfill-srl-importable.ts` is what fixes those, using the
       * revision stored beside the flag; second-guessing the verdict here would
       * only spread the same staleness problem across two places.
       */
      if (current.srlImportable === false) return;
      entries.push({
        versionId: current.id,
        name: query.name,
        version: current.version,
        queryString: current.queryString,
        form,
      });
    }));

    importableQueries.value = entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Failed to load queries';
    importableQueries.value = [];
  } finally {
    loading.value = false;
  }
}

function selectStored(entry: StoredImportable) {
  selectedVersionId.value = entry.versionId;
  void convert(entry.queryString);
}

function append() {
  if (!result.value?.rule) return;
  emit('append', {
    rule: result.value.rule,
    prefixes: newPrefixes.value.map(({ prefix, namespace }) => ({ prefix, namespace })),
  });
  isOpen.value = false;
}

function close() {
  isOpen.value = false;
}
</script>

<style scoped>
/*
 * The dialog's own box and buttons. It used to borrow `dialog-large`,
 * `dialog-body`, `dialog-footer`, `btn-cancel` and `btn-select` from the other
 * dialogs, which style them in their own scoped blocks — so none of them
 * reached here and the two buttons rendered as bare `<button>`s. See
 * `test/components/styledClasses.test.ts`.
 */
.import-dialog {
  max-width: 56rem;
}

.btn-cancel,
.btn-select {
  height: var(--control-h);
  padding: 0 var(--space-5);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--text-body);
  cursor: pointer;
}

.btn-cancel {
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--ink-secondary);
}

.btn-cancel:hover {
  background: var(--surface-subtle);
}

.btn-select {
  border: 1px solid var(--action);
  background: var(--action);
  color: var(--action-fg);
}

.btn-select:hover:not(:disabled) {
  background: var(--action-hover);
}

.btn-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.query-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.import-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
}

.source-tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-default);
}
.source-tab {
  padding: var(--space-3) var(--space-4);
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}
.source-tab.active {
  border-bottom-color: var(--action);
  color: var(--ink);
}

.source-pane {
  min-height: 140px;
  max-height: 220px;
  overflow-y: auto;
}

.paste-input {
  width: 100%;
  min-height: 140px;
  box-sizing: border-box;
  padding: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-code);
  line-height: 1.5;
  resize: vertical;
}

.query-filter {
  margin-bottom: var(--space-3);
}

.query-name-hit {
  background: none;
  color: var(--action);
  font-weight: var(--weight-semibold);
}

.query-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.query-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}
.query-row:hover {
  background: var(--surface-raised);
}
.query-row.selected {
  background: var(--action-surface);
  color: var(--action-ink);
}
.query-version {
  color: var(--ink-muted);
  font-size: var(--text-label);
}
.query-form {
  margin-left: auto;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.verdict {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}

.list-note {
  padding: var(--space-2);
  color: var(--ink-secondary);
  font-size: var(--text-label);
}
.list-note.error {
  color: var(--danger-ink);
}
.list-note.muted {
  color: var(--ink-muted);
}

.issues {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.issue {
  display: flex;
  gap: 6px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  font-size: var(--text-label);
  line-height: 1.45;
}
.issue-icon {
  flex-shrink: 0;
  margin-top: var(--space-1);
}
.issue.error {
  background: var(--danger-surface);
  color: var(--danger-ink);
}
.issue.warning {
  background: var(--warning-surface);
  color: var(--ink-secondary);
}
.issue strong {
  margin-right: var(--space-2);
  font-family: var(--font-mono);
}

.run-once,
.prefix-note {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-label);
}

.rule-preview {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  padding: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-code);
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
