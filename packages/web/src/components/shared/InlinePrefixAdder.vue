<script setup lang="ts">
/**
 * InlinePrefixAdder — register a namespace as a prefix from the row that
 * showed you the IRI.
 *
 * A result table is where you find out a namespace is unabbreviated, and it
 * used to also be where that discovery ended: open the prefix manager, copy
 * the IRI, trim the local name off by hand, invent a prefix. This puts that
 * one action next to the IRI it applies to — the namespace is derived, the
 * prefix is proposed, and Enter commits.
 *
 * The trigger only renders for IRIs that would actually gain something (see
 * `splitIri`), so the affordance is absent rather than inert on the cells it
 * cannot help.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { usePrefixManager } from '@/composables/usePrefixManager';
import { isValidPrefixName, splitIri, suggestPrefix } from '@/lib/namespaceSuggestion';

const props = defineProps<{
  /** The full, unabbreviated IRI shown in the cell. */
  iri: string;
}>();

const emit = defineEmits<{
  added: [payload: { prefix: string; namespace: string }];
}>();

const { prefixSettings, addPrefix } = usePrefixManager();

const split = computed(() => splitIri(props.iri));
const namespace = computed(() => split.value?.namespace ?? '');

const isOpen = ref(false);
const draftPrefix = ref('');
const triggerEl = ref<HTMLButtonElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const popoverEl = ref<HTMLDivElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

const takenPrefixes = computed(() => prefixSettings.value.mappings.map((m) => m.prefix));

/** The mapping that already claims this namespace, if any. */
const existingForNamespace = computed(() =>
  prefixSettings.value.mappings.find((m) => m.namespace === namespace.value) ?? null,
);

const trimmedDraft = computed(() => draftPrefix.value.trim());

const formatError = computed(() => {
  if (trimmedDraft.value.length === 0) return 'Enter a prefix.';
  if (!isValidPrefixName(trimmedDraft.value)) {
    return 'Use a letter or underscore, then letters, digits, - or _.';
  }
  return null;
});

/** Non-blocking: the manager keeps duplicates and resolves them by specificity. */
const duplicateWarning = computed(() => {
  if (formatError.value) return null;
  const clash = prefixSettings.value.mappings.find(
    (m) => m.prefix === trimmedDraft.value && m.namespace !== namespace.value,
  );
  return clash ? `“${trimmedDraft.value}:” is already mapped to ${clash.namespace}` : null;
});

const canSubmit = computed(() => formatError.value === null);

function positionPopover() {
  const trigger = triggerEl.value;
  if (!trigger) return;

  const rect = trigger.getBoundingClientRect();
  const width = Math.min(440, Math.max(280, window.innerWidth - 24));
  // Right-align under the trigger, then clamp so the panel stays on screen.
  const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUpwards = spaceBelow < 190 && rect.top > spaceBelow;

  popoverStyle.value = openUpwards
    ? { left: `${left}px`, bottom: `${window.innerHeight - rect.top + 6}px`, width: `${width}px` }
    : { left: `${left}px`, top: `${rect.bottom + 6}px`, width: `${width}px` };
}

async function open() {
  if (!split.value) return;
  draftPrefix.value = existingForNamespace.value?.prefix
    ?? suggestPrefix(namespace.value, takenPrefixes.value);
  isOpen.value = true;
  await nextTick();
  positionPopover();
  inputEl.value?.focus();
  inputEl.value?.select();
}

function close() {
  isOpen.value = false;
  triggerEl.value?.focus();
}

function submit() {
  if (!canSubmit.value || !split.value) return;
  const prefix = trimmedDraft.value;
  const ns = namespace.value;

  addPrefix(prefix, ns, 'user-added');
  toast.success(`Added prefix ${prefix}: for ${ns}`);
  emit('added', { prefix, namespace: ns });
  isOpen.value = false;
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (popoverEl.value?.contains(target) || triggerEl.value?.contains(target)) return;
  isOpen.value = false;
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
  }
}

watch(isOpen, (open) => {
  if (typeof document === 'undefined') return;
  if (open) {
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onDocumentKeydown, true);
    window.addEventListener('resize', positionPopover);
    // Capture: the results table scrolls in its own container, not the window.
    window.addEventListener('scroll', positionPopover, true);
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    document.removeEventListener('keydown', onDocumentKeydown, true);
    window.removeEventListener('resize', positionPopover);
    window.removeEventListener('scroll', positionPopover, true);
  }
});

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return;
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
  window.removeEventListener('resize', positionPopover);
  window.removeEventListener('scroll', positionPopover, true);
});
</script>

