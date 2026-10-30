<template>
  <aside class="access-sidebar" data-testid="access-sidebar">
    <TabStrip
      :model-value="tab"
      :tabs="tabs"
      group-label="Access by"
      variant="sidebar"
      @update:model-value="(value) => emit('update:tab', value as AccessTab)"
    />
    <div class="filter-bar">
      <FilterBox
        v-model="filter"
        :placeholder="tab === 'principals' ? 'Filter people and groups' : 'Filter backends'"
        test-id="access-filter"
      />
    </div>

    <nav class="entity-list" :aria-label="tab === 'principals' ? 'People and groups' : 'Backends'">
      <template v-if="tab === 'principals'">
        <template v-for="section in principalSections" :key="section.label">
          <div v-if="section.label" class="section-bar">
            <SectionLabel as="span" size="sm" :count="section.rows.length">{{ section.label }}</SectionLabel>
          </div>
          <button
            v-for="principal in section.rows"
            :key="principal.iri"
            type="button"
            :class="['entity-row', { selected: principal.iri === selected }]"
            :aria-current="principal.iri === selected ? 'true' : undefined"
            :data-testid="`principal-${principal.kind}`"
            @click="emit('update:selected', principal.iri)"
          >
            <component :is="iconOf(principal.kind)" :size="13" class="entity-icon" />
            <span class="entity-name">{{ principalName(principal) }}</span>
            <StatusBadge v-if="admins.has(principal.iri)" tone="warning" size="xs">admin</StatusBadge>
            <span v-else class="entity-meta" :title="`${grantCount(principal.iri)} grants`">{{ grantCount(principal.iri) }}</span>
          </button>
        </template>
      </template>

      <template v-else>
        <button
          v-for="backend in visibleBackends"
          :key="backend.id"
          type="button"
          :class="['entity-row', { selected: backend.id === selected }]"
          :aria-current="backend.id === selected ? 'true' : undefined"
          data-testid="access-backend-row"
          @click="emit('update:selected', backend.id)"
        >
          <Server :size="13" class="entity-icon" />
          <span class="entity-name">{{ backend.name }}</span>
          <StatusBadge v-if="backend.authBackend" tone="warning" size="xs">auth</StatusBadge>
          <StatusBadge v-else-if="backend.graphPolicyQueryVersion" tone="action" size="xs">policy</StatusBadge>
          <span v-else class="entity-meta">all graphs</span>
        </button>
      </template>
    </nav>

    <InlineNote v-if="tab === 'principals'" size="xs" class="foot-note">
      People and groups appear after their first sign-in. Manage membership in your identity provider.
    </InlineNote>
  </aside>
</template>

<script setup lang="ts">
/**
 * The Access screen's list: people and groups on one tab, backends on the
 * other. Groups come first, because most grants should go to groups.
 */
import { computed, ref } from 'vue';
import { Bot, Globe, Server, User, Users } from '@lucide/vue';
import type { PrincipalRecord } from '@/composables/useApiClient';
import { useAccessData } from '@/composables/useAccessData';
import { EVERYONE, comparePrincipals, isAdminGrant, principalName } from '@/lib/accessModel';
import TabStrip from '@/components/shared/TabStrip.vue';
import FilterBox from '@/components/shared/FilterBox.vue';
import StatusBadge from '@/components/shared/StatusBadge.vue';
import InlineNote from '@/components/shared/InlineNote.vue';
import SectionLabel from '@/components/shared/SectionLabel.vue';

export type AccessTab = 'principals' | 'backends';

defineProps<{ tab: AccessTab; selected: string | null }>();
const emit = defineEmits<{
  (e: 'update:tab', value: AccessTab): void;
  (e: 'update:selected', value: string): void;
}>();

const access = useAccessData();
const filter = ref('');

const tabs = computed(() => [
  { value: 'principals', label: 'People & groups', count: access.principals.value.length + 1, testId: 'access-tab-principals' },
  { value: 'backends', label: 'Backends', count: access.backends.value.length, testId: 'access-tab-backends' },
]);

const admins = computed(() => new Set(access.grants.value.filter(isAdminGrant).map((grant) => grant.principal)));

function matches(text: string): boolean {
  const needle = filter.value.trim().toLowerCase();
  return !needle || text.toLowerCase().includes(needle);
}

const principalSections = computed(() => {
  const rows = [EVERYONE, ...access.principals.value].filter((p) => matches(principalName(p)) || matches(p.rawClaim)).sort(comparePrincipals);
  const of = (kind: string) => rows.filter((p) => p.kind === kind);
  return [
    { label: '', rows: of('everyone') },
    { label: 'Groups', rows: of('group') },
    { label: 'People', rows: of('user') },
    { label: 'Applications', rows: of('client') },
  ].filter((section) => section.rows.length > 0);
});

const visibleBackends = computed(() =>
  [...access.backends.value].filter((b) => matches(b.name)).sort((a, b) => a.name.localeCompare(b.name)));

function grantCount(principal: string): number {
  return access.grantsOf(principal).filter((grant) => grant.resourceKind !== 'everything').length;
}

function iconOf(kind: PrincipalRecord['kind']) {
  return { everyone: Globe, group: Users, user: User, client: Bot }[kind] ?? User;
}
</script>

<style scoped>
.access-sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 288px;
  min-height: 0;
  border-right: 1px solid var(--border-default);
  background: var(--surface-subtle);
}

.filter-bar {
  display: flex;
  padding: var(--space-4);
}

.filter-bar :deep(.filter-box) {
  flex: 1;
}

.entity-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0 var(--space-3) var(--space-4);
  overflow-y: auto;
}

.section-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-4) var(--space-2);
}

.entity-row {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  height: 26px;
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.entity-row:hover {
  background: var(--surface-sunken);
}

.entity-row.selected {
  background: var(--action-surface);
  color: var(--action-ink);
}

.entity-icon {
  flex-shrink: 0;
}

.entity-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-secondary);
  font-size: var(--text-content);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entity-row.selected .entity-name {
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
}

.entity-meta {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.foot-note {
  padding: var(--space-4) var(--space-5);
}
</style>
