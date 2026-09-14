<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <button
        class="run-tag-button"
        data-testid="tests-run-by-tag"
        :disabled="disabled || tags.length === 0"
        :title="tags.length === 0 ? 'No tags in this library yet' : 'Run the tests carrying chosen tags'"
      >
        <Tags :size="12" />
        <ChevronDown :size="11" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="run-tag-menu">
      <!--
        Run, match and the exports sit above the tags, not under them. The list
        is as long as the library has tags — 30 here — so a control below it is
        a control you have to scroll to find, twice: once to look for it and
        once to come back and change your mind.
      -->
      <div class="run-tag-head">
        <button
          class="run-tag-go"
          data-testid="tests-run-by-tag-go"
          :disabled="selected.length === 0 || busy"
          @click="run"
        >
          <Play :size="12" />
          {{ goLabel }}
        </button>

        <!--
          Only once a second tag is picked: with one tag the two modes select
          the same tests, and a control that cannot change the answer only
          invites a wrong guess about what it does.
        -->
        <template v-if="selected.length > 1">
          <div class="run-tag-match" role="group" aria-label="Which tests the tags select">
            <button
              v-for="mode in (['any', 'all'] as const)"
              :key="mode"
              class="run-tag-match-button"
              :class="{ active: match === mode }"
              :aria-pressed="match === mode"
              :data-testid="`run-tag-match-${mode}`"
              :title="MATCH_HINT[mode]"
              @click="match = mode"
            >
              {{ mode === 'any' ? 'Any of these tags' : 'All of these tags' }}
            </button>
          </div>
          <!--
            Said in words, because "any" and "all" are the two readings people
            swap by accident: one is a union and the other an intersection, and
            the count beside Run is the only other clue.
          -->
          <InlineNote size="xs">{{ MATCH_HINT[match] }}</InlineNote>
        </template>

        <!--
          The same run, kept rather than displayed. Inline rather than behind a
          second trigger because a menu inside a menu is a place people do not
          look — and this is the selection the formats apply to.
        -->
        <div v-if="selected.length > 0" class="run-tag-export" role="group" aria-label="Run and download">
          <span class="run-tag-export-head">Run and download as</span>
          <div class="run-tag-export-row">
            <button
              v-for="format in TEST_REPORT_FORMATS"
              :key="format.id"
              type="button"
              class="run-tag-export-item"
              :data-testid="`tests-export-${format.id}`"
              :disabled="busy"
              :title="format.hint"
              @click="exportRun(format)"
            >
              <Download :size="12" />
              <span>{{ format.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <DropdownMenuSeparator />

      <!--
        Plain buttons rather than menu items: picking tags is a multi-choice,
        and a menu item selects and dismisses. The row carries the checkbox role
        itself so it still reads as one to a screen reader.

        Only this list scrolls, so the controls above it stay put however many
        tags the library has.
      -->
      <div class="run-tag-list">
      <button
        v-for="tag in tags"
        :key="tag.id"
        type="button"
        role="menuitemcheckbox"
        class="run-tag-item"
        :aria-checked="selected.includes(tag.id)"
        :data-testid="`run-tag-${tag.id}`"
        @click="toggle(tag.id)"
      >
        <Check :size="12" :class="['run-tag-check', { hidden: !selected.includes(tag.id) }]" />
        <TagDot :color="tag.color" size="heading" />
        <span class="run-tag-name">{{ tag.name }}</span>
        <span class="run-tag-count">{{ countFor(tag.id) }}</span>
      </button>
      </div>

    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
/**
 * Run the tests carrying one or more tags.
 *
 * Sitting beside Run all, and answering the question Run all cannot: a library
 * of 205 conformance tests is only worth running whole when you have all
 * afternoon, and "the negation ones" is the run you actually want after
 * touching negation. Grouping by tag already puts a run button on each heading;
 * this is the same run when you want *two* tags, or when you are not grouped by
 * tag at all.
 *
 * The tags are picked here and the *selection* is made by the server
 * (`POST /tests/run`), so what runs is what the tag holds now rather than what
 * this list happened to be showing.
 */
import { computed, ref, watch } from 'vue';
import { Check, ChevronDown, Download, Play, Tags } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import TagDot from '../tags/TagDot.vue';
import InlineNote from '../shared/InlineNote.vue';
import { TEST_REPORT_FORMATS, type TestReportFormat } from '../../lib/testReportFormats';
import type { TagMatchMode } from '../../composables/useApiClient';

/** The two readings of a multi-tag selection, said in full. */
const MATCH_HINT: Record<'any' | 'all', string> = {
  any: 'Runs a test that carries at least one of the chosen tags.',
  all: 'Runs only tests that carry every chosen tag.',
};

export interface RunByTagOption {
  id: string;
  name: string;
  color?: string | null;
  /** How many tests in the list carry it, for the count beside the name. */
  count: number;
}

const props = withDefaults(defineProps<{
  tags: RunByTagOption[];
  /** True while any run is in flight, whoever started it. */
  busy?: boolean;
  disabled?: boolean;
}>(), { busy: false, disabled: false });

const emit = defineEmits<{
  run: [tagIds: string[], match: TagMatchMode];
  /** Run the same selection and save the report rather than showing it. */
  export: [tagIds: string[], match: TagMatchMode, format: TestReportFormat];
}>();

const open = ref(false);
const selected = ref<string[]>([]);
const match = ref<TagMatchMode>('any');

// A tag deleted or renamed out from under the picker must not stay selected —
// running it would ask the server for an IRI that no longer resolves.
watch(
  () => props.tags.map((tag) => tag.id).join(','),
  () => {
    const live = new Set(props.tags.map((tag) => tag.id));
    selected.value = selected.value.filter((id) => live.has(id));
  },
);

const countFor = (id: string) => props.tags.find((tag) => tag.id === id)?.count ?? 0;

/**
 * How many tests the current pick covers.
 *
 * Under `all` the per-tag counts cannot be added or intersected without the
 * membership itself, so the label says how many tags rather than guessing a
 * number the run would then contradict.
 */
const goLabel = computed(() => {
  if (selected.value.length === 0) return 'Run tagged';
  if (props.busy) return 'Running…';
  if (match.value === 'all') return `Run tests with all ${selected.value.length} tags`;
  const total = selected.value.reduce((sum, id) => sum + countFor(id), 0);
  return `Run ${total} test${total === 1 ? '' : 's'}`;
});

function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id];
}