<template>
  <span v-if="split" class="inline-prefix-adder">
    <button
      ref="triggerEl"
      type="button"
      class="prefix-trigger"
      :class="{ 'is-open': isOpen }"
      :title="`Add a prefix for ${namespace}`"
      :aria-expanded="isOpen"
      aria-haspopup="dialog"
      @click.stop="isOpen ? close() : open()"
    >
      + prefix
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="popoverEl"
        class="prefix-popover"
        role="dialog"
        aria-label="Add prefix"
        :style="popoverStyle"
        @click.stop
      >
        <p class="popover-label">Namespace</p>
        <p class="popover-namespace" :title="namespace">{{ namespace }}</p>

        <label class="popover-label" for="inline-prefix-input">Prefix</label>
        <div class="popover-row">
          <input
            id="inline-prefix-input"
            ref="inputEl"
            v-model="draftPrefix"
            class="popover-input"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :aria-invalid="formatError !== null"
            @keydown.enter.prevent="submit"
            @keydown.esc.prevent.stop="close"
          >
          <button type="button" class="popover-add" :disabled="!canSubmit" @click="submit">
            Add
          </button>
          <button type="button" class="popover-cancel" @click="close">
            Cancel
          </button>
        </div>

        <p v-if="formatError" class="popover-error">{{ formatError }}</p>
        <p v-else-if="duplicateWarning" class="popover-warning">{{ duplicateWarning }}</p>
        <p v-else-if="existingForNamespace" class="popover-warning">
          Already mapped as “{{ existingForNamespace.prefix }}:”
          <template v-if="!existingForNamespace.enabled">(disabled)</template>
        </p>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.inline-prefix-adder {
  display: inline-flex;
  align-items: center;
}

.prefix-trigger {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
  color: var(--action);
  font-size: var(--text-micro);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease;
}

/* Revealed on row hover too — but that rule cannot live in a scoped block; see
   the unscoped block at the end of this file. */
.prefix-trigger:focus-visible,
.prefix-trigger.is-open {
  opacity: 1;
}

/*
 * A pointer that cannot hover has no way to reach a hover-revealed control, so
 * on touch the button is simply present.
 */
@media (hover: none) {
  .prefix-trigger {
    opacity: 1;
  }
}

.prefix-trigger:hover,
.prefix-trigger.is-open {
  background: rgb(13 110 253 / 10%);
  border-color: var(--border-strong);
}

.prefix-popover {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}

.popover-label {
  margin: 0;
  font-size: var(--text-micro);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.popover-namespace {
  margin: 0 0 var(--space-4);
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--text-body);
  color: var(--ink-secondary);
}

.popover-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.popover-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-panel);
  background: transparent;
  font-family: var(--font-mono);
  font-size: var(--text-body);
  color: inherit;
}

.popover-input:focus-visible {
  outline: 2px solid var(--action);
  outline-offset: -1px;
}

.popover-input[aria-invalid="true"] {
  border-color: var(--danger);
}

.popover-add,
.popover-cancel {
  height: 32px;
  padding: 0 var(--space-5);
  border-radius: var(--radius-panel);
  font-size: var(--text-body);
  font-weight: 600;
  cursor: pointer;
}

.popover-add {
  border: 1px solid var(--action);
  background: var(--action);
  color: var(--action-fg);
}

.popover-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.popover-cancel {
  border: 1px solid var(--border-strong);
  background: transparent;
  color: inherit;
}

.popover-error,
.popover-warning {
  margin: 0;
  font-size: var(--text-micro);
}

.popover-error {
  color: var(--danger);
}

.popover-warning {
  color: var(--ink-muted);
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .prefix-popover {
  background: var(--gray-800);
  border-color: var(--border-hover);
}

.dark .prefix-trigger {
  background: transparent;
}

.dark .prefix-trigger:hover,
.dark .prefix-trigger.is-open {
  background: rgb(13 110 253 / 20%);
}
</style>

<!--
  The row-hover reveal, deliberately outside the scoped block.

  `tr` is rendered by DataTable, not by this component, so the ancestor half of
  the selector can never carry this component's scope attribute. Writing it as
  `:global(tr:hover) .prefix-trigger` inside `<style scoped>` looks like it says
  so, and does not: the SFC compiler rewrites that whole selector to a bare
  `tr:hover`, silently dropping the descendant. The rule then sets opacity on
  the row — a no-op — and the button stays invisible and unclickable forever,
  which is exactly what shipped.

  Unscoped, the selector means what it reads as. `.prefix-trigger` is unique to
  this component, so the global surface is one class this file owns.
-->
<style>
tr:hover .prefix-trigger {
  opacity: 1;
}
</style>
