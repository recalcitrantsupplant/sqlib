<template>
  <div ref="workAreaRef" class="ogc-service-work-area">
    <div
      class="left-panel"
      :class="{ resizing: isResizingVertical }"
      :style="{ width: rightPanelCollapsed ? 'calc(100% - 48px)' : leftPanelWidth + '%' }"
    >
      <SaveBar
        :title="serviceName"
        noun="OGC service"
        :is-scratch="isScratch"
        :pin-id="serviceId || null"
        :current-version-number="currentVersionNumber"
        :edit-count="editCount"
        :draft-not-kept="draftNotKept"
        :saving="isSaving"
        :can-save="canSave"
        :needs-name="!serviceName.trim()"
        :show-format="false"
        :show-diff="false"
        :show-edit="false"
        :show-more="false"
        @save="save"
        @needs-name="promptForNameInDetails"
        @discard="discardDraft"
      />

      <div class="body">
        <section class="group">
          <SectionLabel as="h3" size="md">Service</SectionLabel>
          <div class="service-fields">
            <FormField label="Slug">
              <input
                v-model="slug"
                class="control control-mono slug-input"
                :class="{ 'control-invalid': slug !== '' && !slugValid }"
                data-testid="ogc-service-slug"
                spellcheck="false"
                :title="slugValid || slug === '' ? undefined : 'Lower-case letters, digits and -, at most 64'"
              >
            </FormField>
            <FormField label="URL" as="div" grow>
              <div class="url-row">
                <a
                  v-if="slugValid && serviceId && !isScratch"
                  class="url-text"
                  :href="serviceUrl"
                  target="_blank"
                  rel="noopener"
                  data-testid="ogc-service-url"
                >{{ serviceUrl }}</a>
                <span v-else class="url-text url-text--pending" data-testid="ogc-service-url">{{ serviceUrl }}</span>
                <CopyButton :text="slugValid ? serviceUrl : ''" subject="service URL" size="sm" testid="ogc-service-copy-url" />
                <a
                  v-if="mapUrl"
                  class="btn-compact map-link"
                  :href="mapUrl"
                  target="_blank"
                  rel="noopener"
                  data-testid="ogc-service-map"
                >
                  <MapIcon :size="13" />
                  Map
                </a>
              </div>
            </FormField>
          </div>
        </section>

        <ul v-if="problems.length" class="problems" data-testid="ogc-service-problems">
          <li v-for="problem in problems" :key="problem" class="problem">
            <TriangleAlert :size="13" class="problem-icon" />
            <span>{{ problem }}</span>
          </li>
        </ul>

        <section class="group">
          <div class="group-head">
            <SectionLabel as="h3" size="md" :count="collections.length">Collections</SectionLabel>
            <a
              class="help-link"
              :href="COLLECTIONS_DOC"
              target="_blank"
              rel="noopener"
              title="OGC API Features: collections"
              aria-label="OGC API Features: collections"
            ><CircleHelp :size="13" /></a>
            <button
              type="button"
              class="btn-compact add-button"
              data-testid="ogc-service-add-collection"
              @click="addCollection"
            >
              <Plus :size="13" />
              Add
            </button>
          </div>

          <div v-if="collections.length" class="table-scroll">
            <table class="collections-table" data-testid="ogc-service-collections">
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Title</th>
                  <th>Query</th>
                  <th>Version</th>
                  <th class="numeric">Queryables</th>
                  <th title="JSON-LD terms">JSON-LD</th>
                  <th class="actions-cell"><span class="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(collection, index) in collections"
                  :key="index"
                  :class="{ selected: selectedIndex === index }"
                  :data-testid="`ogc-collection-${collection.collectionId || index}`"
                  :title="`Edit ${collection.collectionId || 'collection'}`"
                  tabindex="0"
                  @click="editCollection(index)"
                  @keydown.enter.self="editCollection(index)"
                >
                  <td class="mono">{{ collection.collectionId || '—' }}</td>
                  <td>{{ collection.title || '—' }}</td>
                  <td>
                    <NuxtLink
                      v-if="collection.query"
                      class="query-link"
                      :to="queryLink(collection)"
                      @click.stop
                    >{{ queryName(collection.query) }}</NuxtLink>
                    <span v-else class="cell-muted">—</span>
                  </td>
                  <td class="version-cell" :class="{ 'cell-muted': !collection.queryVersion }">{{ versionLabel(collection, versionNumbers) }}</td>
                  <td class="numeric">{{ queryableCount(collection) }}</td>
                  <td>
                    <Check v-if="hasContext(collection)" :size="13" aria-label="Has JSON-LD terms" />
                    <span v-else class="cell-muted">—</span>
                  </td>
                  <td class="actions-cell">
                    <button
                      type="button"
                      class="icon-control icon-control--sm"
                      :title="`Remove ${collection.collectionId || 'collection'}`"
                      :aria-label="`Remove ${collection.collectionId || 'collection'}`"
                      :data-testid="`ogc-collection-remove-${index}`"
                      @click.stop="removeCollection(index)"
                    >
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <EmptyState v-else title="No collections" size="sm" boxed />

          <InlineNote v-if="saveError" tone="danger" data-testid="ogc-service-error">{{ saveError }}</InlineNote>
        </section>
      </div>
    </div>

    <div
      class="vertical-resizer"
      :class="{ hidden: rightPanelCollapsed }"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the inspector panel"
      title="Drag to resize · double-click to reset"
      @mousedown="startVerticalResize"
      @dblclick="resetPanelWidth"
    >
      <div class="resizer-handle"></div>
    </div>

    <div class="right-panel" :class="{ collapsed: rightPanelCollapsed }">
      <InspectorPanel
        v-model:active-tab="activeTab"
        v-model:collapsed="rightPanelCollapsed"
        :tabs="inspectorTabs"
        testid="ogc-service-inspector"
      >
        <template #collection>
          <div v-if="form" class="editor" data-testid="ogc-collection-editor">
            <InlineNote v-if="saveError" tone="danger" class="editor-error">{{ saveError }}</InlineNote>

            <section class="editor-group">
              <div class="field-row">
                <FormField label="Query" as="div" grow>
                  <SearchSelect
                    :model-value="form.query || null"
                    :options="queryOptions"
                    placeholder="Choose a query"
                    test-id="ogc-collection-query"
                    aria-label="Query"
                    @update:model-value="chooseQuery"
                  />
                </FormField>
                <FormField label="Version">
                  <template #actions>
                    <InfoHint label="Version">Empty follows the query's version in the deployment's environment.</InfoHint>
                  </template>
                  <select v-model="form.queryVersion" class="control" data-testid="ogc-collection-query-version" :disabled="!form.query">
                    <option value="">Follows environment</option>
                    <option v-for="version in formQueryVersions" :key="version.id" :value="version.id">v{{ version.version }}</option>
                  </select>
                </FormField>
              </div>
              <InlineNote v-if="signatureError" tone="danger">{{ signatureError }}</InlineNote>
            </section>

            <section class="editor-group">
              <SectionLabel as="h4">Collection</SectionLabel>
              <div class="field-row">
                <FormField label="Id">
                  <input v-model="form.collectionId" class="control control-mono" :class="invalid('Id')" data-testid="ogc-collection-id" spellcheck="false">
                </FormField>
                <FormField label="Title" grow>
                  <input v-model="form.title" class="control" :class="invalid('Title')" data-testid="ogc-collection-title">
                </FormField>
                <FormField label="Mode">
                  <template #actions>
                    <InfoHint label="Mode">values: queryables fill VALUES clauses. cql2: filters go to a Lucene index.</InfoHint>
                  </template>
                  <select v-model="form.mode" class="control" data-testid="ogc-collection-mode">
                    <option value="values">values</option>
                    <option value="cql2">cql2</option>
                  </select>
                </FormField>
              </div>
              <FormField label="Description">
                <textarea v-model="form.description" class="control control-area" rows="2" data-testid="ogc-collection-description" />
              </FormField>
            </section>

            <section class="editor-group">
              <SectionLabel as="h4">Features</SectionLabel>
              <div class="field-row">
                <FormField label="Feature column">
                  <select v-model="form.featureVar" class="control control-mono" :class="invalid('Feature column')" data-testid="ogc-collection-feature">
                    <option value="">—</option>
                    <option v-for="column in withCurrent(outputs, form.featureVar)" :key="column" :value="column">?{{ column }}</option>
                  </select>
                </FormField>
                <FormField label="Base IRI" grow>
                  <template #actions>
                    <InfoHint label="Base IRI">A feature's id is its IRI with this prefix removed.</InfoHint>
                  </template>
                  <input v-model="form.featureBase" class="control control-mono" :class="invalid('Base IRI')" data-testid="ogc-collection-feature-base" spellcheck="false" placeholder="https://example.org/">
                </FormField>
              </div>
              <div class="field-row">
                <FormField label="Geometry">
                  <select v-model="form.geometryKind" class="control" data-testid="ogc-collection-geometry-kind">
                    <option value="column">Column</option>
                    <option value="point">Longitude, latitude</option>
                    <option value="none">None</option>
                  </select>
                </FormField>
                <FormField v-if="form.geometryKind === 'column'" label="Geometry column">
                  <select v-model="form.geometry" class="control control-mono" data-testid="ogc-collection-geometry">
                    <option value="">—</option>
                    <option v-for="column in withCurrent(outputs, form.geometry)" :key="column" :value="column">?{{ column }}</option>
                  </select>
                </FormField>
                <template v-else-if="form.geometryKind === 'point'">
                  <FormField label="Longitude">
                    <select v-model="form.pointLon" class="control control-mono" :class="invalid('Longitude')" data-testid="ogc-collection-lon">
                      <option value="">—</option>
                      <option v-for="column in withCurrent(outputs, form.pointLon)" :key="column" :value="column">?{{ column }}</option>
                    </select>
                  </FormField>
                  <FormField label="Latitude">
                    <select v-model="form.pointLat" class="control control-mono" :class="invalid('Latitude')" data-testid="ogc-collection-lat">
                      <option value="">—</option>
                      <option v-for="column in withCurrent(outputs, form.pointLat)" :key="column" :value="column">?{{ column }}</option>
                    </select>
                  </FormField>
                </template>
              </div>
            </section>

            <section class="editor-group">
              <SectionLabel as="h4">Parameters</SectionLabel>
              <div class="field-row">
                <FormField label="Limit">
                  <select v-model="form.limit" class="control control-mono" data-testid="ogc-collection-limit">
                    <option value="">—</option>
                    <option v-for="name in withCurrent(signature?.limitParameters ?? [], form.limit)" :key="name" :value="name">LIMIT {{ name }}</option>
                  </select>
                </FormField>
                <FormField label="Offset">
                  <select v-model="form.offset" class="control control-mono" data-testid="ogc-collection-offset">
                    <option value="">—</option>
                    <option v-for="name in withCurrent(signature?.offsetParameters ?? [], form.offset)" :key="name" :value="name">OFFSET {{ name }}</option>
                  </select>
                </FormField>
                <FormField label="Page size" class="field-number">
                  <input v-model="form.pageSizeDefault" class="control" type="number" min="1" placeholder="10" data-testid="ogc-collection-page-default">
                </FormField>
                <FormField label="Max" class="field-number">
                  <input v-model="form.pageSizeMax" class="control" type="number" min="1" placeholder="1000" data-testid="ogc-collection-page-max">
                </FormField>
              </div>
              <FormField label="Bbox" as="div">
                <template #actions>
                  <InfoHint label="Bbox">Minimum longitude, minimum latitude, maximum longitude, maximum latitude.</InfoHint>
                </template>
                <div class="quad">
                  <select
                    v-for="(label, position) in BBOX_LABELS"
                    :key="label"
                    v-model="form.bbox[position]"
                    class="control control-mono"
                    :aria-label="label"
                    :title="label"
                    :data-testid="`ogc-collection-bbox-${position}`"
                  >
                    <option value="">—</option>
                    <option v-for="name in withCurrent(variables, form.bbox[position] ?? '')" :key="name" :value="name">?{{ name }}</option>
                  </select>
                </div>
              </FormField>
              <div class="field-row">
                <FormField label="Datetime" as="div" class="field-wide">
                  <div class="pair">
                    <select v-model="form.datetimeStart" class="control control-mono" aria-label="Start" title="Start" data-testid="ogc-collection-datetime-start">
                      <option value="">—</option>
                      <option v-for="name in withCurrent(variables, form.datetimeStart)" :key="name" :value="name">?{{ name }}</option>
                    </select>
                    <select v-model="form.datetimeEnd" class="control control-mono" aria-label="End" title="End" data-testid="ogc-collection-datetime-end">
                      <option value="">—</option>
                      <option v-for="name in withCurrent(variables, form.datetimeEnd)" :key="name" :value="name">?{{ name }}</option>
                    </select>
                  </div>
                </FormField>
                <FormField label="Skip geometry">
                  <select v-model="form.skipGeometry" class="control control-mono" data-testid="ogc-collection-skip">
                    <option value="">—</option>
                    <option v-for="name in withCurrent(variables, form.skipGeometry)" :key="name" :value="name">?{{ name }}</option>
                  </select>
                </FormField>
              </div>
            </section>

            <section class="editor-group">
              <div class="group-head">
                <SectionLabel as="h4" :count="form.queryables.length">Queryables</SectionLabel>
                <a
                  class="help-link"
                  :href="QUERYABLES_DOC"
                  target="_blank"
                  rel="noopener"
                  title="OGC API Features: queryables"
                  aria-label="OGC API Features: queryables"
                ><CircleHelp :size="13" /></a>
                <button type="button" class="btn-compact add-button" data-testid="ogc-queryable-add" @click="addQueryable">
                  <Plus :size="13" />
                  Add
                </button>
              </div>
              <div v-if="form.queryables.length" class="rows rows--queryables">
                <span class="row-head">Name</span>
                <span class="row-head">Variable</span>
                <span class="row-head">Type</span>
                <span class="row-head">Title</span>
                <span />
                <template v-for="(row, index) in form.queryables" :key="index">
                  <input v-model="row.name" class="control control-mono" aria-label="Name" :data-testid="`ogc-queryable-name-${index}`" spellcheck="false">
                  <select v-model="row.variable" class="control control-mono" aria-label="Variable" :data-testid="`ogc-queryable-var-${index}`">
                    <option value="">—</option>
                    <option v-for="name in withCurrent(variables, row.variable)" :key="name" :value="name">?{{ name }}</option>
                  </select>
                  <select v-model="row.type" class="control" aria-label="Type" :data-testid="`ogc-queryable-type-${index}`">
                    <option v-for="type in OGC_QUERYABLE_TYPES" :key="type" :value="type">{{ type }}</option>
                  </select>
                  <input v-model="row.title" class="control" aria-label="Title" :data-testid="`ogc-queryable-title-${index}`">
                  <button type="button" class="icon-control icon-control--sm" :title="`Remove ${row.name || 'queryable'}`" @click="form.queryables.splice(index, 1)">
                    <X />
                  </button>
                </template>
              </div>
              <FormField label="Values query" as="div">
                <template #actions>
                  <InfoHint label="Values query">A SELECT returning ?property ?value ?count, for each queryable's values.</InfoHint>
                </template>
                <SearchSelect
                  :model-value="form.valuesQuery || null"
                  :options="queryOptions"
                  placeholder="None"
                  empty-label="None"
                  test-id="ogc-collection-values-query"
                  aria-label="Values query"
                  @update:model-value="(value) => { if (form) form.valuesQuery = value; }"
                />
              </FormField>
            </section>

            <section class="editor-group">
              <div class="group-head">
                <SectionLabel as="h4" :count="form.context.length">JSON-LD terms</SectionLabel>
                <InfoHint label="JSON-LD terms">Each term maps a feature property to an IRI in the response's @context.</InfoHint>
                <button type="button" class="btn-compact add-button" data-testid="ogc-term-add" @click="addTerm">
                  <Plus :size="13" />
                  Add
                </button>
              </div>
              <div v-if="form.context.length" class="rows rows--terms">
                <span class="row-head">Property</span>
                <span class="row-head">IRI</span>
                <span class="row-head">Kind</span>
                <span class="row-head" />
                <span />
                <template v-for="(row, index) in form.context" :key="index">
                  <select v-model="row.property" class="control control-mono" aria-label="Property" :data-testid="`ogc-term-property-${index}`">
                    <option value="">—</option>
                    <option v-for="column in withCurrent(properties, row.property)" :key="column" :value="column">{{ column }}</option>
                  </select>
                  <input v-model="row.iri" class="control control-mono" aria-label="IRI" spellcheck="false" :data-testid="`ogc-term-iri-${index}`">
                  <select v-model="row.kind" class="control" aria-label="Kind" :data-testid="`ogc-term-kind-${index}`">
                    <option value="literal">Literal</option>
                    <option value="iri">IRI</option>
                    <option value="datatype">Datatype</option>
                    <option value="language">Language</option>
                  </select>
                  <DatatypeSelect
                    v-if="row.kind === 'datatype'"
                    :model-value="row.datatype || undefined"
                    :test-id="`ogc-term-datatype-${index}`"
                    @update:model-value="(value) => { row.datatype = value ?? ''; }"
                  />
                  <input
                    v-else-if="row.kind === 'language'"
                    v-model="row.language"
                    class="control control-mono"
                    aria-label="Language"
                    placeholder="en"
                    :data-testid="`ogc-term-language-${index}`"
                  >
                  <span v-else />
                  <button type="button" class="icon-control icon-control--sm" :title="`Remove ${row.property || 'term'}`" @click="form.context.splice(index, 1)">
                    <X />
                  </button>
                </template>
              </div>
            </section>
          </div>
          <EmptyState v-else title="No collection selected" size="sm" />
        </template>

        <template #details>
          <EntityDetailsPanel
            ref="detailsPanelRef"
            v-bind="detailsProps"
            @update:name="serviceName = $event"
            @update:description="description = $event"
            @select-version="selectVersion"
            @set-current-version="setCurrentVersion"
            @annotate-version="annotateVersion"
            @select-draft="selectDraft"
            @copy-id="copyServiceId"
            @delete="removeService"
          />
        </template>
      </InspectorPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One OGC service: its slug and URL, its collections, and its versions.
 *
 * The lifecycle is the tuple set's: scratch, draft, save, immutable versions.
 * The stable entity carries the name, description and slug; a version carries
 * the collections, and Save writes a new one with all of them. The server
 * checks each collection against the query it names, and its 400 is shown
 * under the table and above the editor.
 *
 * The collection editor works on a flat form (`lib/ogcServiceForm.ts`) and
 * writes each change back into the list, so the list is what drafts and saves.
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { Check, CircleHelp, Map as MapIcon, Plus, Trash2, TriangleAlert, X } from '@lucide/vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import SaveBar from './shared/SaveBar.vue';
import FormField from './shared/FormField.vue';
import SectionLabel from './shared/SectionLabel.vue';
import InlineNote from './shared/InlineNote.vue';
import InfoHint from './shared/InfoHint.vue';
import EmptyState from './shared/EmptyState.vue';
import CopyButton from './shared/CopyButton.vue';
import SearchSelect, { type SearchSelectOption } from './shared/SearchSelect.vue';
import DatatypeSelect from './shared/DatatypeSelect.vue';
import InspectorPanel, { type InspectorTab } from './shared/InspectorPanel.vue';
import EntityDetailsPanel from './shared/EntityDetailsPanel.vue';
import { useOgcServicesStore } from '@/composables/useOgcServicesStore';
import { usePanelResize } from '@/composables/usePanelResize';
import {
  useApiClient,
  type OgcServiceCollection,
  type OgcServiceVersion,
} from '@/composables/useApiClient';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { useScratchRecord } from '@/composables/useScratchRecord';
import { useEntityDraft } from '@/composables/useEntityDraft';
import { useCallableDrafts } from '@/composables/useCallableDrafts';
import { sectionPath } from '@/lib/sectionRoutes';
import {
  OGC_QUERYABLE_TYPES,
  OGC_SERVICE_SLUG_PATTERN,
  collectionFromForm,
  firstMissing,
  formFromCollection,
  freshCollectionId,
  hasContext,
  missingFields,
  ogcMapUrl,
  ogcServiceUrl,
  propertyColumns,
  queryableCount,
  suggestMapping,
  valuesVariables,
  versionLabel,
  type CollectionForm,
  type QuerySignature,
  type RequiredField,
} from '@/lib/ogcServiceForm';

