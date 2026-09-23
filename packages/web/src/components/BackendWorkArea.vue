<template>
  <div class="backend-work-area" data-testid="backend-work-area">
    <!-- ===================== Draft (creation) ===================== -->
    <template v-if="draft">
      <div class="record-header">
        <span class="record-name record-name--draft">{{ draftForm.name || 'Untitled backend' }}</span>
        <StatusBadge tone="warning" :dot="false">Unsaved</StatusBadge>
        <div class="header-actions">
          <button class="button" data-testid="discard-backend" @click="emit('discard-draft')">Discard</button>
          <button
            class="button button--primary"
            :disabled="!canCreate || creating"
            data-testid="create-backend"
            @click="createBackend"
          >
            {{ creating ? 'Creating…' : 'Create backend' }}
          </button>
        </div>
      </div>

      <div class="record-body">
        <div class="record-column">
          <p v-if="createError" class="form-error" role="alert" data-testid="backend-create-error">{{ createError }}</p>

          <div class="form-grid">
            <label class="form-label" for="backend-draft-name">Name <span class="required">*</span></label>
            <input
              id="backend-draft-name"
              ref="draftNameInput"
              v-model="draftForm.name"
              type="text"
              class="form-input"
              placeholder="My backend"
              data-testid="backend-draft-name"
            />

            <span class="form-label">Type</span>
            <div class="method-choice">
              <label
                v-for="kind in availableBackendKinds"
                :key="kind.value"
                class="method-option"
                :class="{ active: draftForm.kind === kind.value }"
              >
                <input
                  v-model="draftForm.kind"
                  type="radio"
                  name="draft-backend-kind"
                  :value="kind.value"
                  :data-testid="`backend-kind-${kind.value}`"
                />
                <span>{{ kind.label }}</span>
              </label>
            </div>

            <template v-if="draftForm.kind === 'http' || draftForm.kind === 'browser'">
              <label class="form-label" for="backend-draft-endpoint">Endpoint URL <span class="required">*</span></label>
              <div class="form-stack">
                <input
                  id="backend-draft-endpoint"
                  v-model="draftForm.endpoint"
                  type="url"
                  class="form-input form-input--mono"
                  :class="{ 'form-input--invalid': draftEndpointError }"
                  placeholder="http://localhost:7878/sparql"
                  data-testid="backend-draft-endpoint"
                />
                <InlineNote v-if="draftEndpointError" as="span" tone="danger">{{ draftEndpointError }}</InlineNote>
              </div>
            </template>

            <label class="form-label form-label--top" for="backend-draft-description">Description</label>
            <textarea
              id="backend-draft-description"
              v-model="draftForm.description"
              class="form-input form-input--textarea"
              placeholder="Optional"
              rows="2"
            />

            <!--
              Query method belongs to both kinds that have an endpoint. The
              environment key does not: a browser backend's credentials stay in
              the browser, so there are no `SQLIB_BACKEND_*` variables for the
              server to read.
            -->
            <template v-if="draftForm.kind === 'http' || draftForm.kind === 'browser'">
              <span class="form-label">Query method</span>
              <div class="method-choice">
                <label v-for="method in QUERY_METHODS" :key="method.value" class="method-option" :class="{ active: draftForm.queryMethod === method.value }">
                  <input v-model="draftForm.queryMethod" type="radio" name="draft-query-method" :value="method.value" />
                  <span>{{ method.label }}</span>
                </label>
              </div>
            </template>

            <template v-if="draftForm.kind === 'http'">
              <label class="form-label form-label--top" for="backend-draft-env-key">Environment key</label>
              <div class="form-stack">
                <input
                  id="backend-draft-env-key"
                  v-model="draftEnvKeyModel"
                  type="text"
                  class="form-input form-input--mono"
                  placeholder="generated from the name"
                  data-testid="backend-draft-env-key"
                />
                <InlineNote as="span">
                  Letters, numbers and underscores. Determines the <code>SQLIB_BACKEND_*</code> variables.
                </InlineNote>
              </div>
            </template>

            <template v-else-if="draftForm.kind === 'oxigraphMemory'">
              <span class="form-label form-label--top">Mode</span>
              <div class="mode-choice">
                <label
                  v-for="mode in MEMORY_STORE_MODES"
                  :key="mode.value"
                  class="mode-option"
                  :class="{ active: draftMode === mode.value }"
                >
                  <input
                    v-model="draftMode"
                    type="radio"
                    name="draft-store-mode"
                    :value="mode.value"
                    :data-testid="`store-mode-${mode.value}`"
                  />
                  <span class="mode-text">
                    <span class="mode-name">{{ mode.label }}</span>
                    <InlineNote as="span">{{ mode.hint }}</InlineNote>
                  </span>
                </label>
              </div>

              <span class="form-label form-label--top">Data graphs</span>
              <MemorySourcesEditor :sources="draftSources" @change="onDraftSourcesChange" />
            </template>
          </div>

          <div v-if="draftForm.kind === 'browser'" class="note-card" data-testid="browser-backend-note">
            <Activity :size="14" />
            <span>
              This backend is registered in your browser only. Queries run directly from your browser to
              this endpoint, so the address, any headers you add and the results never reach the sqlib
              server. It will still be here when you come back, and clearing your browser data removes it.
            </span>
          </div>
          <div v-else-if="draftForm.kind === 'oxigraphMemory'" class="note-card">
            <Activity :size="14" />
            <span>
              The store lives inside the server and is hydrated from the data graphs above.
              Tracked graphs keep it in sync — saving a new version rebuilds the store; pinned versions
              never change. Nothing is ever written back to a data graph.
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- ===================== Saved record ===================== -->
    <template v-else-if="backend">
      <div class="record-header">
        <span class="record-name" data-testid="backend-record-name">{{ backend.name }}</span>
        <StatusBadge :tone="HEALTH_TONES[health]" data-testid="backend-health-pill">
          {{ HEALTH_LABELS[health] }}
        </StatusBadge>
        <span class="probe-summary" data-testid="backend-probe-summary">{{ probeSummary }}</span>
        <div class="header-actions">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button class="button button--icon" title="More" aria-label="More actions" data-testid="backend-overflow">
                <MoreHorizontal :size="14" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @select="copyId">Copy backend ID</DropdownMenuItem>
              <DropdownMenuItem data-testid="delete-backend" @select="emit('delete-request', { backendId: backend.id, backendName: backend.name })">
                Delete backend
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <!--
        Wide enough and the pane splits: settings stay in their column and
        everything *observed* rather than edited moves to the sidecar. Narrow,
        and the sidecar drops underneath. Widening the settings column instead
        would only stretch the endpoint field, and a 1900px endpoint field is
        worse than a short one.
      -->
      <div class="record-body">
        <div class="record-split">
          <div class="record-column">
            <!-- 1. Identity -->
            <section class="record-section">
              <h2 class="backend-section-label">Identity</h2>
              <div class="field-grid">
                <span class="field-name">Name</span>
                <InlineField
                  :model-value="backend.name"
                  label="Name"
                  test-id="backend-field-name"
                  :readonly="!canEdit"
                  :commit="(value) => commitField('name', value)"
                />

                <span class="field-name field-name--top">Description</span>
                <InlineField
                  :model-value="backend.description ?? ''"
                  label="Description"
                  test-id="backend-field-description"
                  empty-text="No description"
                  multiline
                  :readonly="!canEdit"
                  :commit="(value) => commitField('description', value)"
                />
              </div>
            </section>

            <!-- 2a. Store — in-process backends have no connection to describe;
                 what they have is a lifecycle and a set of hydration sources. -->
            <section v-if="!isHttp" class="record-section" data-testid="backend-store-section">
              <h2 class="backend-section-label">
                Store
                <InfoHint label="store">
                  An in-process Oxigraph store hydrated from library data graphs. Tracked graphs rebuild
                  it when a new version is saved; pinned versions never change. Nothing is written back.
                </InfoHint>
              </h2>
              <div class="field-grid">
                <span class="field-name">Type</span>
                <div class="field-value">
                  <span class="product-chip" data-testid="backend-store-type">
                    {{ backend.backendType === 'oxigraphMemory' ? 'In-memory Oxigraph' : 'Ephemeral Oxigraph (scratch)' }}
                  </span>
                </div>

                <template v-if="backend.backendType === 'oxigraphMemory'">
                  <span class="field-name">
                    Mode
                    <InfoHint label="store mode">
                      Read-only stores refuse writes and rebuild from their data graphs. Ephemeral stores
                      accept writes and lose them on restart. Durable stores are seeded once, then their
                      own saved state is the truth.
                    </InfoHint>
                  </span>
                  <div class="field-value">
                    <div class="segmented" role="group" aria-label="Store mode">
                      <button
                        v-for="mode in MEMORY_STORE_MODES"
                        :key="mode.value"
                        class="segment"
                        :class="{ active: memoryConfig.mode === mode.value }"
                        :aria-pressed="memoryConfig.mode === mode.value"
                        :disabled="!canEdit"
                        :title="mode.hint"
                        :data-testid="`store-mode-${mode.value}`"
                        @click="commitStoreMode(mode.value)"
                      >
                        {{ mode.label }}
                      </button>
                    </div>
                  </div>
                </template>

                <span class="field-name">Reported product</span>
                <div class="field-value">
                  <span class="product-chip" data-testid="backend-product">{{ probe?.product ?? 'Not reported' }}</span>
                </div>
              </div>

              <template v-if="backend.backendType === 'oxigraphMemory'">
                <span class="field-name">Data graphs</span>
                <MemorySourcesEditor
                  :sources="memoryConfig.sources"
                  :disabled="!canEdit"
                  @change="commitSources"
                />
              </template>
            </section>

            <!-- 2b. Connection -->
            <section v-if="isHttp" class="record-section">
              <h2 class="backend-section-label">Connection</h2>
              <div class="field-grid">
                <span class="field-name">Endpoint URL</span>
                <div class="field-with-actions">
                  <InlineField
                    :model-value="backend.endpoint ?? ''"
                    label="Endpoint URL"
                    test-id="backend-field-endpoint"
                    empty-text="No endpoint"
                    mono
                    :readonly="!canEdit"
                    :commit="(value) => commitField('endpoint', value)"
                  />
                  <button class="icon-button" title="Copy endpoint" aria-label="Copy endpoint" @click="copyEndpoint">
                    <Copy :size="12" />
                  </button>
                  <a
                    v-if="backend.endpoint"
                    class="icon-button"
                    :href="backend.endpoint"
                    target="_blank"
                    rel="noreferrer"
                    title="Open endpoint"
                    aria-label="Open endpoint"
                  >
                    <ExternalLink :size="12" />
                  </a>
                </div>

                <span class="field-name">
                  Query method
                  <InfoHint label="query method">
                    POST is the standard. Use GET only for endpoints with SSL or query-size limits.
                  </InfoHint>
                </span>
                <div class="field-value">
                  <div class="segmented" role="group" aria-label="Query method">
                    <button
                      v-for="method in QUERY_METHODS"
                      :key="method.value"
                      class="segment"
                      :class="{ active: (backend.queryMethod ?? 'post') === method.value }"
                      :aria-pressed="(backend.queryMethod ?? 'post') === method.value"
                      :disabled="!canEdit"
                      :data-testid="`query-method-${method.value}`"
                      @click="commitQueryMethod(method.value)"
                    >
                      {{ method.value.toUpperCase() }}
                    </button>
                  </div>
                </div>

                <span class="field-name">
                  Reported product
                  <InfoHint label="reported product">
                    Read from the service description on probe. It sets the dialect used in benchmarks.
                  </InfoHint>
                </span>
                <div class="field-value">
                  <span class="product-chip" data-testid="backend-product">{{ probe?.product ?? 'Not reported' }}</span>
                </div>
              </div>
            </section>

            <!-- 3. Authentication — HTTP only: an in-process store has no wire to authenticate on. -->
            <section v-if="isHttp" class="record-section">
              <h2 class="backend-section-label">
                Authentication
                <InfoHint label="authentication">
                  sqlib reads these from the environment of the machine running the query. Values never
                  leave it — this page only ever says whether one is set.
                </InfoHint>
              </h2>
              <div class="field-grid">
                <span class="field-name">
                  Environment key
                  <InfoHint label="environment key">
                    Renaming orphans any <code>SQLIB_BACKEND_*</code> variables already set on the runner.
                  </InfoHint>
                </span>
                <InlineField
                  :model-value="backend.authEnvKey ?? ''"
                  label="Environment key"
                  test-id="backend-field-env-key"
                  empty-text="Not set"
                  mono
                  :readonly="!canEdit"
                  :commit="requestEnvKeyChange"
                />
              </div>

              <div class="env-table" data-testid="backend-env-table">
                <InlineNote v-if="envLoading" class="env-message">Reading the runner…</InlineNote>
                <InlineNote v-else-if="envError" tone="danger" class="env-message">{{ envError }}</InlineNote>
                <InlineNote v-else-if="envVariables.length === 0" class="env-message">
                  No environment key, so this backend reads no credentials.
                </InlineNote>
                <div v-for="variable in envVariables" :key="variable.name" class="env-row">
                  <Check v-if="variable.set" :size="13" class="env-icon env-icon--set" />
                  <Minus v-else :size="13" class="env-icon" />
                  <span class="env-name">{{ variable.name }}</span>
                  <StatusBadge
                    class="env-state"
                    size="xs"
                    :dot="false"
                    :tone="variable.set ? 'success' : 'neutral'"
                  >{{ variable.set ? 'set' : 'not set' }}</StatusBadge>
                  <button class="icon-button" :title="`Copy ${variable.name}`" :aria-label="`Copy ${variable.name}`" @click="copyText(variable.name, 'Variable name copied')">
                    <Copy :size="12" />
                  </button>
                </div>
              </div>
            </section>
          </div>

          <!-- The sidecar: observed, not edited. -->
          <aside class="record-sidecar" data-testid="backend-sidecar">
            <section class="sidecar-card" :class="`sidecar-card--${health}`" data-testid="backend-health-card">
              <div class="card-head">
                <component :is="HEALTH_ICONS[health]" :size="14" class="health-icon" />
                <span class="health-name">{{ HEALTH_LABELS[health] }}</span>
                <span class="health-when">{{ probe ? relativeTime(probe.probedAt) : 'not yet' }}</span>
              </div>
              <p class="health-message" data-testid="backend-health-message">{{ healthMessage }}</p>
              <div class="card-actions">
                <button class="button" :disabled="testing" data-testid="test-connection" @click="testConnection">
                  <Activity :size="13" />{{ testing ? 'Testing…' : 'Test again' }}
                </button>
                <button
                  class="button"
                  :aria-expanded="historyOpen"
                  data-testid="probe-history"
                  @click="toggleHistory"
                >
                  Probe history
                </button>
              </div>
              <ol v-if="historyOpen" class="probe-history" data-testid="probe-history-list">
                <li v-for="(entry, index) in probeHistory" :key="`${entry.probedAt}-${index}`" class="history-row">
                  <span class="history-dot" :class="`history-dot--${entry.health}`" aria-hidden="true" />
                  <span class="history-when">{{ relativeTime(entry.probedAt) }}</span>
                  <span class="history-detail">{{ entry.error ?? `${entry.latencyMs} ms` }}</span>
                </li>
                <InlineNote v-if="probeHistory.length === 0" as="li">
                  Nothing probed yet this server run.
                </InlineNote>
              </ol>
            </section>

            <section class="sidecar-card">
              <h2 class="backend-section-label">
                Attached libraries
                <InfoHint label="attached libraries">
                  Attaching points a library at this backend as its default. Members can run queries
                  against it; they cannot see the endpoint URL or change it.
                </InfoHint>
              </h2>
              <p v-if="attachedLibraries.length === 0" class="card-empty">None attached.</p>
              <div v-else class="chip-row">
                <span v-for="library in attachedLibraries" :key="library.id" class="chip" data-testid="attached-library">
                  {{ library.name }}
                  <button
                    v-if="canEdit"
                    class="chip-remove"
                    :title="`Detach ${library.name}`"
                    :aria-label="`Detach ${library.name}`"
                    @click="requestDetach(library)"
                  >
                    <X :size="12" />
                  </button>
                </span>
              </div>
              <DropdownMenu v-if="canEdit">
                <DropdownMenuTrigger as-child>
                  <button class="attach-button" data-testid="attach-library"><Plus :size="12" />Attach a library</button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    v-for="library in attachableLibraries"
                    :key="library.id"
                    @select="attachLibrary(library)"
                  >
                    {{ library.name }}
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="attachableLibraries.length === 0" disabled>
                    Every library is attached
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </section>

            <section class="sidecar-card">
              <h2 class="backend-section-label">
                Used by
                <InfoHint label="used by">
                  Counted across every library. Rule sets are absent because nothing in a rule set names
                  a backend — it borrows one at execution time.
                </InfoHint>
              </h2>
              <button
                v-for="row in usageRows"
                :key="row.section"
                class="usage-row"
                :class="{ 'usage-row--empty': row.count === 0 }"
                :disabled="row.count === 0"
                :title="row.title"
                data-testid="usage-row"
                @click="emit('open-usage', row.section)"
              >
                <span class="usage-label">{{ row.label }}</span>
                <span class="usage-count">{{ row.count }}</span>
                <ChevronRight :size="13" class="usage-chevron" />
              </button>
            </section>
          </aside>
        </div>
      </div>
    </template>

    <div v-else class="record-empty">
      <p v-if="loadError" class="form-error">{{ loadError }}</p>
      <p v-else-if="loading">Loading backend…</p>
      <p v-else>Select a backend, or add one with +.</p>
    </div>

    <AlertDialog v-model:open="envKeyConfirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rename the environment key?</AlertDialogTitle>
          <AlertDialogDescription>
            <div>sqlib will stop reading:</div>
            <ul class="confirm-list">
              <li v-for="name in oldVariableNames" :key="name"><code>{{ name }}</code></li>
            </ul>
            <div>and start reading:</div>
            <ul class="confirm-list">
              <li v-for="name in newVariableNames" :key="name"><code>{{ name }}</code></li>
            </ul>
            <div>Anything already set on the runner under the old names is orphaned by this rename.</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="cancelEnvKeyChange">Cancel</AlertDialogCancel>
          <AlertDialogAction data-testid="confirm-env-key-rename" @click="confirmEnvKeyChange">Rename</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="detachConfirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Detach “{{ detachTarget?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {{ detachWarning }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it attached</AlertDialogCancel>
          <AlertDialogAction data-testid="confirm-detach-library" @click="confirmDetach">Detach</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Copy,
  ExternalLink,
  Minus,
  MoreHorizontal,
  Plus,
  X,
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import type { Backend, Library } from '@sparql-query-lib/contracts';
import {
  buildBackendAuthEnvVarNames,
  deriveAuthEnvKeyFromName,
  normalizeAuthEnvKey,
} from '@sparql-query-lib/types';
import InlineField from './backends/InlineField.vue';
import InlineNote from './shared/InlineNote.vue';
import MemorySourcesEditor from './backends/MemorySourcesEditor.vue';
import InfoHint from './shared/InfoHint.vue';
import StatusBadge from './shared/StatusBadge.vue';
import {
  MEMORY_STORE_MODES,
  parseMemoryConfig,
  serializeMemoryConfig,
  type MemoryStoreMode,
  type MemoryStoreSource,
} from '../lib/memoryBackendConfig';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { useApiClient, type BackendEnv, type BackendProbe, type BackendUsage } from '../composables/useApiClient';
import { useBackendProbes } from '../composables/useBackendProbes';
import { useBackendsStore } from '../composables/useBackendsStore';
import { isBrowserBackendId, useBrowserBackends } from '../composables/useBrowserBackends';
import { useDeploymentMode } from '../composables/useDeploymentMode';
import { useLibrariesStore } from '../composables/useLibrariesStore';
import { useCopyToClipboard } from '../composables/useCopyToClipboard';

