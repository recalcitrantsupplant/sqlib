<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sync-dialog p-0 gap-0" :show-close-button="false">
      <DialogTitleBar title="Sync with endpoint" @close="isOpen = false">
        <template #meta>
          <span v-if="lastSyncedLabel" class="sync-subtitle">{{ lastSyncedLabel }}</span>
        </template>
      </DialogTitleBar>

      <div class="sync-body">
        <DialogDescription class="sync-blurb">
          Reconcile these prefix mappings with the prefix map the store itself holds.
        </DialogDescription>

        <!-- 1. Which store. A backend with no prefix service is listed and disabled, with
             the reason on it: the fix is in the dataset's Fuseki config, not here. -->
        <section class="field">
          <span class="field-label">Backend</span>
          <SearchSelect
            test-id="prefix-sync-backend"
            aria-label="Backend"
            placeholder="Choose a backend…"
            empty-label="Choose a backend…"
            :model-value="backendId"
            :options="backendSelectOptions"
            @update:model-value="onBackendChosen"
          />
          <p v-if="selectedCapabilityNote" class="field-note">{{ selectedCapabilityNote }}</p>
        </section>

        <!-- 2. Direction, with each shape's own options under it. -->
        <section class="field">
          <span class="field-label">Direction</span>
          <div class="directions" role="radiogroup" aria-label="Sync direction">
            <button
              v-for="option in directionOptions"
              :key="option.value"
              type="button"
              role="radio"
              class="direction-card"
              :class="{ active: direction === option.value }"
              :aria-checked="direction === option.value"
              :disabled="option.disabled"
              :title="option.disabledReason"
              @click="setDirection(option.value)"
            >
              <span class="direction-name">{{ option.label }}</span>
              <span class="direction-blurb">{{ option.blurb }}</span>
            </button>
          </div>

          <label v-if="direction !== 'bidirectional'" class="checkbox">
            <input v-model="options.mirror" type="checkbox" @change="replan" />
            <span>{{ mirrorLabel }}</span>
          </label>

          <div v-if="direction !== 'pull'" class="sources">
            <span class="sources-label">Push mappings from:</span>
            <label v-for="source in pushSourceOptions" :key="source.value" class="checkbox">
              <input
                type="checkbox"
                :checked="options.pushSources.includes(source.value)"
                @change="toggleSource(source.value)"
              />
              <span>{{ source.label }}</span>
            </label>
          </div>
        </section>

        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="loading" class="muted">Reading the store's prefixes…</p>

        <!-- 3. Conflicts, which gate Apply. -->
        <section v-if="conflicts.length" class="conflicts">
          <header class="section-head">
            <h3 class="section-title">
              {{ conflicts.length }} {{ conflicts.length === 1 ? 'conflict' : 'conflicts' }}
            </h3>
            <div class="bulk">
              <button type="button" class="link-button" @click="resolveAll('local')">Keep all local</button>
              <button type="button" class="link-button" @click="resolveAll('remote')">Take all remote</button>
            </div>
          </header>
          <ul class="conflict-list">
            <li v-for="conflict in conflicts" :key="conflict.prefix" class="conflict-row">
              <div class="conflict-values">
                <code class="conflict-prefix">{{ conflict.prefix }}:</code>
                <span class="conflict-side">
                  <span class="side-label">here</span>
                  <code>{{ conflict.local ?? 'removed' }}</code>
                </span>
                <span class="conflict-side">
                  <span class="side-label">store</span>
                  <code>{{ conflict.remote ?? 'removed' }}</code>
                </span>
              </div>
              <div class="resolutions" role="radiogroup" :aria-label="`Resolve ${conflict.prefix}`">
                <button
                  v-for="choice in resolutionChoices"
                  :key="choice.value"
                  type="button"
                  role="radio"
                  class="resolution"
                  :class="{ active: conflict.resolution === choice.value }"
                  :aria-checked="conflict.resolution === choice.value"
                  :disabled="choice.value === 'both' && (conflict.local === null || conflict.remote === null)"
                  @click="setResolution(conflict.prefix, choice.value)"
                >{{ choice.label }}</button>
              </div>
            </li>
          </ul>
        </section>

        <!-- 4. Everything the plan would do, before anything is touched. -->
        <section v-if="plan" class="preview">
          <div v-for="group in previewGroups" :key="group.title" class="preview-group">
            <h3 class="section-title">{{ group.title }} ({{ group.items.length }})</h3>
            <ul class="preview-list">
              <li v-for="(item, index) in group.items" :key="`${group.title}-${index}`">
                <code>{{ item.prefix }}:</code>
                <span class="preview-detail">{{ item.detail }}</span>
                <span v-if="item.note" class="preview-note">{{ item.note }}</span>
              </li>
            </ul>
          </div>
          <p v-if="!actionCount" class="muted">Nothing to do — both sides already agree.</p>
          <details v-if="plan.skipped.length" class="skipped">
            <summary>{{ plan.skipped.length }} skipped</summary>
            <ul class="preview-list">
              <li v-for="(entry, index) in plan.skipped" :key="`skipped-${index}`">
                <code>{{ entry.prefix }}:</code>
                <span class="preview-detail">{{ entry.reason }}</span>
              </li>
            </ul>
          </details>
        </section>

        <!-- 5. What actually happened, including the half that did not. -->
        <section v-if="outcome" class="outcome">
          <h3 class="section-title">Result</h3>
          <p class="muted">{{ outcomeLabel }}</p>
          <ul v-if="outcome.failures.length" class="preview-list failures">
            <li v-for="failure in outcome.failures" :key="failure.prefix">
              <code>{{ failure.prefix }}:</code>
              <span class="preview-detail">{{ failure.error }}</span>
            </li>
          </ul>
        </section>
      </div>

      <footer class="sync-footer">
        <span v-if="blocked" class="muted">Resolve every conflict to continue.</span>
        <div class="footer-actions">
          <button type="button" class="btn-secondary" @click="isOpen = false">Close</button>
          <button
            type="button"
            class="btn-primary"
            :disabled="!canApply"
            @click="onApply"
          >{{ applying ? 'Applying…' : applyLabel }}</button>
        </div>
      </footer>
    </DialogContent>
  </Dialog>

  <!-- A mirror is the one genuinely destructive shape here, so it confirms
       (docs/guides/prefixes.md) while the recoverable local edits do not. -->
  <AlertDialog v-model:open="showMirrorConfirm">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ mirrorConfirmTitle }}</AlertDialogTitle>
        <AlertDialogDescription>{{ mirrorConfirmBody }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="showMirrorConfirm = false">Cancel</AlertDialogCancel>
        <AlertDialogAction @click="confirmMirror">Apply</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
/**
 * Endpoint sync for the prefix manager.
 *
 * Opened from the manager's overflow menu. Everything it shows comes from one
 * plan built by `planPrefixSync`, and nothing is applied until the user has
 * seen that plan and answered every conflict on it — see
 * `docs/guides/prefixes.md`.
 */
import { ref, computed, watch } from 'vue';
import { useBackendsStore } from '@/composables/useBackendsStore';
import { useBackendProbes } from '@/composables/useBackendProbes';
import { usePrefixSync } from '@/composables/usePrefixSync';
import { DEFAULT_SYNC_OPTIONS, type ConflictResolution, type PrefixSyncAction, type SyncDirection } from '@/lib/prefixSyncPlan';
import type { PrefixMapping } from '@/types/prefixes';
import { Dialog, DialogContent, DialogDescription } from './ui/dialog';
import DialogTitleBar from './shared/DialogTitleBar.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import SearchSelect from '@/components/shared/SearchSelect.vue';
import { toast } from 'vue-sonner';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const isOpen = ref(props.open);
watch(() => props.open, (value) => { isOpen.value = value; });
watch(isOpen, (value) => {
  emit('update:open', value);
  if (value) {
    void backendsStore.loadBackends();
    void probes.loadProbes();
  }
});

const backendsStore = useBackendsStore();
const probes = useBackendProbes();
const {
  plan,
  loading,
  applying,
  error,
  outcome,
  blocked,
  loadRemote,
  buildPlan,
  setResolution: applyResolution,
  resolveAll: applyResolveAll,
  apply,
  readBaseline,
} = usePrefixSync();

const backendId = ref('');
const direction = ref<SyncDirection>('pull');
const options = ref({ ...DEFAULT_SYNC_OPTIONS, pushSources: [...DEFAULT_SYNC_OPTIONS.pushSources] });
const showMirrorConfirm = ref(false);

const resolutionChoices: Array<{ value: ConflictResolution; label: string }> = [
  { value: 'local', label: 'Keep local' },
  { value: 'remote', label: 'Take remote' },
  { value: 'both', label: 'Keep both' },
  { value: 'skip', label: 'Skip' },
];

const pushSourceOptions: Array<{ value: PrefixMapping['source']; label: string }> = [
  { value: 'user-added', label: 'Added by you' },
  { value: 'auto-discovered', label: 'Discovered' },
  { value: 'endpoint', label: 'From endpoints' },
  { value: 'default', label: 'Defaults' },
];

/**
 * Capability comes from the probe the sidebar has already loaded, so opening
 * this dialog costs one read of the chosen store rather than a sweep of them
 * all. A backend nobody has probed yet reports nothing, which reads as "not
 * established" rather than "unavailable".
 */
const backendOptions = computed(() =>
  backendsStore.backends.value.map((backend) => {
    const capability = probes.probeFor(backend.id)?.prefixes ?? null;
    const canRead = capability?.read !== null && capability?.read !== undefined;
    const canWrite = capability?.write === 'jena-prefixes';
    const suffix = !capability
      ? ' — not probed yet'
      : canWrite
        ? ' — read/write'
        : canRead
          ? ' — read-only'
          : ' — no prefix service';
    return { id: backend.id, label: `${backend.name}${suffix}`, canRead: canRead || !capability, canWrite };
  })
);

/* Fuzzy-filtered, and carrying the "can it even do this" state as the native
 * select's `disabled` did — the label states the reason either way. */
const backendSelectOptions = computed(() =>
  backendOptions.value.map((option) => ({
    value: option.id,
    label: option.label,
    disabled: !option.canRead,
  })),
);

const selected = computed(() => backendOptions.value.find((option) => option.id === backendId.value) ?? null);

const selectedCapabilityNote = computed(() => {
  if (!selected.value) return null;
  if (selected.value.canWrite) return null;
  return 'This store exposes its prefixes read-only, so only Pull is available. '
    + 'A Fuseki dataset needs a read-write prefixes endpoint (fuseki:prefixes-rw) declared on it to accept a push.';
});

const directionOptions = computed(() => [
  { value: 'pull' as const, label: 'Pull', blurb: 'Take the store\'s prefixes', disabled: false, disabledReason: '' },
  {
    value: 'push' as const,
    label: 'Push',
    blurb: 'Send these prefixes to the store',
    disabled: !selected.value?.canWrite,
    disabledReason: selected.value?.canWrite ? '' : 'This store has no writable prefix endpoint',
  },
  {
    value: 'bidirectional' as const,
    label: 'Both ways',
    blurb: 'Merge, asking about disagreements',
    disabled: !selected.value?.canWrite,
    disabledReason: selected.value?.canWrite ? '' : 'This store has no writable prefix endpoint',
  },
]);

const mirrorLabel = computed(() =>
  direction.value === 'pull'
    ? 'Also remove local mappings the store does not have'
    : 'Also delete prefixes from the store that are not here'
);

const conflicts = computed(() =>
  (plan.value?.actions ?? []).filter(
    (action): action is Extract<PrefixSyncAction, { kind: 'conflict' }> => action.kind === 'conflict'
  )
);

const actionCount = computed(() => plan.value?.actions.length ?? 0);

const previewGroups = computed(() => {
  const actions = plan.value?.actions ?? [];
  const groups: Array<{ title: string; items: Array<{ prefix: string; detail: string; note?: string }> }> = [
    { title: 'Add here', items: [] },
    { title: 'Update here', items: [] },
    { title: 'Remove here', items: [] },
    { title: 'Add to store', items: [] },
    { title: 'Update in store', items: [] },
    { title: 'Remove from store', items: [] },
  ];
  const push = (index: number, item: { prefix: string; detail: string; note?: string }) => groups[index].items.push(item);

  for (const action of actions) {
    switch (action.kind) {
      case 'pull-add': push(0, { prefix: action.prefix, detail: action.namespace, note: action.note }); break;
      case 'pull-update': push(1, { prefix: action.prefix, detail: `${action.from} → ${action.to}` }); break;
      case 'pull-delete': push(2, { prefix: action.prefix, detail: action.namespace }); break;
      case 'push-add': push(3, { prefix: action.prefix, detail: action.namespace }); break;
      case 'push-update': push(4, { prefix: action.prefix, detail: `${action.from} → ${action.to}` }); break;
      case 'push-delete': push(5, { prefix: action.prefix, detail: action.namespace }); break;
      default: break;
    }
  }

  return groups.filter((group) => group.items.length > 0);
});

const canApply = computed(() =>
  Boolean(plan.value) && !blocked.value && !applying.value && actionCount.value > 0
);

const applyLabel = computed(() => (actionCount.value ? `Apply ${actionCount.value} change${actionCount.value === 1 ? '' : 's'}` : 'Apply'));

const lastSyncedLabel = computed(() => {
  if (!backendId.value) return null;
  const baseline = readBaseline(backendId.value);
  if (!baseline) return null;
  return `Last synced ${new Date(baseline.syncedAt).toLocaleString()}`;
});

const outcomeLabel = computed(() => {
  const result = outcome.value;
  if (!result) return '';
  const parts: string[] = [];
  if (result.localAdded) parts.push(`${result.localAdded} added here`);
  if (result.localUpdated) parts.push(`${result.localUpdated} updated here`);
  if (result.localRemoved) parts.push(`${result.localRemoved} removed here`);
  if (result.pushed) parts.push(`${result.pushed} applied to the store`);
  if (result.pushFailed) parts.push(`${result.pushFailed} refused by the store`);
  return parts.length ? parts.join(', ') : 'Nothing changed.';
});

const mirrorConfirmTitle = computed(() =>
  direction.value === 'pull' ? 'Remove local mappings?' : 'Delete prefixes from the store?'
);

const mirrorConfirmBody = computed(() => {
  const removals = (plan.value?.actions ?? []).filter(
    (action) => action.kind === (direction.value === 'pull' ? 'pull-delete' : 'push-delete')
  ).length;
  return direction.value === 'pull'
    ? `${removals} mapping${removals === 1 ? '' : 's'} will be removed from this browser.`
    : `${removals} prefix${removals === 1 ? '' : 'es'} will be deleted from the store's own prefix map. `
      + 'This changes the dataset for everyone using it.';
});

async function onBackendChosen(value: string) {
  backendId.value = value;
  if (!backendId.value) return;
  const loaded = await loadRemote(backendId.value);
  if (!selected.value?.canWrite && direction.value !== 'pull') direction.value = 'pull';
  if (loaded) replan();
}

function setDirection(value: SyncDirection) {
  direction.value = value;
  options.value.mirror = false;
  replan();
}

function toggleSource(source: PrefixMapping['source']) {
  const sources = options.value.pushSources;
  const index = sources.indexOf(source);
  if (index === -1) sources.push(source);
  else sources.splice(index, 1);
  replan();
}

function replan() {
  if (!backendId.value) return;
  buildPlan(backendId.value, direction.value, {
    mirror: options.value.mirror,
    pushSources: [...options.value.pushSources],
  });
}

function setResolution(prefix: string, resolution: ConflictResolution) {
  applyResolution(prefix, resolution);
}

function resolveAll(resolution: ConflictResolution) {
  applyResolveAll(resolution);
}

function hasRemovals(): boolean {
  return (plan.value?.actions ?? []).some(
    (action) => action.kind === 'pull-delete' || action.kind === 'push-delete'
  );
}

async function onApply() {
  if (options.value.mirror && hasRemovals()) {
    showMirrorConfirm.value = true;
    return;
  }
  await runApply();
}

async function confirmMirror() {
  showMirrorConfirm.value = false;
  await runApply();
}

async function runApply() {
  const result = await apply();
  if (result) {
    toast.success(outcomeLabel.value);
    replan();
  } else if (error.value) {
    toast.error(error.value);
  }
}
</script>

<style>
.sync-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(95vw, 820px);
  max-width: min(95vw, 820px);
  max-height: 85vh;
  border-radius: var(--radius-xl);
  overflow: hidden;
}
</style>

