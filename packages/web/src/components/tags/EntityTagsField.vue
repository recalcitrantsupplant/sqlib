<template>
  <div class="tags-field" data-testid="entity-tags-field">
    <span
      v-for="tag in assigned"
      :key="tag.id"
      class="tag-chip"
      :style="{ background: tag.color, color: tag.ink }"
      :data-testid="`entity-tag-chip-${tag.id}`"
    >
      {{ tag.name }}
      <button
        v-if="canWrite"
        type="button"
        class="chip-remove"
        :title="`Remove ${tag.name}`"
        :aria-label="`Remove ${tag.name}`"
        :disabled="busy"
        @click="toggle(tag.id)"
      >
        <X :size="10" />
      </button>
    </span>

    <!--
      No "none": the dashed `+ Tag` outline already says the row is empty, and
      the word sat beside it as a second empty state at a third height.
    -->
    <div class="picker-anchor">
      <button
        v-if="canWrite"
        ref="triggerRef"
        type="button"
        class="add-tag"
        data-testid="entity-tags-add"
        :disabled="!entityId || busy"
        :title="entityId ? 'Add a tag' : 'Save this first — a scratch item has nothing to tag yet'"
        @click="open = !open"
      >
        <Plus :size="11" />Tag
      </button>

      <div v-if="open" ref="popoverRef" class="picker-popover">
        <TagPicker
          :tags="tagsStore.tags.value"
          :selected="assignedIds"
          :entity-name="entityName"
          :counts="entityTags.countsByTag.value"
          :next-color="tagsStore.nextColor.value"
          @toggle="toggle"
          @create="create"
          @close="open = false"
        />
      </div>
    </div>

    <span v-if="error" class="tags-error" data-testid="entity-tags-error">{{ error }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * Tag assignment on the entity's Details panel.
 *
 * It writes for itself rather than emitting upward, and that is deliberate.
 * Tags are not part of the body being edited — they live on the stable entity,
 * not the version (§4.4) — so routing them through the work area's draft and
 * save machinery would make "add a label" wait for a save, and make a
 * save able to revert one. A tag click is its own small write.
 *
 * Scratch has no entity to write to, so the trigger is disabled and says why.
 * Pending tags on unsaved items are a real want (§5) and want the draft
 * store rather than this component; nothing here precludes it.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Plus, X } from '@lucide/vue';
import TagPicker from './TagPicker.vue';
import { useTagsStore } from '../../composables/useTagsStore';
import { useEntityTags, type TaggableKind } from '../../composables/useEntityTags';
import { useActiveLibrary } from '../../composables/useActiveLibrary';
import { useDeploymentMode } from '../../composables/useDeploymentMode';
import { normalizeTagColor, tagForeground } from '../../lib/tagPalette';

const props = defineProps<{
  /** Null while the item is scratch — there is nothing to tag yet. */
  entityId: string | null;
  kind: TaggableKind;
  entityName: string;
}>();

/*
 * A tag click is its own small write, so a read-only deployment refuses it —
 * assigned tags stay on screen as the labels they are, and the two controls
 * that would change them go.
 */
const deployment = useDeploymentMode();
const canWrite = computed(() => !deployment.isReadOnly.value);

const tagsStore = useTagsStore();
const entityTags = useEntityTags();
const { activeLibraryId } = useActiveLibrary();

const open = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);

onMounted(() => {
  void tagsStore.ensureLoaded(activeLibraryId.value);
  document.addEventListener('mousedown', onDocumentDown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentDown, true);
});

watch(activeLibraryId, (id) => {
  open.value = false;
  void tagsStore.ensureLoaded(id);
});

function onDocumentDown(event: MouseEvent) {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (!target) return;
  if (popoverRef.value?.contains(target) || triggerRef.value?.contains(target)) return;
  open.value = false;
}

const assignedIds = computed(() => (props.entityId ? entityTags.tagsOf(props.kind, props.entityId) : []));

const assigned = computed(() =>
  assignedIds.value
    .map((id) => tagsStore.tagsById.value.get(id))
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: normalizeTagColor(tag.color),
      ink: tagForeground(tag.color),
    })),
);

async function run(work: () => Promise<void>) {
  busy.value = true;
  error.value = null;
  try {
    await work();
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Could not save tags';
  } finally {
    busy.value = false;
  }
}

function toggle(tagId: string) {
  if (!props.entityId) return;
  void run(() => entityTags.toggleTag(props.kind, props.entityId!, tagId));
}

/** Create-and-apply is one gesture: a tag made here is always wanted here. */
function create(name: string) {
  const libraryId = activeLibraryId.value;
  if (!props.entityId || !libraryId) return;
  void run(async () => {
    const tag = await tagsStore.createTag({ name, libraryId });
    await entityTags.setTags(props.kind, props.entityId!, [...assignedIds.value, tag.id]);
  });
}
</script>

<style scoped>
.tags-field {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.tag-chip {
  display: inline-flex;
  height: var(--control-h-sm);
  align-items: center;
  gap: 3px;
  padding: 0 var(--space-2) 0 var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
}

.chip-remove {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
}

.chip-remove:hover {
  opacity: 1;
}

.picker-anchor {
  position: relative;
}

.add-tag {
  display: inline-flex;
  height: var(--control-h-sm);
  align-items: center;
  gap: 3px;
  padding: 0 var(--space-3);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-full);
  background: none;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.add-tag:hover:not(:disabled) {
  border-style: solid;
  color: var(--ink-secondary);
}

.add-tag:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.picker-popover {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
}

.tags-error {
  flex-basis: 100%;
  color: var(--danger);
  font-size: var(--text-label);
}
</style>