/**
 * A backend, read as a page and edited field by field.
 *
 * There is no form mode and no page-level Save: every field commits on its own,
 * which is why the header carries state (health, probe) rather than actions.
 * Creation is the one exception — a draft has nothing to commit against yet, so
 * it is a small form with one `Create backend` button (backends UI doc §Creation).
 */
const props = withDefaults(
  defineProps<{
    backendId: string | null;
    /** True while an unsaved backend is being filled in. */
    draft: boolean;
    /** Library members see name and health only (doc §Rules). */
    canEdit?: boolean;
  }>(),
  // Vue casts an absent boolean prop to false, so the owner default has to be
  // written down or every field renders read-only.
  { canEdit: true },
);

const emit = defineEmits<{
  (e: 'created', backend: Backend): void;
  (e: 'discard-draft'): void;
  (e: 'draft-name', name: string): void;
  (e: 'delete-request', payload: { backendId: string; backendName: string }): void;
  /** A Used by row was followed — the rail section that lists that kind. */
  (e: 'open-usage', section: 'queries' | 'queryGroups' | 'benchmarks'): void;
}>();

const QUERY_METHODS = [
  { value: 'post' as const, label: 'POST (recommended)' },
  { value: 'get' as const, label: 'GET (for compatibility)' },
];

const BACKEND_KINDS = [
  { value: 'http' as const, label: 'HTTP endpoint' },
  { value: 'oxigraphMemory' as const, label: 'In-memory (Oxigraph)' },
  /*
   * Not a backend type the server knows: a browser backend is an HTTP endpoint
   * kept in this browser's storage instead of sqlib's. It sits beside the other
   * two because from where a visitor stands it is the same choice — where do my
   * queries go — and because on a read-only deployment it is the only one of
   * the three they can make.
   */
  { value: 'browser' as const, label: 'Browser only' },
];