function run() {
  if (selected.value.length === 0) return;
  open.value = false;
  emit('run', [...selected.value], match.value);
}

function exportRun(format: TestReportFormat) {
  if (selected.value.length === 0) return;
  open.value = false;
  emit('export', [...selected.value], match.value, format);
}
</script>

<style scoped>
.run-tag-button {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  cursor: pointer;
}

.run-tag-button:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--border-strong);
}

.run-tag-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.run-tag-menu {
  display: flex;
  flex-direction: column;
  min-width: var(--grid-8);
  max-height: 60vh;
  overflow: hidden;
}

.run-tag-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex-shrink: 0;
  padding: var(--space-2);
}

.run-tag-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: var(--space-2);
}

.run-tag-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: var(--space-1) var(--space-4);
  border: none;
  background: none;
  color: var(--ink);
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}

.run-tag-item:hover {
  background: var(--surface-subtle);
}

.run-tag-check.hidden {
  visibility: hidden;
}

.run-tag-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-tag-count {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
}

.run-tag-match {
  display: flex;
  gap: var(--space-2);
}

.run-tag-match-button {
  flex: 1;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  cursor: pointer;
}

.run-tag-match-button.active {
  color: var(--ink);
  border-color: var(--border-strong);
}

/* The menu's primary action, and now the first thing in it. */
.run-tag-go {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  width: 100%;
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--action);
  border-radius: var(--radius-sm);
  background: var(--action);
  color: var(--action-fg);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.run-tag-go:hover:not(:disabled) {
  background: var(--action-hover);
}

.run-tag-go:disabled {
  opacity: 0.5;
  cursor: default;
}

.run-tag-export {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.run-tag-export-head {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.run-tag-export-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* Five formats as chips: a wrapped row fits the head, a column would not. */
.run-tag-export-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-size: var(--text-micro);
  cursor: pointer;
}

.run-tag-export-item:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--border-strong);
}

.run-tag-export-item:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