const COLLECTIONS_DOC = 'https://docs.ogc.org/is/17-069r4/17-069r4.html#_collections_';
const QUERYABLES_DOC = 'https://docs.ogc.org/is/19-079r2/19-079r2.html#queryables';
const BBOX_LABELS = ['min lon', 'min lat', 'max lon', 'max lat'] as const;

const props = defineProps<{
  ogcServiceId?: string | null;
  scratchId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'scratch-saved', payload: { id: string; name: string; libraryId: string }): void;
  (e: 'ogc-service-deleted'): void;
}>();

const store = useOgcServicesStore();
const apiClient = useApiClient();
const draftsStore = useCallableDrafts();
const { activeLibraryId } = useActiveLibrary();
const config = useRuntimeConfig();

const serviceId = ref<string | null>(props.ogcServiceId ?? null);
const serviceName = ref('');
const description = ref('');
const slug = ref('');
const collections = ref<OgcServiceCollection[]>([]);
const problems = ref<string[]>([]);
const versions = ref<OgcServiceVersion[]>([]);
const currentVersionId = ref<string | null>(null);
const loadedVersionId = ref<string | null>(null);
const serviceLibraryId = ref<string | null>(null);
const serviceCreatedAt = ref<string | null>(null);
const isSaving = ref(false);
const isDeleting = ref(false);
const saveError = ref<string | null>(null);
/** The collection open in the editor, by position, and the form it is edited through. */
const selectedIndex = ref<number | null>(null);
const form = ref<CollectionForm | null>(null);