const HEALTH_LABELS = {
  healthy: 'Healthy',
  slow: 'Slow',
  unreachable: 'Unreachable',
  never_probed: 'Never probed',
} as const;

/*
 * The four health words against the four token families. "Slow" is warning
 * rather than `StatusBadge`'s `stale`, and that distinction is why the badge
 * takes a tone here: a slow backend answered late, a stale thing is out of
 * date, and they share a colour without sharing a meaning.
 */
const HEALTH_TONES = {
  healthy: 'success',
  slow: 'warning',
  unreachable: 'danger',
  never_probed: 'neutral',
} as const;

const HEALTH_ICONS = {
  healthy: CircleCheck,
  slow: AlertTriangle,
  unreachable: AlertTriangle,
  never_probed: CircleHelp,
} as const;

/*
 * Only for the wording of the slow message. The server owns the real threshold
 * (SQLIB_BACKEND_SLOW_MS) and the classification that matters; this is the
 * number to say out loud when it has already decided something is slow.
 */
const SLOW_MARK_MS = 250;

const client = useApiClient();
const backendsStore = useBackendsStore();
const browserBackends = useBrowserBackends();
const deployment = useDeploymentMode();
void deployment.ensureLoaded();

/**
 * A read-only deployment refuses `POST /backends`, so offering the two
 * server-side kinds would be offering a 405. The browser kind is the one a
 * visitor can actually complete, and on such a deployment it is the point.
 */
