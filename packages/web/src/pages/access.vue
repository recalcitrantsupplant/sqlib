<template>
  <div class="access-layout">
    <AppNavRail active-section="access" @select="handleRailSelect" />

    <p v-if="!auth.isAdmin.value" class="notice">Only administrators can manage access.</p>
    <template v-else>
      <AccessSidebar v-model:tab="tab" :selected="selectedId" @update:selected="select" />

      <main class="pane">
        <p v-if="access.loadError.value" class="notice">{{ access.loadError.value }}</p>
        <PrincipalAccessView
          v-else-if="tab === 'principals' && selectedPrincipal"
          :key="selectedPrincipal.iri"
          :principal="selectedPrincipal"
          @select="selectPrincipal"
          @open-backend="openBackend"
          @test-as="testAs"
        />
        <BackendAccessView
          v-else-if="tab === 'backends' && selectedBackend"
          ref="backendView"
          :backend="selectedBackend"
          @select="openBackend"
          @select-principal="selectPrincipal"
        />
        <div v-else-if="access.loaded.value" class="empty">
          <InlineNote>
            {{ tab === 'principals' ? 'Pick a person or a group to see and change what they may do.' : 'Pick a backend to see who may use it and which graphs they read.' }}
          </InlineNote>
        </div>
        <footer v-if="access.pendingCount.value > 0" class="save-row" data-testid="access-save-bar">
          <StatusBadge tone="warning">{{ access.pendingCount.value }} unsaved {{ access.pendingCount.value === 1 ? 'change' : 'changes' }}</StatusBadge>
          <span v-if="access.saveError.value" class="save-error">{{ access.saveError.value }}</span>
          <span class="save-spacer" />
          <button type="button" class="btn-compact" :disabled="access.saving.value" data-testid="access-discard" @click="access.discardDraft()">
            Discard
          </button>
          <button type="button" class="btn-compact btn-primary" :disabled="access.saving.value" data-testid="access-save" @click="access.saveDraft()">
            {{ access.saving.value ? 'Saving…' : 'Save' }}
          </button>
        </footer>
      </main>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * The Access screen: what each person and group may do, and, per backend,
 * who may use it and which graphs they read.
 *
 * Account level, like Backends, and for administrators only. The rail shows
 * it only to them; the page says so to anyone who reaches it by URL, and the
 * API refuses the calls either way.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from '#imports';
import AppNavRail from '@/components/AppNavRail.vue';
import AccessSidebar, { type AccessTab } from '@/components/access/AccessSidebar.vue';
import PrincipalAccessView from '@/components/access/PrincipalAccessView.vue';
import BackendAccessView from '@/components/access/BackendAccessView.vue';
import InlineNote from '@/components/shared/InlineNote.vue';
import StatusBadge from '@/components/shared/StatusBadge.vue';
import { createAccessData, provideAccessData } from '@/composables/useAccessData';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { useAuth } from '@/composables/useAuth';
import { EVERYONE, comparePrincipals } from '@/lib/accessModel';
import { isScreenSection, SCREEN_SECTION_PATHS, type RailSection } from '@/lib/railSections';

const router = useRouter();
const auth = useAuth();
const { activeLibraryId: libraryId } = useActiveLibrary();

const access = createAccessData();
provideAccessData(access);

const tab = ref<AccessTab>('principals');
const principalId = ref<string | null>(null);
const backendId = ref<string | null>(null);
const backendView = ref<InstanceType<typeof BackendAccessView> | null>(null);

const selectedId = computed(() => (tab.value === 'principals' ? principalId.value : backendId.value));
const selectedPrincipal = computed(() =>
  [EVERYONE, ...access.principals.value].find((p) => p.iri === principalId.value) ?? null);
const selectedBackend = computed(() => access.backends.value.find((b) => b.id === backendId.value) ?? null);

function select(id: string) {
  if (tab.value === 'principals') principalId.value = id;
  else backendId.value = id;
}

function selectPrincipal(iri: string) {
  tab.value = 'principals';
  principalId.value = iri;
}

function openBackend(id: string) {
  tab.value = 'backends';
  backendId.value = id;
}

/** Open `Test as` for a person on the backend most worth testing: one with a policy, if any. */
async function testAs(person: string) {
  const policed = access.backends.value.find((b) => !b.authBackend && b.graphPolicyQueryVersion);
  const target = selectedBackend.value && !selectedBackend.value.authBackend
    ? selectedBackend.value
    : policed ?? access.backends.value.find((b) => !b.authBackend);
  if (!target) return;
  openBackend(target.id);
  await nextTick();
  backendView.value?.testPerson(person);
}

onMounted(async () => {
  if (!auth.isAdmin.value) return;
  await access.load();
  const groups = access.principals.value.filter((p) => p.kind === 'group').sort(comparePrincipals);
  principalId.value = groups[0]?.iri ?? EVERYONE.iri;
  backendId.value = access.backends.value.find((b) => b.graphPolicyQueryVersion)?.id ?? access.backends.value[0]?.id ?? null;
});

function handleRailSelect(section: RailSection) {
  if (section === 'access') return;
  const query = libraryId.value ? { library: libraryId.value } : {};
  if (isScreenSection(section)) {
    router.push({ path: SCREEN_SECTION_PATHS[section], query });
    return;
  }
  router.push({ path: `/${section}`, query });
}
</script>

<style scoped>
.access-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--surface);
}

.pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
}

.save-row {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: auto;
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--border-default);
  background: var(--surface-subtle);
}

.save-error {
  color: var(--danger-ink);
  font-size: var(--text-body);
}

.save-spacer {
  flex: 1;
}

.empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
}

.notice {
  margin: 0;
  padding: var(--space-7) var(--space-6);
  color: var(--ink-muted);
  font-size: var(--text-body);
}
</style>