/** What is saved: the entity's fields and the current version's collections. */
const saved = reactive({ name: '', description: '', slug: '', collections: [] as OgcServiceCollection[] });

interface OgcServiceBody {
  name?: string;
  description?: string;
  slug?: string;
  collections?: OgcServiceCollection[];
}

/** JSON with sorted keys, so two collections that differ only in key order compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => (
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : entry
  ));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const slugValid = computed(() => OGC_SERVICE_SLUG_PATTERN.test(slug.value));
const apiBaseUrl = computed(() => String(config.public.apiBaseUrl ?? ''));
const serviceUrl = computed(() => ogcServiceUrl(apiBaseUrl.value, slug.value || '{slug}'));
const mapUrl = computed(() => {
  if (!slugValid.value || !serviceId.value || isScratch.value) return null;
  return ogcMapUrl({
    apiBaseUrl: apiBaseUrl.value,
    appBase: (config.app as { baseURL?: string } | undefined)?.baseURL,
    origin: typeof window === 'undefined' ? '' : window.location.origin,
  }, slug.value);
});

const { isScratch } = useScratchRecord({
  scratchId: () => props.scratchId ?? null,
  missingMessage: 'That scratch OGC service is not in this browser',
  track: [serviceName, description, slug, collections],
  hydrate: (record) => {
    const body = (record.body ?? {}) as OgcServiceBody;
    serviceName.value = record.name;
    description.value = body.description ?? '';
    slug.value = body.slug ?? '';
    collections.value = clone(body.collections ?? []);
    selectedIndex.value = null;
  },
  collect: (record) => ({
    name: serviceName.value || record.name,
    body: { description: description.value, slug: slug.value, collections: clone(collections.value) },
  }),
});

const currentVersionNumber = computed(
  () => versions.value.find((version) => version.id === currentVersionId.value)?.version ?? null,
);

/* ------------------------------------------------------------- inspector */