const availableBackendKinds = computed(() =>
  deployment.isReadOnly.value
    ? BACKEND_KINDS.filter(kind => kind.value === 'browser')
    : BACKEND_KINDS
);
const librariesStore = useLibrariesStore();
const probes = useBackendProbes();
const { copyToClipboard } = useCopyToClipboard();

const canEdit = computed(() => props.canEdit);

const backend = ref<Backend | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const testing = ref(false);

const env = ref<BackendEnv | null>(null);
const envLoading = ref(false);
const envError = ref<string | null>(null);
const usage = ref<BackendUsage | null>(null);
const probeHistory = ref<BackendProbe[]>([]);
const historyOpen = ref(false);

const probe = computed(() => probes.probeFor(backend.value?.id));
const health = computed(() => probes.healthFor(backend.value?.id));

const isHttp = computed(() => backend.value?.backendType === 'http');

/** The stored oxigraphConfig, read for display and rebuilt on every commit. */
const memoryConfig = computed(() => parseMemoryConfig(backend.value?.oxigraphConfig));

/** The header's one line: when, and the shortest true reason. */
const probeSummary = computed(() => {
  const result = probe.value;
  if (!result) return 'never probed — run Test again';
  const when = relativeTime(result.probedAt);
  if (result.health === 'unreachable') return `${when} · ${result.error ?? 'no answer'}`;
  return `${when} · ${result.latencyMs} ms`;
});

/**
 * The sidecar's sentence, which is where the nuance goes.
 *
 * A 401/403 on the service description is the interesting case: plenty of
 * public endpoints refuse the description and answer queries perfectly well, so
 * saying "unreachable" and stopping would send someone hunting a fault that is
 * not there.
 */
