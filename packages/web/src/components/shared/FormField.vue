<template>
  <label class="form-field" :class="{ 'form-field--grow': grow, 'form-field--inline': inline }">
    <!--
      The label row is a row, not a lone word: a control that belongs to this
      field but not inside it — Expand, on the fields that hold a document —
      goes at its end rather than floating over the field's contents.
    -->
    <div v-if="!inline" class="form-field__header">
      <SectionLabel as="span">{{ label }}</SectionLabel>
      <!--
        `@click.stop` because the field is a `<label>`: a click on a control in
        here is about that control, not about the field it labels.
      -->
      <span v-if="$slots.actions" class="form-field__actions" @click.stop>
        <slot name="actions" />
      </span>
    </div>
    <slot />
    <SectionLabel v-if="inline" as="span">{{ label }}</SectionLabel>
    <InlineNote v-if="hint">{{ hint }}</InlineNote>
  </label>
</template>

<script setup lang="ts">
/**
 * A labelled control in a form.
 *
 * There was no primitive for this, and it shows: a dozen components each
 * declare their own `.field` / `label` / gap, which is how `SectionLabel`'s
 * eight drifted `.section-title` definitions happened one layer up. This is the
 * same consolidation for the layer below, applied to new code first so the
 * count stops growing; the existing dozen can move onto it a component at a
 * time without a flag day.
 *
 * Deliberately not a form *generator*. `EntityForm` already drives dialogs from
 * a field schema, and that shape does not survive contact with a work area
 * where fields appear conditionally and carry their own prose. This owns the
 * label and the spacing and nothing else, so the control stays written out
 * where a reader can see it.
 */
import SectionLabel from './SectionLabel.vue';
import InlineNote from './InlineNote.vue';

withDefaults(
  defineProps<{
    label: string;
    /** Explanation under the control. Prose that earns standing space. */
    hint?: string;
    /** Take the free space in a row — for the field that holds the long value. */
    grow?: boolean;
    /** Label after the control rather than above it, for checkboxes. */
    inline?: boolean;
  }>(),
  { hint: '', grow: false, inline: false },
);
</script>

<style scoped>
.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.form-field__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-width: 0;
}

.form-field__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}

.form-field--grow {
  flex: 1 1 var(--grid-6);
}

.form-field--inline {
  flex-direction: row;
  align-items: center;
  gap: var(--space-3);
}
</style>