const workAreaRef = ref<HTMLElement | null>(null);
const {
  panelWidthPercent: leftPanelWidth,
  startResize: startVerticalResize,
  isResizing: isResizingVertical,
  collapsed: rightPanelCollapsed,
  resetWidth: resetPanelWidth,
} = usePanelResize({
  containerRef: workAreaRef,
  storageKey: 'ogcService',
  collapsible: true,
  initialWidthPercent: 50,
});

const activeTab = ref('details');
const inspectorTabs = computed<InspectorTab[]>(() => [
  { id: 'collection', label: 'Collection', testid: 'ogc-collection-tab' },
  { id: 'details', label: 'Details' },
]);

const detailsPanelRef = ref<InstanceType<typeof EntityDetailsPanel> | null>(null);

function promptForNameInDetails() {
  activeTab.value = 'details';
  rightPanelCollapsed.value = false;
  void nextTick(() => detailsPanelRef.value?.focusName());
}

const versionOptions = computed(() =>
  [...versions.value]
    .sort((a, b) => b.version - a.version)
    .map((version) => ({
      value: version.id,
      label: String(version.version),
      comment: version.comment ?? null,
      summary: `${version.collections.length} ${version.collections.length === 1 ? 'collection' : 'collections'}`,
      dateModified: version.dateModified ?? version.dateCreated ?? null,
    })),
);