<style scoped>
/* The last-synced label the title bar carries in its `meta` slot; slotted
   content is compiled in this component's scope, so the rule stays here. */
.sync-subtitle,
.muted {
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.sync-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 0;
  padding: var(--space-5);
  overflow-y: auto;
}

.sync-blurb {
  font-size: var(--text-body);
  line-height: 1.5;
  color: var(--ink-muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.field-label,
.sources-label {
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  color: var(--ink-secondary);
}

.field-note {
  font-size: var(--text-body);
  color: var(--ink-muted);
  line-height: 1.5;
}

.select {
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
}

.directions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.direction-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}

.direction-card.active {
  border-color: var(--action);
  background: var(--surface-subtle);
}

.direction-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.direction-name {
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
}

.direction-blurb {
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-body);
  color: var(--ink-secondary);
}

.sources {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
}

.section-title {
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.bulk {
  display: flex;
  gap: var(--space-4);
}

.link-button {
  border: none;
  background: none;
  padding: 0;
  color: var(--action);
  font-size: var(--text-body);
  cursor: pointer;
}

.conflict-list,
.preview-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-body);
}

.conflict-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
}

.conflict-values {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-4);
  min-width: 0;
}

.conflict-prefix {
  font-weight: var(--weight-medium);
}

.conflict-side {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.side-label {
  color: var(--ink-muted);
}

.resolutions {
  display: inline-flex;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  overflow: hidden;
}

.resolution {
  padding: var(--space-2) var(--space-3);
  border: none;
  background: var(--surface);
  color: var(--ink-secondary);
  font-size: var(--text-body);
  cursor: pointer;
}

.resolution.active {
  background: var(--action);
  color: var(--action-fg);
}

.resolution:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.preview-group + .preview-group {
  margin-top: var(--space-4);
}

.preview-detail {
  margin-left: var(--space-3);
  color: var(--ink-muted);
}

.preview-note {
  margin-left: var(--space-3);
  color: var(--ink-muted);
  font-style: italic;
}

.failures .preview-detail {
  color: var(--danger, var(--ink));
}

.error {
  font-size: var(--text-body);
  color: var(--danger, var(--ink));
}

.sync-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5);
  border-top: 1px solid var(--border-default);
}

.footer-actions {
  display: flex;
  gap: var(--space-3);
  margin-left: auto;
}

.btn-primary,
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--control-h);
  padding: 0 var(--space-5);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.btn-primary {
  border: 1px solid var(--action);
  background: var(--action);
  color: var(--action-fg);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  border: 1px solid var(--border-default);
  background: var(--surface);
  color: var(--ink);
}
</style>
