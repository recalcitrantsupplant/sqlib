<template>
  <Dialog v-model:open="paletteOpen">
    <DialogContent class="palette" data-testid="command-palette">
      <DialogHeader class="sr-only">
        <DialogTitle>Command palette</DialogTitle>
        <DialogDescription>Search every action and destination.</DialogDescription>
      </DialogHeader>

      <div class="palette__search">
        <Search :size="14" class="palette__search-icon" aria-hidden="true" />
        <input
          ref="input"
          v-model="term"
          class="palette__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          :aria-activedescendant="activeId"
          placeholder="Search commands, queries and groups…"
          data-testid="command-palette-input"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="runActive()"
          @keydown.tab.prevent="move($event.shiftKey ? -1 : 1)"
        />
      </div>

      <ul v-if="matches.length > 0" id="command-palette-list" ref="list" class="palette__list" role="listbox">
        <template v-for="(entry, index) in matches" :key="entry.item.id">
          <li v-if="entry.heading" class="palette__heading" role="presentation">{{ entry.heading }}</li>
          <li
            :id="`command-option-${index}`"
            class="palette__row"
            :class="{ active: index === activeIndex }"
            role="option"
            :aria-selected="index === activeIndex"
            :data-testid="`command-palette-row-${entry.item.id}`"
            @mousemove="activeIndex = index"
            @click="run(entry.item)"
          >
            <span class="palette__title">
              <span
                v-for="(segment, i) in entry.segments"
                :key="i"
                :class="{ 'palette__match': segment.matched }"
              >{{ segment.text }}</span>
            </span>
            <kbd v-if="firstBinding(entry.item)" class="palette__keys">{{ firstBinding(entry.item) }}</kbd>
          </li>
        </template>
      </ul>

      <p v-else class="palette__empty">No command matches “{{ term }}”.</p>

      <footer class="palette__footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>Enter</kbd> run</span>
        <span><kbd>Esc</kbd> close</span>
        <button type="button" class="palette__help" @click="showShortcuts">All shortcuts</button>
      </footer>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * The palette: every command, searchable, whether or not it has a binding.
 *
 * This is what makes the registry worth having. Eleven destinations and a
 * couple of dozen actions cannot all be memorable chords, and the ones that
 * are still have to be discoverable — so the palette lists the same
 * declarations the dispatcher matches on, ranked by the same fuzzy filter the
 * rest of the app's choosers use (`lib/fuzzy.ts`).
 *
 * Providers (jump-to-query, jump-to-group) are asked once per opening rather
 * than watched: the list is a snapshot of the moment you opened it, which is
 * also what stops a background refresh from moving the row under your cursor.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { Search } from '@lucide/vue';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { fuzzyFilter, type MatchSegment } from '../lib/fuzzy';
import { formatBinding } from '../lib/keys';
import { useCommandPalette } from '../composables/useCommandPalette';
import { useCommandRegistry, type Command } from '../composables/useCommandRegistry';
import { useQueriesStore } from '../composables/useQueriesStore';
import { useQueryGroupsStore } from '../composables/useQueryGroupsStore';

const { paletteOpen, closePalette, toggleCheatSheet } = useCommandPalette();
const registry = useCommandRegistry();
const queriesStore = useQueriesStore();
const queryGroupsStore = useQueryGroupsStore();

const term = ref('');
const activeIndex = ref(0);
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
const snapshot = ref<Command[]>([]);

const searchable = (command: Command) => `${command.title} ${command.keywords ?? ''}`.trim();

interface Row {
  item: Command;
  segments: MatchSegment[];
  heading?: string;
}

const matches = computed<Row[]>(() => {
  const ranked = fuzzyFilter(term.value, snapshot.value, searchable);
  let lastGroup: string | null = null;
  return ranked.map(({ item, segments }) => {
    /*
     * Headings follow the ranking rather than bucketing it: a search reorders
     * across groups, and re-sorting into fixed sections would bury the best
     * match under a heading further down.
     */
    const heading = item.group === lastGroup ? undefined : item.group;
    lastGroup = item.group;
    // The label was searched with its keywords appended; only show the title.
    return { item, heading, segments: trimToTitle(segments, item.title.length) };
  });
});