const detailsProps = computed(() => ({
  name: serviceName.value,
  description: description.value,
  isScratch: isScratch.value,
  entityId: isScratch.value ? null : (serviceId.value || null),
  entityNoun: 'OGC service',
  showBackend: false,
  showSignature: false,
  versionOptions: versionOptions.value,
  selectedVersion: loadedVersionId.value,
  currentVersion: currentVersionId.value,
  canSetCurrentVersion: !isScratch.value,
  canAnnotateVersions: !isScratch.value && !!serviceId.value,
  editCount: editCount.value,
  draftSavedAt: locallySavedAt.value,
  draftSelected: editCount.value > 0 && canonical(collections.value) !== canonical(loadedCollections.value),
  createdAt: isScratch.value ? null : serviceCreatedAt.value,
  canDelete: !isScratch.value && !!serviceId.value,
  deleting: isDeleting.value,
}));

/** The collections of the version the editor was loaded from. */
const loadedCollections = ref<OgcServiceCollection[]>([]);

function selectVersion(versionId: string) {
  const version = versions.value.find((candidate) => candidate.id === versionId);
  if (!version) return;
  collections.value = clone(version.collections);
  selectedIndex.value = null;
  loadedVersionId.value = version.id;
  loadedCollections.value = clone(version.collections);
  toast.success(`Loaded v${version.version}`);
}

function selectDraft() {
  const draft = openDraft.value?.body as OgcServiceBody | undefined;
  if (!draft) return;
  applyEditorBody(draft);
  loadedVersionId.value = currentVersionId.value;
  loadedCollections.value = clone(saved.collections);
}

async function setCurrentVersion(versionId: string) {
  if (!serviceId.value) return;
  try {
    const updated = await store.updateOgcService(serviceId.value, { currentVersion: versionId });
    currentVersionId.value = versionId;
    problems.value = updated.problems;
    const version = versions.value.find((candidate) => candidate.id === versionId);
    if (version) saved.collections = clone(version.collections);
    toast.success(version ? `v${version.version} is now current` : 'Current version updated');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to set the current version');
  }
}

async function annotateVersion({ value, comment }: { value: string; comment: string | null }) {
  const id = serviceId.value;
  const version = versions.value.find((candidate) => candidate.id === value);
  if (!id || !version) return;
  const previous = version.comment ?? null;
  const apply = (next: string | null) => {
    versions.value = versions.value.map((entry) => (entry.id === value ? { ...entry, comment: next } : entry));
  };
  apply(comment);
  try {
    await store.annotateVersion(id, version.version, comment);
  } catch (error) {
    apply(previous);
    console.error('[OgcServiceWorkArea] Failed to save the version note', error);
    toast.error('Failed to save the note');
  }
}

async function copyServiceId() {
  if (!serviceId.value) return;
  try {
    await navigator.clipboard.writeText(serviceId.value);
    toast.success('OGC service ID copied');
  } catch {
    toast.error('Could not copy the ID');
  }
}

/* ------------------------------------------------------------ draft state */

function editorBody(): OgcServiceBody {
  return {
    name: serviceName.value,
    description: description.value,
    slug: slug.value,
    collections: collections.value,
  };
}

function applyEditorBody(body: OgcServiceBody) {
  if (typeof body.name === 'string' && body.name) serviceName.value = body.name;
  if (typeof body.description === 'string') description.value = body.description;
  if (typeof body.slug === 'string') slug.value = body.slug;
  if (Array.isArray(body.collections)) collections.value = clone(body.collections);
  selectedIndex.value = null;
}

