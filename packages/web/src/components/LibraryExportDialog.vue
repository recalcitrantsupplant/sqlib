<template>
  <!--
    The library's exports, from the screen that is about the library.

    One list says what to export, and two files take it: the bundle, which the
    `sqlib` command line and the static runtime read, and the runnable page,
    which a browser opens. Every member is a real choice, ticked by default as
    the server carries it. A member whose screen this build does not draw is
    not offered, and is left out.
  -->
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md" data-testid="library-export-dialog">
      <DialogHeader>
        <DialogTitle>Export “{{ libraryName }}”</DialogTitle>
        <DialogDescription>
          The library compiled, to run with no sqlib server.
        </DialogDescription>
      </DialogHeader>

      <section class="block">
        <SectionLabel as="h3">Contents</SectionLabel>
        <label class="option">
          <Checkbox v-model="choice.queries" data-testid="library-export-queries" />
          Queries
        </label>
        <label class="option option--nested" :class="{ 'option--off': !choice.queries }">
          <!-- Shown unticked while queries are off; the choice comes back with them. -->
          <Checkbox
            :model-value="choice.queries && choice.examples"
            :disabled="!choice.queries"
            data-testid="library-export-examples"
            @update:model-value="(value) => (choice.examples = value === true)"
          />
          with worked examples from the library’s tests
        </label>
        <label v-if="offered.groups" class="option">
          <Checkbox v-model="choice.groups" data-testid="library-export-groups" />
          Query groups, with the queries they run
        </label>
        <label v-if="offered.etl" class="option">
          <Checkbox v-model="choice.etl" data-testid="library-export-etl" />
          ETL jobs
        </label>
        <label v-if="offered.ruleSets" class="option">
          <Checkbox v-model="choice.ruleSets" data-testid="library-export-rule-sets" />
          Rule sets
        </label>
        <p v-if="nothingChosen" class="problem" data-testid="library-export-nothing">
          Choose at least one thing to export.
        </p>
      </section>

      <section class="block">
        <SectionLabel as="h3">Bundle (.json)</SectionLabel>
        <p class="hint">
          For the <code>sqlib</code> command line (<code>--bundle</code>) and the static runtime.
        </p>
        <div class="actions">
          <Button
            size="sm"
            variant="outline"
            :disabled="busy || nothingChosen"
            data-testid="library-export-copy"
            @click="copyBundle"
          >
            <Copy :size="12" /> {{ copied ? 'Copied' : 'Copy JSON' }}
          </Button>
          <Button size="sm" :disabled="busy || nothingChosen" data-testid="library-export-download" @click="downloadBundle">
            <Download :size="12" /> Download
          </Button>
        </div>
      </section>

      <section class="block">
        <SectionLabel as="h3">Runnable page (.html)</SectionLabel>
        <p class="hint" data-testid="library-export-page-hint">{{ pageHint }}</p>
        <div class="actions">
          <Button size="sm" :disabled="busy || !pageHasContent" data-testid="library-export-html" @click="downloadPage">
            <Download :size="12" /> Download
          </Button>
        </div>
      </section>

      <p v-if="problem" class="problem" role="alert" data-testid="library-export-problem">{{ problem }}</p>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Copy, Download } from '@lucide/vue';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import SectionLabel from './shared/SectionLabel.vue';
import { useApiClient, type ExportBundleOptions } from '../composables/useApiClient';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { downloadTextFile } from '../lib/downloadFile';

const props = defineProps<{ open: boolean; libraryId: string; libraryName: string }>();
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

const apiClient = useApiClient();
const { isEnabled } = useFeatureFlags();

const offered = computed(() => ({
  groups: isEnabled('queryGroups'),
  etl: isEnabled('etl'),
  ruleSets: isEnabled('rulesSuite'),
}));

// All on, as the server has them: an export carries everything unless told not to.
const choice = reactive({ queries: true, examples: true, groups: true, etl: true, ruleSets: true });
const busy = ref(false);
const copied = ref(false);
const problem = ref<string | null>(null);

watch(isOpen, (open) => {
  if (open) problem.value = null;
});

/** The choice as the export call takes it; a member not offered is off. */
const options = computed(() => ({
  queries: choice.queries,
  examples: (choice.queries && choice.examples ? 'all' : 'none') as ExportBundleOptions['examples'],
  groups: offered.value.groups && choice.groups,
  etl: offered.value.etl && choice.etl,
  ruleSets: offered.value.ruleSets && choice.ruleSets,
}));

const nothingChosen = computed(() => {
  const { queries, groups, etl, ruleSets } = options.value;
  return !queries && !groups && !etl && !ruleSets;
});

/** The page runs queries and groups; ETL jobs and rule sets are the bundle's alone. */
const pageHasContent = computed(() => options.value.queries || options.value.groups);

const pageHint = computed(() => {
  const base = 'A self-contained page that runs the chosen queries and groups in a browser.';
  if (!pageHasContent.value) return `${base} Choose queries or query groups to make one.`;
  const bundleOnly = [options.value.etl && 'ETL jobs', options.value.ruleSets && 'rule sets'].filter(Boolean);
  return bundleOnly.length > 0 ? `${base} It does not show ${bundleOnly.join(' or ')}.` : base;
});

const fileStem = computed(() => props.libraryName.replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase() || 'library');

async function run(action: () => Promise<void>, failure: string) {
  busy.value = true;
  problem.value = null;
  try {
    await action();
  } catch (cause) {
    // Silence here reads as success, the one thing that did not happen.
    problem.value = cause instanceof Error ? `${failure}: ${cause.message}` : `${failure}.`;
  } finally {
    busy.value = false;
  }
}

function downloadBundle() {
  return run(async () => {
    const { bundle } = await apiClient.getLibraryExportBundle(props.libraryId, options.value);
    downloadTextFile(`${JSON.stringify(bundle, null, 2)}\n`, `${fileStem.value}.bundle.json`, 'application/json');
  }, 'Could not export the bundle');
}

function copyBundle() {
  return run(async () => {
    const { bundle } = await apiClient.getLibraryExportBundle(props.libraryId, options.value);
    await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  }, 'Could not copy the bundle');
}

function downloadPage() {
  return run(async () => {
    // The page shows neither, so the server need not compile them for it.
    const html = await apiClient.getLibraryExportHtml(props.libraryId, {
      ...options.value,
      etl: false,
      ruleSets: false,
    });
    downloadTextFile(html, `${fileStem.value}.html`, 'text/html');
  }, 'Could not export the page');
}
</script>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.block + .block {
  border-top: 1px solid var(--border);
  padding-top: var(--space-4);
}

.hint {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-content);
}

.option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-content);
  cursor: pointer;
}

.option--nested {
  padding-left: var(--space-6);
}

.option--off {
  color: var(--ink-muted);
  cursor: default;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.problem {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-content);
}
</style>
