<template>
  <div class="record" data-testid="person-activity-view">
    <header class="record-header">
      <span class="record-name">{{ principalName(person) }}</span>
      <StatusBadge v-if="active" tone="success" data-testid="person-active">Active</StatusBadge>
      <span
        v-else-if="lastSeen"
        class="record-sub"
        :title="formatDateTime(lastSeen)"
        data-testid="person-last-seen"
      >Last active {{ formatRelativeTime(lastSeen) }}</span>
      <span v-if="person.seenAt" class="record-sub" :title="formatDateTime(person.seenAt)">
        First signed in {{ formatDayMonth(person.seenAt) }}
      </span>
      <div class="header-actions">
        <button type="button" class="btn-compact" data-testid="person-open-access" @click="emit('open-access', person.iri)">
          Access
        </button>
      </div>
    </header>

    <div class="record-body">
      <section class="block">
        <SectionLabel as="h3">Recent changes</SectionLabel>
        <p v-if="error" class="error" data-testid="person-activity-error">{{ error }}</p>
        <EmptyState v-else-if="!loading && !items.length" size="sm" title="No changes" />
        <section v-for="day in days" :key="day.key" class="day">
          <SectionLabel as="h4" size="sm">{{ day.label }}</SectionLabel>
          <ul class="list">
            <li v-for="item in day.items" :key="item.id" class="row" :data-testid="`person-activity-${item.kind}`">
              <span class="what">
                <span class="verb">{{ capitalised(ACTIVITY_VERBS[item.kind]) }}</span>
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
              <span v-if="item.library" class="library" :title="item.library">
                <Library :size="12" aria-hidden="true" />
                {{ item.libraryName ?? item.library }}
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
          data-testid="person-activity-more"
          @click="load(false)"
        >
          Show more
        </button>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One person, for administrators: when they were last active, and what they
 * created, changed, moved and deleted in every library, newest first.
 */
import { computed, ref, watch } from 'vue';
import { ArrowRight, Library } from '@lucide/vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import StatusBadge from '@/components/shared/StatusBadge.vue';
import { useApiClient, type LibraryActivityItem, type PrincipalRecord } from '@/composables/useApiClient';
import { isActiveNow, lastSeenOf, principalName } from '@/lib/accessModel';
import { ACTIVITY_VERBS, ENTITY_KIND_LABELS, groupByDay, timeOfDay } from '@/lib/libraryActivity';
import { formatDateTime, formatDayMonth, formatRelativeTime } from '@/lib/time';

const props = defineProps<{ person: PrincipalRecord }>();
const emit = defineEmits<{ (e: 'open-access', iri: string): void }>();

const PAGE = 30;
const api = useApiClient();

const items = ref<LibraryActivityItem[]>([]);
const next = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const lastSeen = computed(() => lastSeenOf(props.person));
const active = computed(() => isActiveNow(props.person));
const days = computed(() => groupByDay(items.value));

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
    const page = await api.listPersonActivity(props.person.iri, {
      before: reset ? undefined : next.value ?? undefined,
      limit: PAGE,
    });
    if (mine !== request) return;
    items.value = reset ? page.items : [...items.value, ...page.items];
    next.value = page.next ?? null;
  } catch (cause) {
    if (mine !== request) return;
    const record = cause as { data?: { error?: string }; message?: string };
    error.value = record?.data?.error ?? record?.message ?? 'The changes could not be loaded';
  } finally {
    if (mine === request) loading.value = false;
  }
}

watch(() => props.person.iri, () => { void load(true); }, { immediate: true });
</script>

<style scoped>
.record {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  color: var(--ink);
  font-size: var(--text-body);
  line-height: 1.5;
}

.record-header {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  min-height: 48px;
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--border-subtle);
}

.record-name {
  color: var(--ink);
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
}

.record-sub {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

.record-body {
  padding: var(--space-7) var(--space-6) var(--space-8);
  overflow-y: auto;
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  max-width: 880px;
}

.day {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
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
  border-bottom: 0;
}

.what {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.verb,
.kind {
  color: var(--ink-muted);
}

.name {
  color: var(--ink);
  font-weight: var(--weight-medium);
}

.chip {
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--ink-secondary);
  font-size: var(--text-label);
}

.arrow {
  color: var(--ink-muted);
}

.library {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
  max-width: 200px;
  overflow: hidden;
  color: var(--ink-secondary);
  font-size: var(--text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.when {
  flex-shrink: 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
}

.more {
  align-self: flex-start;
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}
</style>
