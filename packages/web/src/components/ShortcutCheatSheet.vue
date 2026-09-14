<template>
  <Dialog v-model:open="cheatSheetOpen">
    <DialogContent class="sheet" data-testid="shortcut-cheat-sheet">
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          Press <kbd>{{ paletteBinding }}</kbd> for everything else — every action is in the palette,
          bound or not.
        </DialogDescription>
      </DialogHeader>

      <div class="sheet__body">
        <section v-for="section in sections" :key="section.group" class="sheet__group">
          <h3 class="sheet__heading">{{ section.group }}</h3>
          <dl class="sheet__rows">
            <template v-for="command in section.commands" :key="command.id">
              <dt class="sheet__label" :class="{ 'sheet__label--off': !applies(command) }">
                {{ command.title }}
              </dt>
              <dd class="sheet__keys">
                <kbd v-for="binding in bindings(command)" :key="binding">{{ binding }}</kbd>
              </dd>
            </template>
          </dl>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * The bound commands, grouped, generated from the registry.
 *
 * Nothing here is a maintained list — a hand-written cheat sheet is out of date
 * the first time someone changes a binding, and this one cannot be. It shows
 * only commands that have keys; the rest are the palette's job.
 *
 * Registered-but-inapplicable commands are shown greyed rather than hidden:
 * "Run the query — Ctrl+Enter" is worth knowing about while you are looking at
 * the list of queries, even though it does nothing until one is open.
 */
import { computed } from 'vue';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { formatBinding } from '../lib/keys';
import { useCommandPalette } from '../composables/useCommandPalette';
import { useCommandRegistry, isAvailable, COMMAND_GROUPS, type Command } from '../composables/useCommandRegistry';

const { cheatSheetOpen } = useCommandPalette();
const registry = useCommandRegistry();

const bindings = (command: Command): string[] => {
  const keys = command.keys ? (Array.isArray(command.keys) ? command.keys : [command.keys]) : [];
  return keys.map((binding) => formatBinding(binding));
};

/** Re-read per render so the sheet greys out with the screen behind it. */
const applies = (command: Command): boolean => isAvailable(command);

const paletteBinding = computed(() => formatBinding('Mod+k'));

const sections = computed(() => {
  const bound = registry.all.value.filter((command) => command.keys);
  return COMMAND_GROUPS
    .map((group) => ({ group, commands: bound.filter((command) => command.group === group) }))
    .filter((section) => section.commands.length > 0);
});
</script>

<style scoped>
.sheet {
  max-width: 640px;
}

.sheet__body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px 28px;
  max-height: 60vh;
  overflow-y: auto;
  padding-top: var(--space-2);
}

.sheet__heading {
  margin: 0 0 var(--space-3);
  font-size: var(--text-micro);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

.sheet__rows {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 4px 12px;
  margin: 0;
}

.sheet__label {
  font-size: var(--text-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet__label--off {
  color: var(--muted-foreground);
}

.sheet__keys {
  display: flex;
  gap: 4px;
  margin: 0;
  justify-content: flex-end;
}

kbd {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--muted);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--muted-foreground);
  white-space: nowrap;
}
</style>