const {
  hydrating: hydratingRecord,
  locallySavedAt,
  openDraft,
  editCount,
  notPersisted: draftNotKept,
  removeDraft,
  cancelDraftSave,
  discardDraft: discardEntityDraft,
} = useEntityDraft<OgcServiceBody>({
  section: 'ogcService',
  id: () => serviceId.value,
  enabled: () => !isScratch.value,
  libraryId: () => serviceLibraryId.value || activeLibraryId.value,
  name: () => serviceName.value,
  description: () => description.value,
  editorBody,
  applyBody: applyEditorBody,
  savedBody: () => ({ ...saved, collections: saved.collections }),
  sameBody: (editor, stored) => canonical(editor) === canonical(stored),
  sources: [serviceName, description, slug, collections],
  resultKind: 'BINDINGS',
});

function discardDraft() {
  discardEntityDraft();
  toast.success('Draft discarded');
}

const entityChanged = computed(() =>
  serviceName.value.trim() !== saved.name
  || description.value.trim() !== saved.description
  || slug.value !== saved.slug,
);
const collectionsChanged = computed(() => canonical(collections.value) !== canonical(saved.collections));

const canSave = computed(() => {
  if (!serviceName.value.trim() || !slugValid.value) return false;
  if (isScratch.value || !serviceId.value) return true;
  return entityChanged.value || collectionsChanged.value;
});

/* ------------------------------------------------------------ collections */

watch(selectedIndex, (index) => {
  const collection = index === null ? undefined : collections.value[index];
  form.value = collection ? formFromCollection(collection) : null;
});

/* Each edit in the form is written back into the list, which is what drafts and saves. */
watch(form, (next) => {
  const index = selectedIndex.value;
  if (!next || index === null || !collections.value[index]) return;
  const built = collectionFromForm(next);
  if (canonical(built) === canonical(collections.value[index])) return;
  collections.value = collections.value.map((entry, position) => (position === index ? built : entry));
}, { deep: true });

/* A list replaced from outside (a version, a draft, a discard) drops the selection it no longer has. */
watch(() => collections.value.length, (length) => {
  if (selectedIndex.value !== null && selectedIndex.value >= length) selectedIndex.value = null;
});

function editCollection(index: number) {
  if (selectedIndex.value === index && form.value) {
    activeTab.value = 'collection';
    rightPanelCollapsed.value = false;
    return;
  }
  selectedIndex.value = index;
  activeTab.value = 'collection';
  rightPanelCollapsed.value = false;
}

function addCollection() {
  const collectionId = freshCollectionId(collections.value.map((entry) => entry.collectionId));
  collections.value = [
    ...collections.value,
    { query: '', collectionId, title: '', mode: 'values', feature: { var: '', base: '' } } as OgcServiceCollection,
  ];
  editCollection(collections.value.length - 1);
}

function removeCollection(index: number) {
  if (selectedIndex.value === index) selectedIndex.value = null;
  else if (selectedIndex.value !== null && selectedIndex.value > index) selectedIndex.value -= 1;
  collections.value = collections.value.filter((_, position) => position !== index);
}

/** Set by a Save that found an empty required field; the editor then marks them. */
const showMissing = ref(false);
const missingInForm = computed(() => (form.value ? missingFields(collectionFromForm(form.value)) : []));

function invalid(field: RequiredField) {
  return { 'control-invalid': showMissing.value && missingInForm.value.includes(field) };
}

function addQueryable() {
  form.value?.queryables.push({ name: '', variable: '', type: 'string', title: '', description: '' });
}

function addTerm() {
  form.value?.context.push({ property: '', iri: '', kind: 'literal', datatype: '', language: '' });
}

/* --------------------------------------------------------------- queries */

interface LibraryQuery { id: string; name: string; currentVersion?: string | null }
interface LoadedQueryVersion { id: string; version: number; queryString: string }

const libraryQueries = ref<LibraryQuery[]>([]);
const queryVersions = reactive<Record<string, LoadedQueryVersion[]>>({});
const signatures = reactive<Record<string, QuerySignature>>({});
const signatureError = ref<string | null>(null);

const queryOptions = computed<SearchSelectOption[]>(() =>
  [...libraryQueries.value]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((query) => ({ value: query.id, label: query.name })),
);

function queryName(id: string): string {
  return libraryQueries.value.find((query) => query.id === id)?.name ?? id;
}

function queryLink(collection: OgcServiceCollection) {
  const path = sectionPath({ section: 'queries', id: collection.query });
  const number = collection.queryVersion ? versionNumbers.value.get(collection.queryVersion) : undefined;
  return number === undefined ? path : { path, query: { version: String(number) } };
}

const versionNumbers = computed(() => {
  const numbers = new Map<string, number>();
  for (const list of Object.values(queryVersions)) for (const version of list) numbers.set(version.id, version.version);
  return numbers;
});

const formQueryVersions = computed(() =>
  [...(form.value?.query ? queryVersions[form.value.query] ?? [] : [])].sort((a, b) => b.version - a.version),
);

async function loadLibraryQueries() {
  const library = serviceLibraryId.value || activeLibraryId.value;
  if (!library) return;
  try {
    libraryQueries.value = (await apiClient.listQueries({ library })).map((query) => ({
      id: query.id,
      name: query.name,
      currentVersion: query.currentVersion ?? null,
    }));
  } catch (error) {
    console.error('[OgcServiceWorkArea] Could not list the library queries', error);
  }
}

async function ensureQueryVersions(queryId: string) {
  if (!queryId || queryVersions[queryId]) return;
  try {
    const list = await apiClient.listQueryVersions(queryId);
    queryVersions[queryId] = list.map((version) => ({ id: version.id, version: version.version, queryString: version.queryString }));
  } catch (error) {
    queryVersions[queryId] = [];
    console.error('[OgcServiceWorkArea] Could not list the versions of', queryId, error);
  }
}

