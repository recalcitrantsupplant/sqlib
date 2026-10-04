<template>
  <BrowserDefaultControl
    v-if="ownerId"
    :is-default="isDefault"
    :has-default="hasDefault"
    :can-set="canSet"
    :busy="busy"
    @set="setDefault"
    @clear="clearDefault"
  />
</template>

<script setup lang="ts">
/**
 * The browser default for a callable's data graphs, beside their pickers.
 *
 * The pickers offer each graph's current version, so the default is saved as
 * the graph itself and floats: when the graph gets a new version, the default
 * follows it, as the picker does. A pin set through the API is honoured as it
 * stands. See `composables/useBrowserDefaults.ts`.
 */
import { computed, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import BrowserDefaultControl from './BrowserDefaultControl.vue';
import { sameDataGraphs, useBrowserDefaults } from '../../composables/useBrowserDefaults';
import type { DataGraphOption } from '../../types/data-graphs';

const props = defineProps<{
  kind: 'queryGroup' | 'ruleSet';
  ownerId: string | null;
  /** The `DataGraphVersion` picked for each input, by slot. */
  selection: Array<string | null>;
  /** The picker's options, to save a pick as the graph it is a version of. */
  options: DataGraphOption[];
}>();

const defaults = useBrowserDefaults();
const busy = ref(false);
/** The default, resolved to the version each input would select now. */
const resolved = ref<Array<string | null>>([]);

const stored = computed(() => defaults.get(props.kind, props.ownerId)?.dataGraphs ?? []);
const hasDefault = computed(() => stored.value.some(Boolean));
const isDefault = computed(() => hasDefault.value && sameDataGraphs(resolved.value, props.selection));
const canSet = computed(() => props.selection.some(Boolean));

watch(() => props.ownerId, (id) => {
  if (id && !defaults.get(props.kind, id)) void defaults.load(props.kind, id);
}, { immediate: true });

watch(stored, async (list) => {
  resolved.value = await defaults.resolveDataGraphs(list);
}, { immediate: true });

const graphFor = (versionId: string | null): string | null =>
  versionId ? (props.options.find((option) => option.versionId === versionId)?.graphId ?? versionId) : null;

async function write(dataGraphs: Array<string | null>, done: string) {
  if (!props.ownerId) return;
  busy.value = true;
  try {
    await defaults.save(props.kind, props.ownerId, { dataGraphs });
    toast.success(done);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not save the browser default');
  } finally {
    busy.value = false;
  }
}

const setDefault = () => write(
  props.selection.map(graphFor),
  props.kind === 'ruleSet' ? 'This data graph now opens by default' : 'These data graphs now open by default',
);
const clearDefault = () => write([], 'Browser default cleared');
</script>
