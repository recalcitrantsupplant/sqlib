<template>
  <aside class="contents" aria-label="Contents" data-testid="notebook-contents">
    <div class="contents__head">
      <SectionLabel as="h2">Contents</SectionLabel>
      <div class="contents__controls">
        <SegmentedToggle
          v-if="tags.length > 0"
          :model-value="grouping"
          :options="GROUPINGS"
          group-label="Group contents by"
          @update:model-value="$emit('update:grouping', $event as Grouping)"
        />
        <!--
          The width the rail costs was going on a two-line description under
          every entry, which made long slugs wrap anyway. Compact keeps one line
          per entry and moves the description to the tooltip; the same control and
          the same stored preference as the section sidebars, because "how much
          do I want to see per row" is one answer, not one per screen.

          The kind badge keeps its whole word at both densities. The mockup had
          it shrink to a letter, and it is real width — but the rail's promise
          is that you can read what each entry returns without opening it, and
          `S` does not keep that promise (tests/e2e/library-page.spec.ts).
        -->
        <DensityToggle :model-value="density" @update:model-value="setEntityListDensity" />
      </div>
    </div>

    <div class="contents__filter">
      <Search :size="12" class="contents__filter-icon" />
      <input
        :value="search"
        type="search"
        class="contents__filter-input"
        placeholder="Filter"
        aria-label="Filter queries"
        @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <!--
      Every entry is listed, always. A filtered-out one dims rather than
      disappears, so the page never lies about what the library holds
      (design doc §2.7).
    -->
    <nav class="contents__list">
      <section v-for="group in groups" :key="group.key" class="group">
        <SectionLabel :count="group.entries.length">{{ group.label }}</SectionLabel>
        <a
          v-for="entry in group.entries"
          :key="entry.slug"
          class="entry"
          :class="{ 'entry--dimmed': !visible.has(entry.slug) }"
          :href="`#q-${entry.slug}`"
          :title="entry.query.description ?? undefined"
          :data-testid="`notebook-toc-${entry.slug}`"
        >
          <span class="entry__top">
            <span class="entry__name">{{ entry.slug }}</span>
            <Badge variant="secondary" class="entry__kind">{{ entry.query.queryType }}</Badge>
          </span>
          <span v-if="comfortable && entry.query.description" class="entry__desc">
            {{ entry.query.description }}
          </span>
        </a>
      </section>

      <!--
        Drafts sit at the foot of the contents rather than the foot of the page:
        "what this library holds that is not here" is a fact about the contents.
      -->
      <section v-if="skipped.length > 0" class="group">
        <SectionLabel>Not included</SectionLabel>
        <NuxtLink
          v-for="entry in skipped"
          :key="entry.id"
          class="entry entry--draft"
          :to="{ path: '/', query: { section: 'queries', item: entry.id } }"
          :title="entry.reason"
        >
          <span class="entry__name">{{ entry.name }}</span>
          <span class="entry__desc">{{ entry.reason }}</span>
        </NuxtLink>
      </section>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Search } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import DensityToggle from '@/components/shared/DensityToggle.vue';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import type { NotebookQuery } from '@/composables/useLibraryNotebook';
import { useSettings } from '@/composables/useSettings';
import type { DecoratedTag } from '@/lib/tagPalette';

/**
 * The library's table of contents, as a rail beside the document.
 *
 * A notebook's contents belong next to it, not above it: a library with thirty
 * queries has a contents list longer than the first cell, and stacked above the
 * document it becomes a page you scroll past rather than navigate with.
 */
export type Grouping = 'kind' | 'tag';

const props = defineProps<{
  queries: NotebookQuery[];
  /** Slugs that survive the current filters; the rest render dimmed. */
  visible: Set<string>;
  skipped: Array<{ id: string; name: string; reason: string }>;
  tags: DecoratedTag[];
  search: string;
  grouping: Grouping;
}>();

defineEmits<{
  (e: 'update:search', value: string): void;
  (e: 'update:grouping', value: Grouping): void;
}>();

const { settings, setEntityListDensity } = useSettings();
const density = computed(() => settings.value.entityListDensity);
const comfortable = computed(() => density.value === 'comfortable');

const GROUPINGS = [
  { value: 'kind', label: 'Kind' },
  { value: 'tag', label: 'Tag' },
] as const;

/**
 * What kind of *thing* an entry is, in the app's own vocabulary.
 *
 * Not the query's result form: SELECT/ASK/CONSTRUCT is what a query returns,
 * and it already rides on each entry as a badge. The rail groups by the kind of
 * artefact, the way the rest of the app's navigation does — so today a bundle
 * carries one group, and it grows a "Groups" and a "Rule sets" the moment the
 * bundle can carry them (#256).
 */
const KIND_LABELS: Record<string, string> = { query: 'Queries' };

interface Group {
  key: string;
  label: string;
  entries: NotebookQuery[];
}

const groups = computed<Group[]>(() =>
  props.grouping === 'tag' ? byTag() : byKind(),
);

function byKind(): Group[] {
  const buckets = new Map<string, NotebookQuery[]>();
  for (const entry of props.queries) {
    // Every entry in a bundle is a query today; the field is here so the
    // grouping does not have to be rewritten when that stops being true.
    const key = 'query';
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(entry);
  }
  return [...buckets.entries()].map(([key, entries]) => ({
    key,
    label: KIND_LABELS[key] ?? key,
    entries,
  }));
}

/**
 * A query with several tags appears under each of them, and one with none
 * lands in "Untagged" — the same rule the sidebar's tag grouping already uses,
 * so the two read the same way.
 */
function byTag(): Group[] {
  const names = new Map(props.tags.map((tag) => [tag.id, tag.name]));
  const buckets = new Map<string, NotebookQuery[]>();
  const untagged: NotebookQuery[] = [];

  for (const entry of props.queries) {
    const carried = (entry.query.tags ?? []).filter((id) => names.has(id));
    if (carried.length === 0) {
      untagged.push(entry);
      continue;
    }
    for (const id of carried) (buckets.get(id) ?? buckets.set(id, []).get(id)!).push(entry);
  }

  const groups = [...buckets.entries()]
    .map(([id, entries]) => ({ key: id, label: names.get(id) ?? id, entries }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (untagged.length > 0) groups.push({ key: '__untagged', label: 'Untagged', entries: untagged });
  return groups;
}
</script>

<style scoped>
.contents {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-default);
  background: var(--surface);
  overflow: hidden;
}

.contents__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-4) var(--space-3);
}

.contents__controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.contents__filter {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-sm, 24px);
  margin: 0 var(--space-4) var(--space-4);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  color: var(--ink-muted);
}

.contents__filter:focus-within { border-color: var(--action); }
.contents__filter-icon { flex-shrink: 0; }

.contents__filter-input {
  min-width: 0;
  flex: 1;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--text-label);
  outline: none;
}

.contents__list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-3) var(--space-6);
}

.group { margin-bottom: var(--space-5); }
.group > :first-child { padding: 0 var(--space-3); margin-bottom: var(--space-2); }

.entry {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: inherit;
  text-decoration: none;
}

.entry:hover { background: var(--surface-subtle); text-decoration: none; }

.entry--dimmed { opacity: 0.4; }

.entry__top { display: flex; align-items: center; gap: var(--space-2); }

.entry__name {
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
}

.entry__kind { font-size: var(--text-micro); }

.entry__desc {
  font-size: var(--text-micro);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry--draft .entry__name { font-weight: var(--weight-normal); color: var(--ink-muted); }
</style>
