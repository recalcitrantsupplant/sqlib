<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent class="sm:max-w-lg" data-testid="tag-manager">
      <DialogHeader>
        <DialogTitle>Tags in {{ libraryName }}</DialogTitle>
        <DialogDescription>
          Tags classify what a library already contains — renaming or recolouring one changes it
          everywhere, and deleting one unlabels what carried it without deleting anything.
        </DialogDescription>
      </DialogHeader>

      <div class="tag-rows">
        <p v-if="tagsStore.loading.value" class="manager-note">Loading…</p>
        <p v-else-if="rows.length === 0" class="manager-note" data-testid="tag-manager-empty">
          No tags yet. Add one from any entity's Details panel — a tag is created where it is first used.
        </p>

        <div v-for="row in rows" :key="row.id" class="tag-row" :data-testid="`tag-manager-row-${row.id}`">
          <div class="row-head">
            <button
              type="button"
              class="colour-button"
              :title="`Change ${row.name}'s colour`"
              :aria-label="`Change ${row.name}'s colour`"
              :data-testid="`tag-colour-${row.id}`"
              @click="editingColour = editingColour === row.id ? null : row.id"
            >
              <TagDot :color="row.color" size="heading" />
            </button>
            <input
              class="name-input"
              :value="row.name"
              :aria-label="`Name of ${row.name}`"
              :data-testid="`tag-name-${row.id}`"
              @change="rename(row.id, ($event.target as HTMLInputElement).value)"
            />
            <span class="row-count">{{ counts[row.id] ?? 0 }}</span>
            <button
              type="button"
              class="delete-button"
              :title="`Delete ${row.name}`"
              :aria-label="`Delete ${row.name}`"
              :data-testid="`tag-delete-${row.id}`"
              @click="pendingDelete = row.id"
            >
              <Trash2 :size="13" />
            </button>
          </div>

          <TagSwatchGrid
            v-if="editingColour === row.id"
            :current="row.color"
            :taken="takenExcept(row.id)"
            :tag-name="row.name"
            @select="(color) => recolour(row.id, color)"
          />

          <!--
            Delete says what it will do rather than asking whether you are sure:
            the count is the fact that decides it, and "unlabels" is the part
            people expect to mean "deletes".
          -->
          <div v-if="pendingDelete === row.id" class="confirm-row" :data-testid="`tag-confirm-${row.id}`">
            <span class="confirm-text">
              Delete “{{ row.name }}”? It is removed from
              {{ counts[row.id] ?? 0 }} {{ (counts[row.id] ?? 0) === 1 ? 'entity' : 'entities' }}; nothing else changes.
            </span>
            <button type="button" class="confirm-cancel" @click="pendingDelete = null">Cancel</button>
            <button
              type="button"
              class="confirm-delete"
              :data-testid="`tag-confirm-delete-${row.id}`"
              @click="remove(row.id)"
            >
              Delete
            </button>
          </div>
        </div>

        <p v-if="error" class="manager-error" data-testid="tag-manager-error">{{ error }}</p>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * Rename, recolour, delete — the library-level surface, reached from the tag
 * menu in the list header — tags belong to the library, and that is the only
 * menu about them now the library strip has been replaced by the rail's
 * switcher.
 *
 * Creating is deliberately absent. A tag is made where it is first used, in
 * the picker on an entity, so a create form here would make an unused tag —
 * the one kind of tag nothing in the app can show you.
 */
import { computed, ref, watch } from 'vue';
import { Trash2 } from '@lucide/vue';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import TagDot from './TagDot.vue';
import TagSwatchGrid from './TagSwatchGrid.vue';
import { useTagsStore } from '../../composables/useTagsStore';
import { useEntityTags } from '../../composables/useEntityTags';
import { useActiveLibrary } from '../../composables/useActiveLibrary';
import { normalizeTagColor } from '../../lib/tagPalette';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>();

const tagsStore = useTagsStore();
const entityTags = useEntityTags();
const { activeLibraryId, activeLibraryName } = useActiveLibrary();

const editingColour = ref<string | null>(null);
const pendingDelete = ref<string | null>(null);
const error = ref<string | null>(null);

const libraryName = computed(() => activeLibraryName.value);
const counts = computed(() => entityTags.countsByTag.value);

const rows = computed(() =>
  tagsStore.tags.value.map((tag) => ({ id: tag.id, name: tag.name, color: normalizeTagColor(tag.color) })),
);

watch(
  () => props.open,
  (open) => {
    editingColour.value = null;
    pendingDelete.value = null;
    error.value = null;
    if (open) void tagsStore.loadTags(activeLibraryId.value);
  },
);

function takenExcept(id: string): string[] {
  return tagsStore.tags.value.filter((tag) => tag.id !== id).map((tag) => normalizeTagColor(tag.color));
}

async function run(work: () => Promise<void>) {
  error.value = null;
  try {
    await work();
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Could not save the tag';
  }
}

function rename(id: string, name: string) {
  const trimmed = name.trim();
  const current = tagsStore.tags.value.find((tag) => tag.id === id);
  if (!trimmed || !current || trimmed === current.name) return;
  void run(() => tagsStore.updateTag(id, { name: trimmed }).then(() => undefined));
}

function recolour(id: string, color: string) {
  editingColour.value = null;
  void run(() => tagsStore.updateTag(id, { color }).then(() => undefined));
}

/*
 * A delete unlabels, so every list holding a tagged row is now showing a dot
 * for a tag that is gone. Reloading them is what makes the sweep visible —
 * the server has already done it.
 */
function remove(id: string) {
  pendingDelete.value = null;
  void run(async () => {
    await tagsStore.deleteTag(id);
    await entityTags.reloadAll();
  });
}
</script>

<style scoped>
.tag-rows {
  display: flex;
  max-height: 50vh;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.tag-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: var(--space-3) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

.row-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.colour-button {
  display: inline-flex;
  height: 22px;
  width: 22px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  cursor: pointer;
}

.name-input {
  min-width: 0;
  flex: 1;
  height: 26px;
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
}

.name-input:hover,
.name-input:focus {
  border-color: var(--border-default);
  background: var(--surface);
}

.row-count {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.delete-button {
  display: inline-flex;
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.delete-button:hover {
  color: var(--danger);
}

.confirm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-label);
}

.confirm-text {
  flex: 1;
  color: var(--ink-secondary);
}

.confirm-cancel,
.confirm-delete {
  height: 22px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.confirm-delete {
  border-color: var(--danger);
  color: var(--danger);
}

.manager-note {
  color: var(--ink-muted);
  font-size: var(--text-body);
}

.manager-error {
  color: var(--danger);
  font-size: var(--text-label);
}
</style>