const healthMessage = computed(() => {
  const result = probe.value;
  if (!result) return 'Never probed on this server. Run Test again to find out where it stands.';
  if (result.health === 'unreachable') {
    if (result.httpStatus === 401 || result.httpStatus === 403) {
      return `${result.httpStatus} on the service description. Queries may still succeed.`;
    }
    return result.error ?? 'No answer from the endpoint.';
  }
  if (result.health === 'slow') {
    return `Answered in ${result.latencyMs} ms, above the ${SLOW_MARK_MS} ms mark.`;
  }
  return `Answered in ${result.latencyMs} ms.`;
});

const envVariables = computed(() => env.value?.variables ?? []);

/*
 * Rows, not tiles, and no libraries row: the section directly above already
 * names every attached library, so a tile counting them was the same fact told
 * twice. A row with a zero is dimmed and inert — there is nothing to open.
 */
const usageRows = computed(() => {
  const groups = usage.value;
  const describe = (
    section: 'queries' | 'queryGroups' | 'benchmarks',
    label: string,
    group: { count: number; sample: Array<{ name: string }> } | undefined,
  ) => ({
    section,
    label,
    count: group?.count ?? 0,
    title: group && group.sample.length > 0
      ? `${group.sample.map((entry) => entry.name).join(', ')}${group.count > group.sample.length ? ', …' : ''}`
      : `Nothing here uses this backend`,
  });
  return [
    describe('queries', 'Queries', groups?.queries),
    describe('queryGroups', 'Query groups', groups?.queryGroups),
    describe('benchmarks', 'Benchmarks', groups?.benchmarks),
  ];
});

/*
 * "Attached" is the library's `defaultBackend` pointer, which is the only
 * backend↔library relation the model has. Attaching therefore means "make this
 * the library's default", and the copy under the chips says so rather than
 * implying a second, separate association.
 */
const attachedLibraries = computed(() =>
  librariesStore.visibleLibraries.value.filter((library) => library.defaultBackend === backend.value?.id)
);

const attachableLibraries = computed(() =>
  librariesStore.visibleLibraries.value.filter((library) => library.defaultBackend !== backend.value?.id)
);

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function loadBackend(id: string) {
  loading.value = true;
  loadError.value = null;
  /*
   * A browser backend has no server record to fetch; asking for one is a 404
   * and an error banner over a backend that is working fine. It is read from
   * storage and shown as it is — there is no version, no probe history and no
   * environment behind it to edit.
   */
  if (isBrowserBackendId(id)) {
    const record = browserBackends.get(id);
    backend.value = record ? browserBackends.toBackend(record) : null;
    loadError.value = record ? null : 'This browser backend is no longer registered in this browser.';
    loading.value = false;
    return;
  }
  try {
    const result = await backendsStore.fetchBackend(id);
    backend.value = result.backend;
  } catch (error: any) {
    backend.value = null;
    loadError.value = error?.message ?? 'Failed to load backend';
  } finally {
    loading.value = false;
  }
}

async function loadEnv(id: string) {
  envLoading.value = true;
  envError.value = null;
  try {
    env.value = await client.getBackendEnv(id);
  } catch (error: any) {
    env.value = null;
    // A library member is allowed to fail here; the record still reads.
    envError.value = error?.message ?? 'Failed to read the environment';
  } finally {
    envLoading.value = false;
  }
}

async function loadUsage(id: string) {
  try {
    usage.value = await client.getBackendUsage(id);
  } catch {
    usage.value = null;
  }
}

watch(
  () => props.backendId,
  async (id) => {
    env.value = null;
    usage.value = null;
    probeHistory.value = [];
    historyOpen.value = false;
    if (!id) {
      backend.value = null;
      return;
    }
    await loadBackend(id);
    if (!backend.value) return;
    // Nothing server-side to ask about a backend the server does not have.
    if (isBrowserBackendId(id)) return;
    // No wire, no credentials — the env table only means something over HTTP.
    if (backend.value.backendType === 'http') void loadEnv(id);
    void loadUsage(id);
    void librariesStore.loadLibraries();
  },
  { immediate: true }
);

/* ------------------------------------------------------------------ *
 * Per-field commit
 * ------------------------------------------------------------------ */

function validateEndpoint(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'An endpoint URL is required.';
  try {
    const url = new URL(trimmed);
    // `localhost:7878/sparql` parses — as a URL whose scheme is `localhost`.
    // Only http(s) is a SPARQL endpoint, so the check is on the scheme itself
    // rather than on whether anything parsed.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Include a scheme, e.g. https://query.wikidata.org/sparql';
    }
    return null;
  } catch {
    return 'Include a scheme, e.g. https://query.wikidata.org/sparql';
  }
}

/**
 * Commit one field. Returns an error message, which is what keeps a rejected
 * edit open over the still-live saved value.
 */
async function commitField(field: 'name' | 'description' | 'endpoint', value: string): Promise<string | null> {
  const current = backend.value;
  if (!current) return 'No backend loaded.';

  const trimmed = value.trim();
  if (field === 'name' && !trimmed) return 'A name is required.';
  if (field === 'endpoint') {
    const invalid = validateEndpoint(value);
    if (invalid) return invalid;
  }

  const input = backendsStore.toFormInput(current);
  if (field === 'description') {
    input.description = trimmed.length > 0 ? trimmed : null;
  } else {
    input[field] = trimmed;
  }

  try {
    backend.value = await backendsStore.updateBackend(current.id, input);
    // An endpoint change makes every observation stale, so re-ask rather than
    // leaving a green dot describing the previous store.
    if (field === 'endpoint') void probes.probe(current.id);
    return null;
  } catch (error: any) {
    return error?.message ?? 'Save failed';
  }
}

/**
 * Commit a changed oxigraphConfig, preserving whatever the stored config
 * carried beyond mode and sources. The server invalidates the built store on a
 * config edit, so the next query sees the new configuration.
 */
async function commitMemoryConfig(mode: MemoryStoreMode, sources: MemoryStoreSource[]) {
  const current = backend.value;
  if (!current || !canEdit.value) return;
  const serialized = serializeMemoryConfig(mode, sources, memoryConfig.value.rest);
  if (serialized === current.oxigraphConfig) return;
  const input = backendsStore.toFormInput(current);
  input.oxigraphConfig = serialized;
  try {
    backend.value = await backendsStore.updateBackend(current.id, input);
  } catch (error: any) {
    toast.error(error?.message ?? 'Failed to update the store configuration');
  }
}

async function commitStoreMode(mode: MemoryStoreMode) {
  if (memoryConfig.value.mode === mode) return;
  await commitMemoryConfig(mode, memoryConfig.value.sources);
}