/** Cut the highlight segments back to the visible title. */
function trimToTitle(segments: MatchSegment[], length: number): MatchSegment[] {
  const out: MatchSegment[] = [];
  let used = 0;
  for (const segment of segments) {
    if (used >= length) break;
    const text = segment.text.slice(0, length - used);
    used += text.length;
    if (text) out.push({ text, matched: segment.matched });
  }
  return out;
}

const activeId = computed(() => (matches.value.length > 0 ? `command-option-${activeIndex.value}` : undefined));

const firstBinding = (command: Command): string | null => {
  if (!command.keys) return null;
  const binding = Array.isArray(command.keys) ? command.keys[0] : command.keys;
  return binding ? formatBinding(binding) : null;
};

watch(paletteOpen, async (open) => {
  if (!open) return;
  term.value = '';
  activeIndex.value = 0;
  snapshot.value = registry.palette();
  /*
   * The jump-to lists come from stores the current screen may never have
   * loaded — the palette is reachable from /build, where no query list is on
   * screen. Fetching on open costs one request the first time and re-snapshots
   * when it lands, rather than showing a palette that is silently missing half
   * the library.
   */
  void Promise.all([
    queriesStore.queries.value.length === 0 ? queriesStore.loadQueries() : null,
    queryGroupsStore.queryGroups.value.length === 0 ? queryGroupsStore.loadQueryGroups() : null,
  ]).then(() => {
    if (paletteOpen.value) snapshot.value = registry.palette();
  }).catch(() => {
    // A failed list costs the jump-to rows, not the palette.
  });
  await nextTick();
  input.value?.focus();
});

watch(term, () => { activeIndex.value = 0; });

function move(delta: number): void {
  const count = matches.value.length;
  if (count === 0) return;
  activeIndex.value = (activeIndex.value + delta + count) % count;
  void nextTick(() => {
    list.value?.querySelector('.palette__row.active')?.scrollIntoView({ block: 'nearest' });
  });
}

function run(command: Command): void {
  closePalette();
  /*
   * Closing first: a command that moves focus (Focus the editor) or opens
   * another dialog would otherwise fight the palette's own focus restore.
   */
  void nextTick(() => { void command.run(); });
}

function runActive(): void {
  const entry = matches.value[activeIndex.value];
  if (entry) run(entry.item);
}

function showShortcuts(): void {
  closePalette();
  void nextTick(toggleCheatSheet);
}
</script>

<style scoped>
.palette {
  max-width: 620px;
  padding: 0;
  gap: 0;
  overflow: hidden;
}

.palette__search {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5);
  border-bottom: 1px solid var(--border);
}

.palette__search-icon {
  color: var(--muted-foreground);
  flex-shrink: 0;
}

.palette__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--text-content);
  color: var(--foreground);
}

.palette__list {
  max-height: 340px;
  overflow-y: auto;
  margin: 0;
  padding: var(--space-3);
  list-style: none;
}

.palette__heading {
  padding: var(--space-4) var(--space-4) var(--space-2);
  font-size: var(--text-micro);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

.palette__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-panel);
  font-size: var(--text-body-lg);
  cursor: pointer;
}

.palette__row.active {
  background: var(--accent);
  color: var(--accent-foreground);
}

.palette__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette__match {
  font-weight: 600;
  color: var(--primary);
}

.palette__row.active .palette__match {
  color: inherit;
  text-decoration: underline;
}

.palette__keys,
.palette__footer kbd {
  flex-shrink: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--muted);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--muted-foreground);
}

.palette__empty {
  padding: var(--space-7) var(--space-6);
  text-align: center;
  font-size: var(--text-body-lg);
  color: var(--muted-foreground);
}

.palette__footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border);
  font-size: var(--text-label);
  color: var(--muted-foreground);
}

.palette__footer kbd {
  margin-right: var(--space-1);
}

.palette__help {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--muted-foreground);
  font-size: var(--text-label);
  cursor: pointer;
}

.palette__help:hover {
  color: var(--foreground);
  text-decoration: underline;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