watch(collections, (list) => {
  for (const collection of list) void ensureQueryVersions(collection.query);
}, { deep: true });

/** The version whose columns and parameters the selects offer: the pinned one, else the query's current one. */
const signatureVersion = computed<LoadedQueryVersion | null>(() => {
  const current = form.value;
  if (!current?.query) return null;
  const list = queryVersions[current.query] ?? [];
  if (current.queryVersion) return list.find((version) => version.id === current.queryVersion) ?? null;
  const pointer = libraryQueries.value.find((query) => query.id === current.query)?.currentVersion;
  return list.find((version) => version.id === pointer)
    ?? [...list].sort((a, b) => b.version - a.version)[0]
    ?? null;
});

const signature = computed<QuerySignature | null>(() =>
  signatureVersion.value ? signatures[signatureVersion.value.id] ?? null : null,
);

/** Set when a query is picked, so its signature fills the empty fields once it arrives. */
let suggestOnSignature = false;

watch(signatureVersion, async (version) => {
  signatureError.value = null;
  if (!version) return;
  if (!signatures[version.id]) {
    try {
      const [inputs, outputs] = await Promise.all([
        apiClient.detectInputs(version.queryString),
        apiClient.detectOutputs(version.queryString),
      ]);
      signatures[version.id] = {
        outputs,
        valuesInputs: inputs.valuesInputs,
        limitParameters: inputs.limitParameters,
        offsetParameters: inputs.offsetParameters,
      };
    } catch (error) {
      signatureError.value = error instanceof Error ? error.message : 'Could not read the query';
      return;
    }
  }
  if (suggestOnSignature && form.value && signatureVersion.value?.id === version.id) {
    suggestOnSignature = false;
    form.value = suggestMapping(form.value, signatures[version.id]!);
  }
}, { immediate: true });

function chooseQuery(queryId: string) {
  if (!form.value || form.value.query === queryId) return;
  form.value.query = queryId;
  form.value.queryVersion = '';
  suggestOnSignature = true;
  void ensureQueryVersions(queryId);
}

const outputs = computed(() => signature.value?.outputs ?? []);
const variables = computed(() => valuesVariables(signature.value));
const properties = computed(() => (form.value ? propertyColumns(form.value, signature.value) : []));

/** The choices, with the stored value kept even when the query no longer has it. */
function withCurrent(options: readonly string[], current: string): string[] {
  return current && !options.includes(current) ? [...options, current] : [...options];
}

/* -------------------------------------------------------------- lifecycle */

async function save() {
  if (!canSave.value) return;
  const libraryId = serviceLibraryId.value || activeLibraryId.value;
  if (!libraryId) {
    toast.error('Choose a library first.');
    return;
  }
  const missing = firstMissing(collections.value);
  if (missing) {
    saveError.value = missing.message;
    showMissing.value = true;
    editCollection(missing.index);
    return;
  }
  showMissing.value = false;
  isSaving.value = true;
  saveError.value = null;
  const wasScratch = isScratch.value;
  try {
    if (!serviceId.value) {
      const created = await store.createOgcService({
        name: serviceName.value.trim(),
        description: description.value.trim() || null,
        slug: slug.value,
        isPartOf: [libraryId],
      });
      serviceId.value = created.id;
      serviceLibraryId.value = libraryId;
    } else if (entityChanged.value) {
      await store.updateOgcService(serviceId.value, {
        name: serviceName.value.trim(),
        description: description.value.trim() || null,
        slug: slug.value,
      });
    }
    saved.name = serviceName.value.trim();
    saved.description = description.value.trim();
    saved.slug = slug.value;

    let version: OgcServiceVersion | null = null;
    if (collectionsChanged.value || (wasScratch && collections.value.length > 0)) {
      version = await store.createVersion(serviceId.value!, { collections: clone(collections.value) });
      currentVersionId.value = version.id;
      loadedVersionId.value = version.id;
      saved.collections = clone(collections.value);
      loadedCollections.value = clone(collections.value);
    }

    const id = serviceId.value!;
    const [entity, list] = await Promise.all([store.getOgcService(id), store.loadVersions(id)]);
    problems.value = entity.problems;
    versions.value = list;
    cancelDraftSave();
    removeDraft();
    toast.success(version ? `Saved v${version.version}` : 'Saved');

    if (wasScratch) {
      if (props.scratchId) draftsStore.remove(props.scratchId);
      emit('scratch-saved', { id, name: saved.name, libraryId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save the OGC service';
    saveError.value = message;
    toast.error(message);
  } finally {
    isSaving.value = false;
  }
}

async function removeService() {
  if (!serviceId.value) return;
  isDeleting.value = true;
  try {
    await store.deleteOgcService(serviceId.value);
    removeDraft();
    emit('ogc-service-deleted');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to delete the OGC service');
  } finally {
    isDeleting.value = false;
  }
}

let loadSequence = 0;

function clearRecord() {
  serviceLibraryId.value = null;
  serviceCreatedAt.value = null;
  loadedVersionId.value = null;
  loadedCollections.value = [];
  problems.value = [];
  versions.value = [];
  currentVersionId.value = null;
  saved.name = '';
  saved.description = '';
  saved.slug = '';
  saved.collections = [];
  selectedIndex.value = null;
}

async function load(id: string) {
  const sequence = ++loadSequence;
  hydratingRecord.value = true;
  try {
    const [service, serviceVersions] = await Promise.all([
      store.getOgcService(id),
      store.loadVersions(id).catch((error: unknown) => {
        console.error('[OgcServiceWorkArea] Could not read the versions of', id, error);
        return [] as OgcServiceVersion[];
      }),
    ]);
    if (sequence !== loadSequence) return;

    serviceName.value = service.name;
    description.value = service.description ?? '';
    slug.value = service.slug;
    problems.value = service.problems;
    currentVersionId.value = service.currentVersion ?? null;
    serviceCreatedAt.value = service.dateCreated ?? null;
    serviceLibraryId.value = service.isPartOf[0] ?? null;
    versions.value = serviceVersions;

    const current = serviceVersions.find((version) => version.id === service.currentVersion) ?? serviceVersions.at(-1);
    saved.name = service.name;
    saved.description = service.description ?? '';
    saved.slug = service.slug;
    saved.collections = clone(current?.collections ?? []);
    loadedVersionId.value = current?.id ?? null;
    loadedCollections.value = clone(saved.collections);

    const draft = openDraft.value?.body as OgcServiceBody | undefined;
    collections.value = clone(draft?.collections ?? saved.collections);
    if (draft) applyEditorBody(draft);
    selectedIndex.value = null;
    void loadLibraryQueries();
  } catch (error) {
    if (sequence === loadSequence) {
      clearRecord();
      serviceName.value = '';
      description.value = '';
      slug.value = '';
      collections.value = [];
    }
    toast.error(error instanceof Error ? error.message : 'Failed to load the OGC service');
  } finally {
    await Promise.resolve();
    if (sequence === loadSequence) hydratingRecord.value = false;
  }
}

onMounted(() => {
  if (props.ogcServiceId) void load(props.ogcServiceId);
  else void loadLibraryQueries();
});

watch(
  () => props.ogcServiceId,
  (next) => {
    cancelDraftSave();
    serviceId.value = next ?? null;
    saveError.value = null;
    if (next) {
      void load(next);
      return;
    }
    loadSequence += 1;
    clearRecord();
  },
);

watch(activeLibraryId, () => {
  if (!serviceLibraryId.value) void loadLibraryQueries();
});
</script>

<style scoped>
.ogc-service-work-area {
  position: relative;
  display: flex;
  height: 100%;
  background: var(--surface-raised);
}

.left-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--surface);
  overflow: hidden;
  transition: width 0.3s ease;
  will-change: width;
}

.left-panel.resizing {
  transition: none;
}

.right-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 48px;
  background: var(--surface);
  overflow: hidden;
  transition: flex 0.3s ease, min-width 0.3s ease;
}