async function commitSources(payload: { sources: MemoryStoreSource[]; complete: boolean }) {
  // An incomplete row is a thought in progress, not a state worth saving.
  if (!payload.complete) return;
  await commitMemoryConfig(memoryConfig.value.mode, payload.sources);
}

async function commitQueryMethod(method: 'post' | 'get') {
  const current = backend.value;
  if (!current || !canEdit.value || (current.queryMethod ?? 'post') === method) return;
  const input = backendsStore.toFormInput(current);
  input.queryMethod = method;
  try {
    backend.value = await backendsStore.updateBackend(current.id, input);
  } catch (error: any) {
    toast.error(error?.message ?? 'Failed to change the query method');
  }
}

/* ------------------------------------------------------------------ *
 * Environment key rename — confirmed, because it orphans variables
 * ------------------------------------------------------------------ */

const envKeyConfirmOpen = ref(false);
const pendingEnvKey = ref<string | null>(null);
let resolveEnvKeyChange: ((result: string | null) => void) | null = null;

const oldVariableNames = computed(() => variableNamesFor(backend.value?.authEnvKey ?? null));
const newVariableNames = computed(() => variableNamesFor(pendingEnvKey.value));

function variableNamesFor(key: string | null): string[] {
  const names = buildBackendAuthEnvVarNames(key);
  return names ? [names.username, names.password, names.authHeader] : [];
}

function requestEnvKeyChange(value: string): Promise<string | null> {
  const normalized = normalizeAuthEnvKey(value);
  if (!normalized) {
    return Promise.resolve('Letters, numbers and underscores only.');
  }
  pendingEnvKey.value = normalized;
  envKeyConfirmOpen.value = true;
  // The field stays open and the old value stays live until the confirm
  // resolves this promise one way or the other.
  return new Promise<string | null>((resolve) => {
    resolveEnvKeyChange = resolve;
  });
}

function cancelEnvKeyChange() {
  resolveEnvKeyChange?.('Rename cancelled.');
  resolveEnvKeyChange = null;
  pendingEnvKey.value = null;
}

async function confirmEnvKeyChange() {
  const current = backend.value;
  const key = pendingEnvKey.value;
  const resolve = resolveEnvKeyChange;
  resolveEnvKeyChange = null;
  pendingEnvKey.value = null;
  if (!current || !key) {
    resolve?.('No backend loaded.');
    return;
  }
  const input = backendsStore.toFormInput(current);
  input.authEnvKey = key;
  try {
    backend.value = await backendsStore.updateBackend(current.id, input);
    await loadEnv(current.id);
    resolve?.(null);
  } catch (error: any) {
    resolve?.(error?.message ?? 'Save failed');
  }
}

/* ------------------------------------------------------------------ *
 * Attach / detach
 * ------------------------------------------------------------------ */

const detachConfirmOpen = ref(false);
const detachTarget = ref<Library | null>(null);

const detachWarning = computed(() => {
  const count = usage.value?.queries.count ?? 0;
  if (count === 0) {
    return 'Queries in this library will no longer default to this backend.';
  }
  return `${count} ${count === 1 ? 'query' : 'queries'} point at this backend. Detaching leaves them unrunnable — we do not rewrite them.`;
});

function requestDetach(library: Library) {
  detachTarget.value = library;
  detachConfirmOpen.value = true;
}

async function setLibraryBackend(library: Library, backendId: string | null) {
  try {
    const loaded = await librariesStore.fetchLibrary(library.id);
    await librariesStore.updateLibrary(library.id, { ...loaded.form, defaultBackend: backendId });
    if (backend.value) void loadUsage(backend.value.id);
  } catch (error: any) {
    toast.error(error?.message ?? 'Failed to update the library');
  }
}

async function attachLibrary(library: Library) {
  if (!backend.value) return;
  await setLibraryBackend(library, backend.value.id);
}

async function confirmDetach() {
  const library = detachTarget.value;
  detachTarget.value = null;
  if (library) await setLibraryBackend(library, null);
}

/* ------------------------------------------------------------------ *
 * Header actions
 * ------------------------------------------------------------------ */

async function testConnection() {
  const current = backend.value;
  if (!current) return;
  testing.value = true;
  try {
    await probes.probe(current.id);
    // The card already says what happened, in more detail than a toast could —
    // but an open history list would otherwise be one probe out of date.
    if (historyOpen.value) await loadHistory(current.id);
  } finally {
    testing.value = false;
  }
}

async function loadHistory(id: string) {
  try {
    probeHistory.value = await client.getBackendProbeHistory(id);
  } catch {
    probeHistory.value = [];
  }
}

async function toggleHistory() {
  historyOpen.value = !historyOpen.value;
  if (historyOpen.value && backend.value) await loadHistory(backend.value.id);
}

function copyText(value: string, message: string) {
  copyToClipboard(value, message);
}

function copyId() {
  if (backend.value) copyText(backend.value.id, 'Backend ID copied');
}

function copyEndpoint() {
  if (backend.value?.endpoint) copyText(backend.value.endpoint, 'Endpoint copied');
}

/* ------------------------------------------------------------------ *
 * Creation
 * ------------------------------------------------------------------ */

const draftForm = reactive({
  name: '',
  kind: 'http' as 'http' | 'oxigraphMemory' | 'browser',
  endpoint: '',
  description: '',
  queryMethod: 'post' as 'post' | 'get',
  authEnvKey: '',
});
const draftMode = ref<MemoryStoreMode>('readOnly');
const draftSources = ref<MemoryStoreSource[]>([]);
const draftSourcesComplete = ref(true);
const draftEnvKeyEdited = ref(false);
const creating = ref(false);
const createError = ref<string | null>(null);
const draftNameInput = ref<HTMLInputElement | null>(null);

const draftEnvKeyModel = computed({
  get: () => (draftEnvKeyEdited.value ? draftForm.authEnvKey : deriveAuthEnvKeyFromName(draftForm.name)),
  set: (value: string) => {
    draftEnvKeyEdited.value = true;
    draftForm.authEnvKey = value;
  },
});

const draftEndpointError = computed(() =>
  draftForm.endpoint.trim().length === 0 ? null : validateEndpoint(draftForm.endpoint)
);

