<template>
  <section class="activity" data-testid="library-activity">
    <div class="filters">
      <SegmentedToggle v-model="filter" :options="filterOptions" group-label="Show" />
      <SearchSelect
        v-model="actor"
        class="person-filter"
        :options="personOptions"
        empty-label="Anyone"
        placeholder="Anyone"
        test-id="activity-person"
      />
    </div>

    <p v-if="error" class="error" data-testid="activity-error">{{ error }}</p>

    <EmptyState v-else-if="!loading && !items.length" size="sm" title="No activity" />

    <section v-for="day in days" :key="day.key" class="day">
      <SectionLabel as="h3" class="day-label">{{ day.label }}</SectionLabel>
      <ul class="list">
        <li v-for="item in day.items" :key="item.id" class="row" :data-testid="`activity-${item.kind}`">
          <span class="who">
            <PersonChip v-if="item.actor" :iri="item.actor" />
          </span>
          <span class="what">
            <span class="verb">{{ verbOf(item) }}</span>
            <component :is="item.kind === 'deleted' ? 's' : 'span'" class="name">{{ item.entityName ?? item.entity }}</component>
            <template v-if="item.kind === 'moved'">
              <span class="verb">in</span>
              <span class="chip">{{ item.environmentName ?? item.environment }}</span>
              <span class="chip">{{ versionLabel(item.fromVersionNumber) }}</span>
              <ArrowRight :size="12" class="arrow" aria-hidden="true" />
              <span class="chip">{{ versionLabel(item.toVersionNumber) }}</span>
            </template>
            <span v-else-if="item.kind === 'saved'" class="chip">{{ versionLabel(item.versionNumber) }}</span>
            <span v-else class="kind">{{ ENTITY_KIND_LABELS[item.entityType] ?? item.entityType }}</span>
          </span>
          <time class="when" :datetime="item.at" :title="formatDateTime(item.at)">{{ timeOfDay(item.at) }}</time>
        </li>
      </ul>
    </section>

    <button
      v-if="next"
      type="button"
      class="btn-compact more"
      :disabled="loading"
      data-testid="activity-more"
      @click="load(false)"
    >
      Show more
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowRight } from '@lucide/vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import PersonChip from '@/components/shared/PersonChip.vue';
import SearchSelect from '@/components/shared/SearchSelect.vue';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import { useApiClient, type LibraryActivityFilter, type LibraryActivityItem } from '@/composables/useApiClient';
import { useAuth } from '@/composables/useAuth';
import { usePrincipalNames } from '@/composables/usePrincipalNames';
import { ACTIVITY_VERBS, ENTITY_KIND_LABELS, groupByDay, timeOfDay } from '@/lib/libraryActivity';
import { formatDateTime } from '@/lib/time';

const props = defineProps<{ libraryId: string }>();

const PAGE = 50;

const api = useApiClient();
const auth = useAuth();
const names = usePrincipalNames();

const filter = ref<'all' | LibraryActivityFilter>('all');
const actor = ref<string | null>(null);
const items = ref<LibraryActivityItem[]>([]);
const next = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
/** Everyone seen in this library's feed, so the person filter keeps them while it narrows. */
const seen = ref<Set<string>>(new Set());

const filterOptions = [
  { value: 'all', label: 'All', testId: 'activity-filter-all' },
  { value: 'moved', label: 'Moves', testId: 'activity-filter-moved' },
  { value: 'edited', label: 'Edits', testId: 'activity-filter-edited' },
  { value: 'created', label: 'Created', testId: 'activity-filter-created' },
  { value: 'deleted', label: 'Deleted', testId: 'activity-filter-deleted' },
];

const personOptions = computed(() => [...seen.value]
  .map((iri) => ({
    value: iri,
    label: auth.me.value?.subject === iri ? 'You' : names.nameOf(iri) ?? 'Unknown',
  }))
  .sort((a, b) => a.label.localeCompare(b.label)));

const days = computed(() => groupByDay(items.value));

/** With no person before it, the verb opens the row and takes a capital. */
function verbOf(item: LibraryActivityItem): string {
  const verb = ACTIVITY_VERBS[item.kind];
  return item.actor ? verb : verb.charAt(0).toUpperCase() + verb.slice(1);
}

function versionLabel(number: number | null | undefined): string {
  return typeof number === 'number' ? `v${number}` : '—';
}

let request = 0;

async function load(reset: boolean) {
  const mine = ++request;
  loading.value = true;
  error.value = null;
  try {
    const page = await api.listLibraryActivity(props.libraryId, {
      kind: filter.value === 'all' ? undefined : filter.value,
      actor: actor.value ?? undefined,
      before: reset ? undefined : next.value ?? undefined,
      limit: PAGE,
    });
    if (mine !== request) return;
    items.value = reset ? page.items : [...items.value, ...page.items];
    next.value = page.next ?? null;
    const people = new Set(seen.value);
    for (const item of page.items) if (item.actor) people.add(item.actor);
    seen.value = people;
  } catch (cause) {
    if (mine !== request) return;
    const record = cause as { data?: { error?: string }; message?: string };
    error.value = record?.data?.error ?? record?.message ?? 'The activity could not be loaded';
  } finally {
    if (mine === request) loading.value = false;
  }
}

watch(() => props.libraryId, () => {
  seen.value = new Set();
  void load(true);
}, { immediate: true });
watch([filter, actor], () => { void load(true); });
</script>

<style scoped>
.activity {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 880px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.person-filter {
  width: 200px;
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}

.day {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.day-label {
  margin: 0;
}

.list {
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: var(--grid-unit);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-body);
}

.row:last-child {
  border-bottom: none;
}

.who {
  display: inline-flex;
  flex-shrink: 0;
  min-width: 120px;
}

.what {
  display: inline-flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.verb {
  color: var(--ink-muted);
}

.name {
  overflow: hidden;
  color: var(--ink);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

s.name {
  color: var(--ink-muted);
}

.kind {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.chip {
  display: inline-flex;
  align-items: center;
  height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-body);
  font-variant-numeric: tabular-nums;
}

.arrow {
  color: var(--ink-muted);
}

.when {
  flex-shrink: 0;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.more {
  align-self: flex-start;
}
</style>
