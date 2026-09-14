<template>
  <!--
    The library switcher lives at the head of the nav rail (option 1a of
    docs/design mock "Library Switcher Options"). The rail is the only surface
    that is already global, and a library reparents Groups, Rules, Tests, Data
    and Backends all at once — so putting the control above everything makes
    the spatial claim exactly right: everything below belongs to the thing
    above. It used to sit over the Groups list, where it read as a filter on
    that one list.

    The workspace mark is the control rather than a decoration beside it: the
    initial is the current library, and the name is one hover or one click away.
  -->
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        class="library-mark"
        type="button"
        data-testid="library-switcher"
        :title="`Library — ${activeLibraryName}`"
        :aria-label="`Library — ${activeLibraryName}`"
      >
        <span class="mark" aria-hidden="true">{{ initial }}</span>
        <span class="mark-label">
          Library<ChevronsUpDown :size="9" class="mark-chevron" />
        </span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="right" :side-offset="6" class="library-menu">
      <DropdownMenuLabel class="library-menu-heading">Libraries</DropdownMenuLabel>
      <DropdownMenuItem
        v-for="library in libraries"
        :key="library.id"
        class="library-menu-item"
        :data-testid="`library-option-${library.id}`"
        @select="setActiveLibrary(library.id)"
      >
        <span class="option-mark" aria-hidden="true">{{ initialOf(library.name) }}</span>
        <span class="option-text">
          <span class="option-name">{{ library.name }}</span>
          <span v-if="library.description" class="option-meta">{{ library.description }}</span>
        </span>
        <Check :size="12" :class="['option-check', { hidden: library.id !== activeLibraryId }]" />
      </DropdownMenuItem>
      <DropdownMenuItem v-if="libraries.length === 0" disabled>No libraries</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { Check, ChevronsUpDown } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useActiveLibrary } from '../composables/useActiveLibrary';

const { libraries, activeLibraryId, activeLibraryName, setActiveLibrary, ensureLoaded } =
  useActiveLibrary();

function initialOf(name: string | null | undefined): string {
  return (name ?? '').trim().charAt(0).toUpperCase() || 'S';
}

/* The mark keeps the app's own letter until there is a library to name. */
const initial = computed(() => (libraries.value.length ? initialOf(activeLibraryName.value) : 'S'));

onMounted(() => {
  void ensureLoaded();
});
</script>

<style scoped>
.library-mark {
  width: 44px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  margin-bottom: var(--space-4);
  padding: var(--space-1) 0;
  border: 1px solid transparent;
  border-radius: var(--radius-panel);
  background: transparent;
  font-family: inherit;
  cursor: pointer;
}

.library-mark:hover,
.library-mark[data-state='open'] {
  border-color: var(--border-default);
  background: var(--surface-subtle);
}

.mark {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-panel);
  background: var(--brand-mark);
  color: var(--brand-mark-ink);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
}

.mark-label {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  line-height: 1;
}

.mark-chevron {
  flex-shrink: 0;
}

.library-menu {
  min-width: 232px;
}

.library-menu-heading {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.library-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.option-mark {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
}

.option-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.option-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.option-meta {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: var(--text-micro);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.option-check {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--action);
}

.option-check.hidden {
  visibility: hidden;
}
</style>