const canCreate = computed(() => {
  if (draftForm.name.trim().length === 0) return false;
  if (draftForm.kind === 'oxigraphMemory') {
    // An unseeded store is legitimate; a half-filled source row is not.
    return draftSourcesComplete.value;
  }
  return draftForm.endpoint.trim().length > 0 && !draftEndpointError.value;
});

function onDraftSourcesChange(payload: { sources: MemoryStoreSource[]; complete: boolean }) {
  draftSources.value = payload.sources;
  draftSourcesComplete.value = payload.complete;
}

/*
 * `/health` answers after the form is already on screen, so a draft started on
 * a read-only deployment can be sitting on a kind that has just stopped being
 * offered. Left alone it would show no selected radio and refuse to create.
 */
watch(
  availableBackendKinds,
  (kinds) => {
    if (!kinds.some(kind => kind.value === draftForm.kind)) {
      draftForm.kind = kinds[0]?.value ?? 'browser';
    }
  },
  { immediate: true }
);

watch(() => draftForm.name, (name) => emit('draft-name', name));

watch(
  () => props.draft,
  async (isDraft) => {
    if (!isDraft) return;
    draftForm.name = '';
    /*
     * The first kind this deployment offers, not `http`.
     *
     * A read-only deployment offers only the browser kind, and resetting to
     * `http` here left the form on a kind no radio could show as selected: the
     * HTTP fields and the server-side hints were drawn, nothing looked chosen,
     * and Create posted to `POST /backends` for the 405 it always was. The
     * coercion watcher below could not save it — it fires when the *list*
     * changes, and the list is settled by the time a draft is opened.
     */
    draftForm.kind = availableBackendKinds.value[0]?.value ?? 'http';
    draftForm.endpoint = '';
    draftForm.description = '';
    draftForm.queryMethod = 'post';
    draftForm.authEnvKey = '';
    draftMode.value = 'readOnly';
    draftSources.value = [];
    draftSourcesComplete.value = true;
    draftEnvKeyEdited.value = false;
    createError.value = null;
    await nextTick();
    draftNameInput.value?.focus();
  },
  { immediate: true }
);

async function createBackend() {
  if (!canCreate.value || creating.value) return;
  creating.value = true;
  createError.value = null;
  try {
    /*
     * A browser backend never reaches the API, so it takes neither the create
     * call nor the probe that follows one: probing is the server reporting what
     * it found at the URL, and the server is not going to look. The browser
     * finds out the same thing the first time a query runs, which is the only
     * moment that matters here.
     */
    if (draftForm.kind === 'browser') {
      const record = browserBackends.save({
        name: draftForm.name.trim(),
        description: draftForm.description.trim() || null,
        endpoint: draftForm.endpoint.trim(),
        queryMethod: draftForm.queryMethod,
        headers: {},
      });
      await backendsStore.loadBackends();
      emit('created', browserBackends.toBackend(record));
      return;
    }

    const created = await backendsStore.createBackend(
      draftForm.kind === 'oxigraphMemory'
        ? {
            name: draftForm.name.trim(),
            description: draftForm.description.trim() || null,
            backendType: 'oxigraphMemory',
            // No endpoint, method, or credentials: the store lives in-process.
            endpoint: null,
            authEnvKey: null,
            queryMethod: null,
            oxigraphConfig: serializeMemoryConfig(draftMode.value, draftSources.value),
          }
        : {
            name: draftForm.name.trim(),
            description: draftForm.description.trim() || null,
            backendType: 'http',
            endpoint: draftForm.endpoint.trim(),
            authEnvKey: normalizeAuthEnvKey(draftEnvKeyModel.value) ?? null,
            queryMethod: draftForm.queryMethod,
            oxigraphConfig: null,
          },
    );
    // One probe on create: it fills the product, sets the dot, and says
    // immediately if the URL is wrong (doc §Creation).
    void probes.probe(created.id);
    emit('created', created);
  } catch (error: any) {
    createError.value = error?.message ?? 'Failed to create the backend';
  } finally {
    creating.value = false;
  }
}

function relativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'just now';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
</script>

<style scoped>
.backend-work-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}

.record-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 48px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0 var(--space-6);
  border-bottom: 1px solid var(--border-subtle);
}

.record-name {
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.record-name--draft {
  color: var(--ink-muted);
}

.probe-summary {
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h);
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  cursor: pointer;
}

.button:hover:not(:disabled) {
  background: var(--surface-subtle);
}

.button:disabled {
  color: var(--ink-disabled);
  cursor: default;
}

.button--icon {
  width: var(--control-h);
  padding: 0;
  justify-content: center;
}

.button--primary {
  border-color: transparent;
  background: var(--action);
  color: var(--action-fg);
  font-weight: var(--weight-medium);
}

.button--primary:hover:not(:disabled) {
  background: var(--action-hover);
}

.button--primary:disabled {
  background: var(--border-strong);
  color: var(--ink-inverse);
}

.record-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-7) var(--space-6) var(--space-8);
  container-type: inline-size;
}

/*
 * Stacked by default — the sidecar sits under the settings, which is the narrow
 * frame. The query is on the pane, not the viewport: what decides whether two
 * columns fit is the space left after the rail and the list, and only the pane
 * knows that.
 */
.record-split {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
  max-width: 640px;
}

.record-column {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
  min-width: 0;
}

.record-sidecar {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-width: 0;
}

@container (min-width: 1060px) {
  .record-split {
    flex-direction: row;
    align-items: flex-start;
    gap: var(--space-8);
    max-width: none;
  }

  /* Fixed, not fluid: a wider settings column only stretches the endpoint
     field, and a 1900px endpoint field is worse than a short one. */
  .record-column {
    width: 640px;
    flex-shrink: 0;
  }

  .record-sidecar {
    width: 360px;
    flex-shrink: 0;
  }
}

.record-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/*
 * Not `.section-label`: that class is <SectionLabel>'s own, and a scoped rule
 * for it lands on every <SectionLabel> this file renders at equal specificity.
 * The type here is the dense step at 0.06em, which the primitive does not name
 * — see the fourteenth pass's residue list in designSystem.test.ts.
 */
.backend-section-label {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-muted);
}

.field-grid {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: var(--space-1) var(--space-6);
  align-items: center;
}

.field-name {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-body);
  color: var(--ink-muted);
}

/* The value cell for controls that are not an InlineField, kept on the same
   optical line as the fields above and below. */
.field-value {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-2) var(--space-4);
}

