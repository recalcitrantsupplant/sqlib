<template>
  <div class="compact-header-row">
    <SectionLabel as="h3" size="lg">{{ title }}</SectionLabel>

    <div class="header-actions">
      <div v-if="$slots['entity-actions']" class="entity-actions">
        <slot name="entity-actions" />
      </div>

      <div class="metadata-edit-actions">
        <button
          v-if="isViewMode"
          class="btn-compact btn-edit"
          :title="editTitle"
          @click="$emit('edit')"
        >
          <Edit :size="12" />
          {{ editLabel }}
        </button>

        <button
          v-if="isViewMode"
          class="btn-compact btn-delete"
          :title="deleteTitle"
          @click="$emit('delete')"
        >
          <Trash2 :size="12" />
          {{ deleteLabel }}
        </button>

        <template v-else-if="isEditMode">
          <button
            class="btn-compact btn-save"
            :title="saveTitle"
            @click="$emit('save')"
          >
            <Save :size="12" />
            {{ saveLabel }}
          </button>
          <button
            class="btn-compact"
            :title="cancelTitle"
            @click="$emit('cancel')"
          >
            <X :size="12" />
            {{ cancelLabel }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Edit, Save, X, Trash2 } from '@lucide/vue';
import SectionLabel from './SectionLabel.vue';

withDefaults(
  defineProps<{
    title: string;
    isViewMode: boolean;
    isEditMode: boolean;
    editLabel?: string;
    editTitle?: string;
    saveLabel?: string;
    saveTitle?: string;
    cancelLabel?: string;
    cancelTitle?: string;
    deleteLabel?: string;
    deleteTitle?: string;
  }>(),
  {
    editLabel: 'Edit',
    editTitle: 'Edit Details',
    saveLabel: 'Save',
    saveTitle: 'Save Details',
    cancelLabel: 'Cancel',
    cancelTitle: 'Cancel',
    deleteLabel: 'Delete',
    deleteTitle: 'Delete',
  },
);

defineEmits<{
  (e: 'edit'): void;
  (e: 'save'): void;
  (e: 'cancel'): void;
  (e: 'delete'): void;
}>();

// ensure props are referenced for reactivity
</script>

<style scoped>
.compact-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
  gap: 16px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.metadata-edit-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.entity-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
</style>