.right-panel.collapsed {
  flex: 0 0 48px;
  max-width: 48px;
}

.vertical-resizer {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 8px;
  background: var(--surface-raised);
  cursor: col-resize;
  transition: opacity 0.3s ease, width 0.3s ease;
}

.vertical-resizer.hidden {
  width: 0;
  opacity: 0;
  pointer-events: none;
}

.vertical-resizer:hover {
  background: var(--action);
}

.vertical-resizer .resizer-handle {
  width: 2px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--gray-600);
  pointer-events: none;
}

.vertical-resizer:hover .resizer-handle {
  background: var(--surface);
}

.body {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-7);
  padding: var(--space-5);
  overflow-y: auto;
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.group-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.add-button {
  margin-left: auto;
}

.help-link {
  display: inline-flex;
  color: var(--ink-muted);
}

.help-link:hover {
  color: var(--action);
}

.service-fields,
.field-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-4);
}

.slug-input {
  width: var(--grid-6);
}

.url-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.url-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-body);
  text-overflow: ellipsis;
  white-space: nowrap;
}

a.url-text:hover {
  color: var(--action);
  text-decoration: underline;
}

.url-text--pending {
  color: var(--ink-muted);
}

.map-link {
  text-decoration: none;
}

.control {
  box-sizing: border-box;
  width: 100%;
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
}

.control:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: -1px;
}

.control:disabled {
  opacity: 0.6;
}

.control-mono {
  font-family: var(--font-mono);
}


.control-area {
  height: auto;
  padding: var(--space-3) var(--space-4);
  line-height: var(--leading-normal);
  resize: vertical;
}

.control-invalid {
  border-color: var(--danger);
}

.problems {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-4) var(--space-5);
  list-style: none;
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-panel);
  background: var(--warning-surface);
  color: var(--warning-ink);
  font-size: var(--text-body);
}

.problem {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.problem-icon {
  margin-top: var(--space-1);
  color: var(--warning);
}

.table-scroll {
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.collections-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-body);
}

.collections-table th,
.collections-table td {
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
  vertical-align: middle;
}

.collections-table th,
.collections-table .mono,
.collections-table .version-cell,
.collections-table .numeric,
.collections-table .actions-cell {
  white-space: nowrap;
}

.collections-table th {
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-weight: var(--weight-medium);
}

.collections-table tbody tr {
  cursor: pointer;
}

.collections-table tbody tr:hover {
  background: var(--surface-subtle);
}

.collections-table tbody tr.selected {
  background: var(--action-surface, var(--surface-subtle));
}

.collections-table tbody tr:last-child td {
  border-bottom: none;
}

.collections-table .numeric {
  text-align: right;
}

.collections-table .mono {
  font-family: var(--font-mono);
}

.collections-table .actions-cell {
  width: 1%;
  text-align: right;
}

.cell-muted {
  color: var(--ink-muted);
}

.query-link {
  color: var(--action);
  text-decoration: none;
}

.query-link:hover {
  text-decoration: underline;
}

.collections-table tbody tr:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: -2px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-5);
  overflow-y: auto;
}

.editor-error {
  margin: 0;
}

.editor-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.field-row > * {
  flex: 1 1 var(--grid-4);
}

.field-row > .field-number {
  flex: 0 1 var(--grid-3);
}

.field-row > .field-wide {
  flex: 2 1 var(--grid-6);
}

.quad {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}

.pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.rows {
  display: grid;
  align-items: center;
  gap: var(--space-3);
}

.rows--queryables {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) var(--grid-3) minmax(0, 1fr) var(--control-h-sm);
}

.rows--terms {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) var(--grid-3) minmax(0, 1fr) var(--control-h-sm);
}

.row-head {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
}
</style>
