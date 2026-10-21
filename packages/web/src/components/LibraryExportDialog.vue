<template>
  <!--
    The library's exports, from the screen that is about the library.

    Two artifacts, one per block: the bundle, which the `sqlib` command line and
    the static runtime read, and the runnable page, which a browser opens. The
    toggles are the bundle's alone: the page shows queries only, so what else
    the bundle carries does not change it.
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
        <SectionLabel as="h3">Bundle (.json)</SectionLabel>
        <p class="hint">
          For the <code>sqlib</code> command line (<code>--bundle</code>) and the static runtime.
          Queries are always in it.
        </p>
        <label class="option">
          <Checkbox v-model="includeExamples" data-testid="library-export-examples" />
          Worked examples from the library’s tests
        </label>
        <label v-if="isEnabled('etl')" class="option">
          <Checkbox v-model="includeEtl" data-testid="library-export-etl" />
          ETL jobs
        </label>
        <label v-if="isEnabled('rulesSuite')" class="option">
          <Checkbox v-model="includeRuleSets" data-testid="library-export-rule-sets" />
          Rule sets
        </label>
        <div class="actions">
          <Button size="sm" variant="outline" :disabled="busy" data-testid="library-export-copy" @click="copyBundle">
            <Copy :size="12" /> {{ copied ? 'Copied' : 'Copy JSON' }}
          </Button>
          <Button size="sm" :disabled="busy" data-testid="library-export-download" @click="downloadBundle">
            <Download :size="12" /> Download
          </Button>
        </div>
      </section>

      <section class="block">
        <SectionLabel as="h3">Runnable page (.html)</SectionLabel>
        <p class="hint">A self-contained page that runs the library’s queries in a browser.</p>
        <div class="actions">
          <Button size="sm" :disabled="busy" data-testid="library-export-html" @click="downloadPage">
            <Download :size="12" /> Download
          </Button>
        </div>
      </section>

      <p v-if="problem" class="problem" role="alert" data-testid="library-export-problem">{{ problem }}</p>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
import { useApiClient } from '../composables/useApiClient';
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

// On by default, as the server has them: a bundle carries everything unless told not to.
const includeExamples = ref(true);
const includeEtl = ref(true);
const includeRuleSets = ref(true);
const busy = ref(false);
const copied = ref(false);
const problem = ref<string | null>(null);

watch(isOpen, (open) => {
  if (open) problem.value = null;
});

const fileStem = computed(() => props.libraryName.replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase() || 'library');

/** A member whose screen this build does not draw is left out: the library has none of it to give. */
function fetchBundle() {
  return apiClient.getLibraryExportBundle(props.libraryId, {
    examples: includeExamples.value ? 'all' : 'none',
    etl: isEnabled('etl') && includeEtl.value === true,
    ruleSets: isEnabled('rulesSuite') && includeRuleSets.value === true,
  });
}

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
    const { bundle } = await fetchBundle();
    downloadTextFile(`${JSON.stringify(bundle, null, 2)}\n`, `${fileStem.value}.bundle.json`, 'application/json');
  }, 'Could not export the bundle');
}

function copyBundle() {
  return run(async () => {
    const { bundle } = await fetchBundle();
    await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  }, 'Could not copy the bundle');
}

function downloadPage() {
  return run(async () => {
    const html = await apiClient.getLibraryExportHtml(props.libraryId, {
      examples: includeExamples.value ? 'all' : 'none',
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
