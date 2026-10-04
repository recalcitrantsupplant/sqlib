<template>
  <BrowserDefaultControl
    v-if="ownerId"
    :is-default="isDefault"
    :has-default="!!current"
    :can-set="canSet"
    :busy="busy"
    @set="setDefault"
    @clear="clearDefault"
  />
</template>

<script setup lang="ts">
/**
 * The browser default for a callable's argument set, under its switcher.
 *
 * A saved set can be the default; a scratch one cannot, because it has no
 * server id. The default is the set, not a version: the switcher picks the
 * version per run. See `composables/useBrowserDefaults.ts`.
 */
import { computed, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import BrowserDefaultControl from '../shared/BrowserDefaultControl.vue';
import { useBrowserDefaults } from '../../composables/useBrowserDefaults';
import type { useArgumentSets } from '../../composables/useArgumentSets';

const props = defineProps<{
  kind: 'query' | 'queryGroup';
  ownerId: string | null;
  args: ReturnType<typeof useArgumentSets>;
}>();

const defaults = useBrowserDefaults();
const busy = ref(false);

const current = computed(() => defaults.get(props.kind, props.ownerId)?.argumentSet ?? null);
const isDefault = computed(() => !!current.value && props.args.selectedSetId.value === current.value);
const canSet = computed(() => props.args.selection.value.kind === 'set');

watch(() => props.ownerId, (id) => {
  if (id && !defaults.get(props.kind, id)) void defaults.load(props.kind, id);
}, { immediate: true });

async function write(argumentSet: string | null, done: string) {
  if (!props.ownerId) return;
  busy.value = true;
  try {
    await defaults.save(props.kind, props.ownerId, { argumentSet });
    toast.success(done);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not save the browser default');
  } finally {
    busy.value = false;
  }
}

const setDefault = () => write(props.args.selectedSetId.value, 'This argument set now opens by default');
const clearDefault = () => write(null, 'Browser default cleared');
</script>
