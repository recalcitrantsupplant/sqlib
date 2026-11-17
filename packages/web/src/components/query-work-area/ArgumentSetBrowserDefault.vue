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
 * server id. The default names a set (float) or one of its versions (pin), and
 * the label follows the version the switcher shows:
 *
 * | Default | Shown as the default on |
 * | --- | --- |
 * | the set | its current version, and its draft |
 * | a version | that version, and the set's draft |
 *
 * Setting the default on the current version saves the set, so the default
 * follows the next save. On an older version it saves that version. See
 * `composables/useBrowserDefaults.ts`.
 */
import { computed, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import BrowserDefaultControl from '../shared/BrowserDefaultControl.vue';
import { isArgumentSetVersionIri, useBrowserDefaults } from '../../composables/useBrowserDefaults';
import type { useArgumentSets } from '../../composables/useArgumentSets';

const props = defineProps<{
  kind: 'query' | 'queryGroup';
  ownerId: string | null;
  args: ReturnType<typeof useArgumentSets>;
}>();

const defaults = useBrowserDefaults();
const busy = ref(false);

const current = computed(() => defaults.get(props.kind, props.ownerId)?.argumentSet ?? null);

/** The saved version the switcher shows, or `null` while a draft is open. */
const shownVersion = computed(() => (props.args.hasDraft.value ? null : props.args.selectedVersionId.value));

/** The default names the open set, whichever version of it. */
const namesOpenSet = computed(() => {
  const value = current.value;
  const setId = props.args.selectedSetId.value;
  if (!value || !setId) return false;
  if (!isArgumentSetVersionIri(value)) return value === setId;
  return props.args.versions.value.some((version) => version.id === value);
});

const isDefault = computed(() => {
  const value = current.value;
  if (!value || !namesOpenSet.value) return false;
  const shown = shownVersion.value;
  if (!shown) return true;
  return isArgumentSetVersionIri(value)
    ? shown === value
    : shown === props.args.currentVersionId.value;
});

const canSet = computed(() => props.args.selection.value.kind === 'set');

/** The set on its current version or draft; the version otherwise. */
const target = computed(() => {
  const shown = shownVersion.value;
  if (shown && shown !== props.args.currentVersionId.value) return shown;
  return props.args.selectedSetId.value;
});

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

const setDefault = () => write(target.value, 'This argument set now opens by default');
const clearDefault = () => write(null, 'Browser default cleared');
</script>
