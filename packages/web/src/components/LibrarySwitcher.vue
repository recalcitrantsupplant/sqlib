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
  <div class="library-head">
    <!--
      The mark goes home, the label switches library.

      They were one button, which made the app's own mark a menu trigger and
      left the splash reachable only by unpicking whatever section was open.
      Splitting them is the conventional reading of both halves: the mark is
      where you are, the chevron is what you can change.
    -->
    <button
      class="mark-button"
      type="button"
      data-testid="library-home"
      title="Home"
      aria-label="Home"
      @click="emit('home')"
    >
      <span class="mark" aria-hidden="true">{{ initial }}</span>
    </button>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          class="switcher-button"
          type="button"
          data-testid="library-switcher"
          :title="`Library — ${activeLibraryName}`"
          :aria-label="`Library — ${activeLibraryName}`"
        >
          Library<ChevronsUpDown :size="9" class="mark-chevron" />
        </button>
      </DropdownMenuTrigger>
    <!--
      Width in utilities rather than in the scoped block below: the menu is
      teleported, so it carries this component's class but not its scope
      attribute, and a scoped rule never reaches it. The cap is the point —
      a menu sized to its content stretched across the window on one library
      with a paragraph for a description.
    -->
    <DropdownMenuContent
      align="start"
      side="right"
      :side-offset="6"
      class="library-menu min-w-[232px] max-w-[320px]"
    >
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

      <!--
        The menu that names the libraries is where the next one is made, and
        since the tree went it is the only route to one.

        Absent rather than disabled on a read-only deployment: `POST
        /libraries` is refused there, so the row would be an offer of a 405.
      -->
      <template v-if="!isReadOnly">
      <DropdownMenuSeparator />
      <DropdownMenuItem
        class="library-menu-item library-menu-new"
        data-testid="library-create"
        @select="emit('create-library')"
      >
        <span class="option-mark" aria-hidden="true"><Plus :size="12" /></span>
        <span class="option-text">
          <span class="option-name">New library</span>
        </span>
      </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { Check, ChevronsUpDown, Plus } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useDeploymentMode } from '../composables/useDeploymentMode';

const emit = defineEmits<{
  (e: 'create-library'): void;
  /** The mark was clicked: go to the splash, whatever page we are on. */
  (e: 'home'): void;
}>();

const { libraries, activeLibraryId, activeLibraryName, setActiveLibrary, ensureLoaded } =
  useActiveLibrary();
const { isReadOnly, ensureLoaded: ensureDeploymentMode } = useDeploymentMode();

function initialOf(name: string | null | undefined): string {
  return (name ?? '').trim().charAt(0).toUpperCase() || 'S';
}

/* The mark keeps the app's own letter until there is a library to name. */
const initial = computed(() => (libraries.value.length ? initialOf(activeLibraryName.value) : 'S'));

onMounted(() => {
  void ensureLoaded();
  void ensureDeploymentMode();
});
</script>

<style scoped>
.library-head {
  width: 44px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  margin-bottom: var(--space-4);
}

.mark-button,
.switcher-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-panel);
  background: transparent;
  font-family: inherit;
  cursor: pointer;
}

.mark-button:hover,
.mark-button:focus-visible,
.switcher-button:hover,
.switcher-button:focus-visible,
.switcher-button[data-state='open'] {
  border-color: var(--border-default);
  background: var(--surface-subtle);
}

.switcher-button {
  gap: 1px;
  padding: var(--space-1);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  line-height: 1;
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

.mark-chevron {
  flex-shrink: 0;
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

.library-menu-new .option-mark {
  color: var(--ink-muted);
}
</style>
