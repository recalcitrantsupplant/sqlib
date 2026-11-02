<template>
  <section class="chain-section" data-testid="environment-chain">
    <header class="section-head">
      <SectionLabel as="h2">Environments</SectionLabel>
      <span class="count">{{ environments.length }}</span>
      <span class="spacer" />
      <button
        v-if="canControl && environments.length > 0"
        type="button"
        class="btn-compact"
        data-testid="environment-add"
        @click="emit('add')"
      >
        <Plus :size="13" /> Add environment
      </button>
    </header>

    <!-- A library with none: one line and the presets that make a chain. -->
    <div v-if="environments.length === 0" class="setup" data-testid="environment-setup">
      <p class="setup-line">No environments yet.</p>
      <template v-if="canControl">
        <div class="setup-row">
          <SegmentedToggle v-model="preset" :options="PRESETS" group-label="Environments" size="default" />
          <SegmentedToggle v-model="setupStart" :options="SETUP_STARTS" group-label="Start with" size="default" />
          <button type="button" class="btn-compact btn-primary" :disabled="busy" data-testid="environment-setup-create" @click="setUp">
            {{ setupLabel }}
          </button>
        </div>
      </template>
    </div>

    <ol v-else class="chain">
      <li class="card card-latest" data-testid="environment-card-latest">
        <span class="card-name" title="The current version of everything">latest</span>
        <dl class="facts">
          <dt>Holds</dt><dd>{{ total }} of {{ total }}</dd>
        </dl>
      </li>
      <li
        v-for="(env, index) in environments"
        :key="env.id"
        class="card"
        :data-testid="`environment-card-${env.name}`"
      >
        <ArrowRight :size="14" class="arrow" aria-hidden="true" />
        <div class="card-head">
          <span class="card-name">{{ env.name }}</span>
          <span class="spacer" />
          <DropdownMenu v-if="canControl">
            <DropdownMenuTrigger as-child>
              <button type="button" class="icon-button" :title="`Edit ${env.name}`" :data-testid="`environment-menu-${env.name}`">
                <MoreHorizontal :size="14" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem :data-testid="`environment-edit-${env.name}`" @select="emit('edit', env)">Edit…</DropdownMenuItem>
              <DropdownMenuItem :disabled="index === 0" @select="emit('move', env, -1)">Move left</DropdownMenuItem>
              <DropdownMenuItem :disabled="index === environments.length - 1" @select="emit('move', env, 1)">Move right</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="danger" :data-testid="`environment-delete-${env.name}`" @select="emit('delete', env)">Delete…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <dl class="facts">
          <dt>Holds</dt>
          <dd>
            {{ holds(env.id) }} of {{ total }}<template v-if="behind(env.id) > 0"> · <span class="behind">{{ behind(env.id) }} behind</span></template>
          </dd>
          <template v-if="backendName(env.defaultBackend)">
            <dt>Backend</dt><dd :title="backendName(env.defaultBackend) ?? ''">{{ backendName(env.defaultBackend) }}</dd>
          </template>
          <template v-if="(holders[env.id]?.promote ?? []).length">
            <dt>Promote</dt><dd :title="holders[env.id].promote.join(', ')">{{ holders[env.id].promote.join(', ') }}</dd>
          </template>
          <template v-if="(holders[env.id]?.execute ?? []).length">
            <dt>Run</dt><dd :title="holders[env.id].execute.join(', ')">{{ holders[env.id].execute.join(', ') }}</dd>
          </template>
        </dl>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRight, MoreHorizontal, Plus } from '@lucide/vue';
import type { Backend, Environment } from '@sparql-query-lib/contracts';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { holdsCount, type BoardRow } from '@/lib/environmentBoard';

const props = defineProps<{
  environments: readonly Environment[];
  rows: readonly BoardRow[];
  backends: readonly Backend[];
  canControl: boolean;
  /** Names of who may promote to, and run in, each environment, when the caller may read grants. */
  holders: Record<string, { promote: string[]; execute: string[] }>;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: 'add'): void;
  (e: 'edit', env: Environment): void;
  (e: 'move', env: Environment, by: -1 | 1): void;
  (e: 'delete', env: Environment): void;
  (e: 'setup', names: string[], startFrom: string): void;
}>();

const PRESETS = [
  { value: 'dev,test,prod', label: 'dev → test → prod', testId: 'preset-three' },
  { value: 'dev,prod', label: 'dev → prod', testId: 'preset-two' },
  { value: 'prod', label: 'prod', testId: 'preset-one' },
] as const;

const SETUP_STARTS = [
  { value: 'latest', label: 'Current versions', title: 'Each environment starts with the current version of everything' },
  { value: 'empty', label: 'Empty' },
] as const;

const preset = ref<string>(PRESETS[0].value);
const setupStart = ref<string>('latest');

const setupLabel = computed(() => {
  const count = preset.value.split(',').length;
  return count === 1 ? 'Create environment' : `Create ${count} environments`;
});

function setUp() {
  emit('setup', preset.value.split(','), setupStart.value);
}

const total = computed(() => props.rows.filter((row) => !row.entity.groupOnly).length);

function holds(environment: string): number {
  return holdsCount(props.rows.filter((row) => !row.entity.groupOnly), environment);
}

function behind(environment: string): number {
  return props.rows.filter((row) =>
    row.cells.some((cell) => cell.environment === environment && cell.state === 'behind')).length;
}

function backendName(id: string | null | undefined): string | null {
  if (!id) return null;
  return props.backends.find((backend) => backend.id === id)?.name ?? null;
}
</script>

<style scoped>
.chain-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.section-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.count {
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-size: var(--text-micro);
}

.spacer {
  flex: 1;
}

.setup {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
}

.setup-line {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-body);
}

.setup-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.chain {
  display: flex;
  gap: var(--space-7);
  margin: 0;
  padding: 0 0 var(--space-2);
  overflow-x: auto;
  list-style: none;
}

.card {
  position: relative;
  display: flex;
  flex: 0 0 220px;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.card-latest {
  border-style: dashed;
  background: transparent;
}

.arrow {
  position: absolute;
  top: var(--space-5);
  left: calc(-1 * var(--space-6));
  color: var(--ink-muted);
}

.card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.card-name {
  color: var(--ink);
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
}

.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-4);
  margin: 0;
  font-size: var(--text-label);
}

.facts dt {
  color: var(--ink-muted);
}

.facts dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ink-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.behind {
  color: var(--warning-ink);
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.icon-button:hover {
  background: var(--surface-subtle);
  color: var(--ink-secondary);
}

.danger {
  color: var(--danger-ink);
}
</style>