.field-name--top {
  align-self: start;
  padding-top: var(--space-4);
}

.field-with-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

/*
 * Shrink-to-fit, not fill: the copy and open buttons belong beside the URL they
 * act on. Pushed to the right edge of a 640px column they read as page actions.
 */
.field-with-actions :deep(.inline-field) {
  flex: 0 1 auto;
  min-width: 0;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--border-strong);
  cursor: pointer;
}

.icon-button:hover {
  background: var(--surface-subtle);
  color: var(--ink-secondary);
}

.segmented {
  display: flex;
}

.segment {
  height: 24px;
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  background: var(--surface);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-body);
  cursor: pointer;
}

.segment:first-child {
  border-radius: var(--radius-panel) 0 0 var(--radius-panel);
}

.segment:last-child {
  border-left: none;
  border-radius: 0 var(--radius-panel) var(--radius-panel) 0;
}

.segment.active {
  border-color: var(--action);
  background: var(--action-surface);
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
}

.segment:disabled {
  cursor: default;
}

.product-chip {
  display: inline-flex;
  align-items: center;
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border-radius: var(--radius-panel);
  background: var(--surface-sunken);
  color: var(--ink-secondary);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
}

.env-table {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.env-row {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.env-icon {
  flex-shrink: 0;
  color: var(--border-strong);
}

.env-icon--set {
  color: var(--success);
}

.env-name {
  font-family: var(--font-mono);
  font-size: var(--text-body);
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}

/* The badge is <StatusBadge>; what is this row's is where it sits. */
.env-state {
  margin-left: auto;
}

/* The inset and the ground are the table's; the type is the note's. */
.env-message {
  padding: var(--space-4) var(--space-5);
  background: var(--surface-subtle);
}

.chip-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: 26px;
  padding: 0 var(--space-3) 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
}

.chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--border-strong);
  cursor: pointer;
}

.chip-remove:hover {
  color: var(--danger);
}

.sidecar-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

/*
 * Health is the one card that carries colour: it is the only thing on the page
 * that can be wrong right now. The border and the heading carry it — a fully
 * filled card at this size shouts loudly enough to drown the record beside it,
 * and the state is already legible from the pill in the header.
 */
.sidecar-card--healthy {
  border-color: var(--success-border);
}

.sidecar-card--slow {
  border-color: var(--warning-border);
}

.sidecar-card--unreachable {
  border-color: var(--danger-border);
}

.card-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.health-name {
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.health-when {
  margin-left: auto;
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.sidecar-card--healthy .health-icon,
.sidecar-card--healthy .health-name {
  color: var(--success-ink);
}

.sidecar-card--slow .health-icon,
.sidecar-card--slow .health-name {
  color: var(--warning-ink);
}

.sidecar-card--unreachable .health-icon,
.sidecar-card--unreachable .health-name {
  color: var(--danger-ink);
}

.sidecar-card--never_probed .health-icon {
  color: var(--ink-muted);
}

.health-message {
  margin: 0;
  font-size: var(--text-body);
  color: var(--ink-secondary);
  line-height: var(--leading-normal);
}

.card-actions {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.card-empty {
  margin: 0;
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.probe-history {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 220px;
  overflow: auto;
}

.history-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-label);
  color: var(--ink-secondary);
}

.history-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--state-idle);
}

.history-dot--healthy {
  background: var(--success);
}

.history-dot--slow {
  background: var(--warning);
}

.history-dot--unreachable {
  background: var(--danger);
}

.history-when {
  width: 84px;
  flex-shrink: 0;
  color: var(--ink-muted);
}

.history-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach-button {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: 26px;
  padding: 0 var(--space-5);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-body);
  cursor: pointer;
}

.attach-button:hover {
  border-color: var(--action);
  color: var(--action);
}

.usage-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  padding: var(--space-3) var(--space-2);
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body-lg);
  text-align: left;
  cursor: pointer;
}

.usage-row:last-child {
  border-bottom: none;
}

.usage-row:hover:not(:disabled) {
  background: var(--surface-subtle);
}

.usage-label {
  flex: 1;
  min-width: 0;
}

.usage-count {
  font-family: var(--font-mono);
  font-weight: var(--weight-semibold);
}

.usage-chevron {
  color: var(--border-strong);
  flex-shrink: 0;
}

/* A zero has nothing to open, so the row stops looking like a door. */
.usage-row--empty {
  color: var(--ink-muted);
  cursor: default;
}

.usage-row--empty .usage-chevron {
  color: var(--surface-raised);
}

.record-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-muted);
  font-size: var(--text-body);
}

.form-grid {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: var(--space-6);
  align-items: center;
}

.form-label {
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.form-label--top {
  align-self: start;
  padding-top: var(--space-4);
}

.required {
  color: var(--danger);
}

.form-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.form-input {
  width: 100%;
  box-sizing: border-box;
  height: var(--control-h-lg);
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body-lg);
}

.form-input:focus {
  outline: none;
  border-color: var(--action);
  box-shadow: 0 0 0 3px var(--action-surface);
}

.form-input--mono {
  font-family: var(--font-mono);
  font-size: var(--text-body);
}

.form-input--textarea {
  height: auto;
  padding: var(--space-4) var(--space-5);
  line-height: var(--leading-normal);
  resize: vertical;
}

.form-input--invalid {
  border-color: var(--danger);
}

.form-error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}

.method-choice {
  display: flex;
  gap: var(--space-4);
}

.method-option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h-lg);
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink-secondary);
  font-size: var(--text-body);
  cursor: pointer;
}

.method-option.active {
  border-color: var(--action);
  background: var(--action-surface);
  color: var(--action-ink);
}

/* The store-mode cards: three choices whose consequences deserve a sentence
   each, so they stack rather than sit in a row of bare labels. */
.mode-choice {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.mode-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  cursor: pointer;
}

.mode-option.active {
  border-color: var(--action);
  background: var(--action-surface);
}

.mode-option input {
  margin-top: var(--space-1);
}

.mode-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.mode-name {
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  color: var(--ink);
}

.mode-option.active .mode-name {
  color: var(--action-ink);
}

.note-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-size: var(--text-body);
  line-height: var(--leading-normal);
}

.confirm-list {
  margin: var(--space-3) 0;
  padding-left: var(--space-7);
}

.confirm-list code {
  font-family: var(--font-mono);
  font-size: var(--text-body);
}
</style>
