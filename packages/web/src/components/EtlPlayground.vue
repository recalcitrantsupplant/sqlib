<template>
  <div class="etl-playground">
    <div class="etl-work-area" ref="workAreaRef">
      <div class="main-content" :class="{ 'resizing': isResizingPanel }" :style="{ width: resultsPanelCollapsed ? 'calc(100% - 48px)' : leftPanelWidth + '%' }" ref="mainContentRef">
        <!--
          The same bar the query and group screens carry. A pipeline is an
          EtlJob with versions on the server, so Save means what it means
          everywhere else; Format and Diff are off because a pipeline is three
          bodies rather than one, and ⋮ has nothing to offer yet.
        -->
        <SaveBar
          :title="pipelineName"
          noun="pipeline"
          :is-scratch="isScratch"
          :current-version-number="currentVersionNumber"
          :edit-count="editCount"
          :saving="isSaving"
          :can-save="canSave"
          :needs-name="needsName"
          :show-format="false"
          :show-diff="false"
          :show-more="false"
          @save="save"
          @discard="discardDraft"
          @needs-name="promptForNameInDetails"
        />

        <!--
          The run, as one sentence (design 3b), the same row the query, group
          and rules screens carry.

          It is a shorter sentence here, and deliberately so. A pipeline has no
          "with" clause: its SQL, its mappings and its template are the
          definition, not inputs bound to it at run time — there is no ETL
          equivalent of an argument set or a tuple set to name. Nor is there a
          "create test / benchmark" pair: `subjectKinds.ts` knows three subject
          kinds (query, query group, rule set) and a benchmark's subject spec
          points at a query or group version, so an EtlJob is not something
          either object can currently be about.
        -->
        <ExpandRunStrip>
          <RunBar
            :running="isExecuting"
            :run-disabled="!canExecute"
            :run-title="canExecute ? 'Run this pipeline' : 'Needs SQL, a template, a mapping and a backend'"
            :backend="{ value: selectedBackendId, options: backendOptions, loading: backendsLoading, title: 'The store the generated RDF is written to' }"
            :format="{ value: outputFormat, options: rdfFormatOptions, title: 'The format the generated RDF comes back in' }"
            :download-disabled="!executionResult"
            @run="executeEtl"
            @update:backend="(value) => (selectedBackendId = value)"
            @update:format="(value) => (outputFormat = value)"
          />
        </ExpandRunStrip>
        <!--
          The three stacked panes and their dividers live in their own box so a
          drag can measure against the panes alone; the save bar above and
          the run strip below are not part of the space being divided up.
        -->
        <div class="editor-stack" ref="editorStackRef">

        <!-- SQL Editor (Top) -->
        <!--
          A third of a column each is what three stacked panes leave one
          another, which is the case for popping one out: the run strip comes
          with it, so the pipeline can still be run while one of its three
          documents has the screen.
        -->
        <ExpandableEditor v-slot="{ expanded: sqlExpanded, toggle: toggleSql }" title="DuckDB SQL Query" testid="etl-sql-expand">
        <div
          class="editor-section sql-section"
          :style="{ flexGrow: sqlHeight }"
        >
          <PanelHeader title="DuckDB SQL Query" sunken>
            <template #actions>
              <select
                v-model="selectedExample"
                @change="onExampleChange"
                class="example-select"
                title="Load example query"
              >
                <option value="">Load example...</option>
                <option v-for="example in sqlExamples" :key="example.label" :value="example.label">
                  {{ example.label }}
                </option>
              </select>
              <button
                @click="peekSqlResults"
                class="btn-peek"
                :disabled="!sqlQuery.trim() || isPeeking"
                title="Preview first 10 rows of query output"
              >
                <Eye :size="14" />
                {{ isPeeking ? 'Loading...' : 'Peek' }}
              </button>
              <ExpandButton
                v-if="!sqlExpanded"
                subject="the SQL query"
                testid="etl-sql-expand-button"
                @click="toggleSql"
              />
            </template>
          </PanelHeader>
          <div class="editor-wrapper">
            <Codemirror
              v-model="sqlQuery"
              :extensions="sqlExtensions"
              placeholder="SELECT * FROM read_csv('data/examples/people.csv')"
              class="code-editor"
            />
          </div>
        </div>
        </ExpandableEditor>

        <!-- Horizontal Resizer 1 -->
        <div
          class="horizontal-resizer"
          ref="resizer1Ref"
          @mousedown="startResizeSql"
          :class="{ resizing: isResizingSql }"
        ></div>

        <!-- Column Mapping (Middle) -->
        <div
          class="mapping-section"
          :style="{ flexGrow: mappingHeight }"
        >
          <!--
            The mapping is where the pipeline's *table* is described — which
            SQL column becomes which variable, and as what term — so the second
            output target hangs here rather than on the run bar. The run bar's
            sentence ends in a backend, and this one does not end in a backend
            at all: it keeps the rows themselves (#211).
          -->
          <PanelHeader title="Column Mapping" sunken>
            <template #actions>
              <TupleSetSink
                v-if="tupleSetsEnabled"
                :etl-job-version-id="currentVersionId"
                :version-number="currentVersionNumber"
                :job-name="pipelineName"
                :library-id="activeLibraryId"
                :blocked-reason="tupleSinkBlockedReason"
              />
            </template>
          </PanelHeader>
          <div class="mapping-content">
            <EmptyState
              v-if="columnMappings.length === 0"
              size="sm"
              boxed
              class="inset-well"
              title="No columns detected"
              description="Enter a SQL query above and the columns come from its result schema."
            />

            <div v-else class="mappings-table">
              <div class="table-header">
                <div class="col-sql-var">SQL Column</div>
                <div class="col-sql-type">SQL Type</div>
                <div class="col-sparql-var">SPARQL Variable</div>
                <div class="col-term-type">Term Type</div>
                <div class="col-datatype">Datatype</div>
              </div>
              <div class="table-body">
                <div v-for="(mapping, index) in columnMappings" :key="index" class="mapping-row">
                  <div class="col-sql-var">
                    <span class="sql-col-name">{{ mapping.columnName }}</span>
                  </div>
                  <div class="col-sql-type">
                    <span class="sql-type">{{ getSqlType(mapping.columnName) }}</span>
                  </div>
                  <div class="col-sparql-var">
                    <input v-model="mapping.targetVariable" @input="onMappingEdit" placeholder="?var" />
                  </div>
                  <div class="col-term-type">
                    <select v-model="mapping.termType" @change="onMappingEdit">
                      <option value="literal">Literal</option>
                      <option value="uri">IRI</option>
                    </select>
                  </div>
                  <div class="col-datatype">
                    <template v-if="mapping.termType === 'literal'">
                      <select
                        :value="getDatatypeDisplayValue(mapping.datatypeIri)"
                        @change="onDatatypeChange(index, ($event.target as HTMLSelectElement).value)"
                        class="datatype-select"
                      >
                        <option value="xsd:string">xsd:string</option>
                        <option value="xsd:integer">xsd:integer</option>
                        <option value="xsd:decimal">xsd:decimal</option>
                        <option value="xsd:double">xsd:double</option>
                        <option value="xsd:float">xsd:float</option>
                        <option value="xsd:boolean">xsd:boolean</option>
                        <option value="xsd:date">xsd:date</option>
                        <option value="xsd:dateTime">xsd:dateTime</option>
                        <option value="xsd:time">xsd:time</option>
                        <option value="custom">Custom...</option>
                      </select>
                      <input
                        v-if="getDatatypeDisplayValue(mapping.datatypeIri) === 'custom'"
                        v-model="mapping.datatypeIri"
                        @input="onMappingEdit"
                        placeholder="http://example.org/custom"
                        class="datatype-custom-input"
                      />
                    </template>
                    <span v-else class="iri-note">N/A</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Horizontal Resizer 2 -->
        <div
          class="horizontal-resizer"
          ref="resizer2Ref"
          @mousedown="startResizeMapping"
          :class="{ resizing: isResizingMapping }"
        ></div>

        <!-- SPARQL Template Editor (Bottom) -->
        <ExpandableEditor v-slot="{ expanded: templateExpanded, toggle: toggleTemplate }" title="SPARQL Template" testid="etl-template-expand">
        <div
          class="editor-section sparql-section"
          :style="{ flexGrow: sparqlHeight }"
        >
          <PanelHeader title="SPARQL Template" sunken>
            <template #actions>
              <ExpandButton
                v-if="!templateExpanded"
                subject="the SPARQL template"
                testid="etl-template-expand-button"
                @click="toggleTemplate"
              />
            </template>
          </PanelHeader>
          <div class="editor-wrapper">
            <Codemirror
              v-model="sparqlTemplate"
              :extensions="sparqlExtensions"
              @update:model-value="onSparqlEdit"
              placeholder="CONSTRUCT { ?person a :Person ; :name ?name } WHERE { VALUES (?name) { (UNDEF) } }"
              class="code-editor"
            />
          </div>
        </div>
        </ExpandableEditor>

        </div>

        <!--
          The status strip below the panes: how big the template is, and
          whether this browser is holding an unsaved body. The run controls it
          used to carry moved to the run bar at the top of the column.
        -->
        <QueryEditorFooter
          validation-state="idle"
          :query-type-label="null"
          :sparql-code="sparqlTemplate"
          :show-validity="false"
        />

      </div>

      <!-- Vertical Resizer -->
      <div
        class="vertical-resizer"
        :class="{ 'hidden': resultsPanelCollapsed }"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the results panel"
        title="Drag to resize · double-click to reset"
        @mousedown="startPanelResize"
        @dblclick="resetPanelWidth"
      >
        <div class="resizer-handle"></div>
      </div>

      <!--
        The same inspector queries and groups carry. Results is drawn only once
        a run has produced something — an empty Results tab on a screen you have
        not run yet is a tab that can only disappoint — but Details is always
        there, because naming the pipeline is what saving needs.
      -->
      <div class="results-panel" :class="{ collapsed: resultsPanelCollapsed }">
        <InspectorPanel
          v-model:active-tab="activeInspectorTab"
          v-model:collapsed="resultsPanelCollapsed"
          :tabs="inspectorTabs"
        >
          <!--
            Tabs and nothing else: the response's own actions — download, pop
            out — and its run facts live with the response, in the results
            action bar and footer below.
          -->

          <template #details>
            <EntityDetailsPanel
              ref="detailsPanelRef"
              v-bind="detailsProps"
              @update:name="pipelineName = $event"
              @update:description="pipelineDescription = $event"
              @select-version="loadVersion"
              @annotate-version="annotateVersion"
              @copy-id="copyEtlJobId"
            />
          </template>

          <template #results>
            <div class="result-content">
              <div class="result-stats">
                <span class="stat">{{ executionResult?.totalRows ?? 0 }} rows</span>
                <span class="stat">{{ executionResult?.totalChunks ?? 0 }} chunks</span>
              </div>
              <div v-if="executionResult?.errorMessage" class="error-banner">
                {{ executionResult.errorMessage }}
              </div>
              <QueryResultsViewer
                v-else
                :raw-content="executionResult?.rdfOutput"
                :content-type="executionResult?.contentType"
                :loading="false"
                download-base-name="etl-results"
                :timing="etlTiming"
                :timing-detail="timingTooltip"
                :can-expand="!!executionResult"
                @expand="showResultsFocus = true"
              />
            </div>
          </template>

          <!-- Tests Tab: the Tests section, filtered to this pipeline -->
          <template #tests>
            <div class="tab-pane scrollable">
              <SubjectTestsPanel
                v-if="testSubjectId"
                :subject-id="testSubjectId"
                subject-noun="pipeline"
                @open="(testId) => emit('open-entity', { type: 'test', id: testId })"
              />
            </div>
          </template>
        </InspectorPanel>
      </div>
    </div>

    <!-- Focus Mode Overlay -->
    <div v-if="showResultsFocus && executionResult" class="focus-overlay" @click.self="showResultsFocus = false">
      <div class="focus-container">
        <PanelHeader title="ETL Execution Results" size="lg" sunken>
          <template #meta>
            <div class="result-stats">
              <span class="stat">{{ executionResult.totalRows }} rows</span>
              <span class="stat">{{ executionResult.totalChunks }} chunks</span>
            </div>
          </template>
          <template #actions>
            <button class="btn-icon" title="Close Focus Mode" @click="showResultsFocus = false">
              <X :size="20" />
            </button>
          </template>
        </PanelHeader>
        <div class="focus-content">
          <div v-if="executionResult.errorMessage" class="error-banner">
            {{ executionResult.errorMessage }}
          </div>
          <QueryResultsViewer
            v-else
            :raw-content="executionResult.rdfOutput"
            :content-type="executionResult.contentType"
            :loading="false"
            :timing="etlTiming"
            :timing-detail="timingTooltip"
          />
        </div>
      </div>
    </div>

    <!-- Peek Focus Mode Overlay -->
    <div v-if="showPeekFocus && peekResult" class="focus-overlay" @click.self="showPeekFocus = false">
      <div class="focus-container peek-focus">
        <PanelHeader title="SQL Query Preview" size="lg" sunken>
          <template #meta>
            <div class="result-stats">
              <span class="stat">{{ peekResult.rows.length }} rows</span>
              <span class="stat">{{ peekResult.schema.length }} columns</span>
              <span class="stat peek-badge">LIMIT 10</span>
            </div>
          </template>
          <template #actions>
            <button class="btn-icon" title="Close Preview" @click="showPeekFocus = false">
              <X :size="20" />
            </button>
          </template>
        </PanelHeader>
        <div class="focus-content">
          <EmptyState
            v-if="peekResult.rows.length === 0"
            size="sm"
            boxed
            class="inset-well"
            title="Query returned no rows"
          />
          <div v-else class="peek-table-container">
            <table class="peek-table">
              <thead>
                <tr>
                  <th v-for="col in peekResult.schema" :key="col.columnName">
                    <div class="peek-th-content">
                      <span class="peek-col-name">{{ col.columnName }}</span>
                      <span class="peek-col-type">{{ col.duckdbType }}</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in peekResult.rows" :key="rowIndex">
                  <td v-for="col in peekResult.schema" :key="col.columnName">
                    <span class="peek-cell-value">{{ formatCellValue(row[col.columnName]) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, onUnmounted, watch } from 'vue';
import { useRuntimeConfig } from '#imports';
import { Codemirror } from 'vue-codemirror';
import ExpandableEditor from './shared/ExpandableEditor.vue';
import { useEditorAsPrefixTarget } from '@/composables/usePrefixTarget';
import { prefixSourceToken } from '@/lib/prefixSources';
import { usePrefixDiscovery } from '@/composables/usePrefixDiscovery';
import ExpandButton from './shared/ExpandButton.vue';
import ExpandRunStrip from './shared/ExpandRunStrip.vue';
import { languageExtensionsFor } from '../lib/codeLanguage';
import { X, Eye } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { EPHEMERAL_BACKEND_ID, EPHEMERAL_BACKEND_LABEL } from '@sparql-query-lib/types';
import QueryResultsViewer from './QueryResultsViewer.vue';
import QueryEditorFooter from './query-work-area/QueryEditorFooter.vue';
import RunBar from './shared/RunBar.vue';
import SaveBar from './shared/SaveBar.vue';
import InspectorPanel, { type InspectorTab } from './shared/InspectorPanel.vue';
import EntityDetailsPanel from './shared/EntityDetailsPanel.vue';
import SubjectTestsPanel from './tests/SubjectTestsPanel.vue';
import EmptyState from './shared/EmptyState.vue';
import PanelHeader from './shared/PanelHeader.vue';
import TupleSetSink from './etl/TupleSetSink.vue';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { useTestsSurface } from '../composables/useTestsSurface';
import { usePanelResize } from '../composables/usePanelResize';
import { useBackendsStore } from '../composables/useBackendsStore';
import { useExecuteKeymap } from '../composables/useExecuteKeymap';
import { useScratchRecord } from '../composables/useScratchRecord';
import { useCallableDrafts, UNASSIGNED_LIBRARY_ID } from '../composables/useCallableDrafts';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useEtlJobsStore, type EtlJobVersion } from '../composables/useEtlJobsStore';
import { rdfSyntaxHighlighting } from '../lib/codemirrorHighlight';

const config = useRuntimeConfig();

interface ColumnMapping {
  columnName: string;
  targetVariable: string;
  termType: 'uri' | 'literal';
  datatypeIri?: string;
  lang?: string;
  nullPolicy: 'undef' | 'skipRow';
}

interface PreviewSchema {
  columnName: string;
  duckdbType: string;
  nullable: boolean;
}

interface SqlExample {
  label: string;
  sql: string;
}

// SQL Examples for the playground
const sqlExamples: SqlExample[] = [
  {
    label: 'People (local CSV)',
    sql: `SELECT * FROM read_csv('data/examples/people.csv')`,
  },
  {
    label: 'Books (local CSV)',
    sql: `SELECT * FROM read_csv('data/examples/books.csv')`,
  },
  {
    label: 'Products (local CSV)',
    sql: `SELECT * FROM read_csv('data/examples/products.csv')`,
  },
  {
    label: 'NZ Greenhouse Gas Emissions (remote CSV)',
    sql: `SELECT * FROM read_csv('https://www.stats.govt.nz/assets/Uploads/Greenhouse-gas-emissions-by-region-industry-and-household/Greenhouse-gas-emissions-by-region-industry-and-household-Year-ended-2024/Download-data/greenhouse-gas-emissions-by-region-industry-and-household-year-ended-2024.csv')`,
  },
  {
    label: 'CrossRef RAG/LLM Papers (remote JSON API)',
    sql: `SELECT facet_name, facet_value, facet_count
FROM (
  -- saved facet (years)
  SELECT
    'saved' AS facet_name,
    p.key AS facet_value,
    CAST(p.value AS BIGINT) AS facet_count
  FROM read_json_auto(
    'https://api.crossref.org/works?query.title=retrieval%20augmented%20generation%20RAG%20LLM&filter=from-pub-date:2022-01-01,until-pub-date:2025-12-31,type:journal-article&rows=100&facet=saved:*,type-name:*&select=DOI,title,author,saved,container-title,URL,type&mailto=you@example.com'
  ) r,
  json_each(to_json(r.message.facets.saved.values)) p

  UNION ALL

  -- type-name facet (work types)
  SELECT
    'type-name' AS facet_name,
    t.key AS facet_value,
    CAST(t.value AS BIGINT) AS facet_count
  FROM read_json_auto(
    'https://api.crossref.org/works?query.title=retrieval%20augmented%20generation%20RAG%20LLM&filter=from-pub-date:2022-01-01,until-pub-date:2025-12-31,type:journal-article&rows=100&facet=saved:*,type-name:*&select=DOI,title,author,saved,container-title,URL,type&mailto=you@example.com'
  ) r,
  json_each(to_json(r.message.facets."type-name".values)) t
) x
WHERE facet_value IS NOT NULL`,
  },
];

// RDF output format options
const rdfFormatOptions = [
  { value: 'application/n-triples', label: 'N-Triples' },
  { value: 'text/turtle', label: 'Turtle' },
  { value: 'application/rdf+xml', label: 'RDF/XML' },
  { value: 'application/ld+json', label: 'JSON-LD' },
];

// State
const selectedExample = ref('');
const sqlQuery = ref(`SELECT * FROM read_csv('data/examples/people.csv')`);
const sparqlTemplate = ref('');

/*
 * Where the Prefix Manager's "Add to editor" lands on this screen: the SPARQL
 * template. The SQL beside it has no prefixes to declare.
 */
useEditorAsPrefixTarget({
  label: 'the template',
  contentType: 'application/sparql-query',
  read: () => sparqlTemplate.value,
  write: (text) => { sparqlTemplate.value = text; },
});
const selectedBackendId = ref(EPHEMERAL_BACKEND_ID);
const outputFormat = ref('text/turtle');
const columnMappings = ref<ColumnMapping[]>([]);
const previewSchema = ref<PreviewSchema[]>([]);
const isExecuting = ref(false);
// intentional any: holds opaque untyped ETL execution JSON from the API
const executionResult = ref<any>(null);

// Auto-generation state
const hasUserEditedSparql = ref(false);
let autoDetectTimeout: NodeJS.Timeout | null = null;

// Panel state
const workAreaRef = ref<HTMLElement | null>(null);
const mainContentRef = ref<HTMLElement | null>(null);
const editorStackRef = ref<HTMLElement | null>(null);
const resizer1Ref = ref<HTMLElement | null>(null);
const resizer2Ref = ref<HTMLElement | null>(null);

// Section sizes, as flex-grow weights summing to 100. They are weights rather
// than `height: x%` so the two 4px dividers come off the top before the split
// is applied — with percentages the three panes plus the dividers overflowed
// the stack and the browser shrank them all, so a pane never ended up the size
// the number said it was.
const sqlHeight = ref(30);
const mappingHeight = ref(30);
const sparqlHeight = ref(40);
const MIN_SECTION_PERCENT = 10;

// Resizing state
const isResizingSql = ref(false);
const isResizingMapping = ref(false);

// Results panel state
const showResultsFocus = ref(false);
const activeInspectorTab = ref<string>('details');

// Peek state
const isPeeking = ref(false);
const peekResult = ref<{ schema: PreviewSchema[]; rows: Record<string, unknown>[] } | null>(null);
const showPeekFocus = ref(false);

// Panel sizing (left/right split)
const {
  panelWidthPercent: leftPanelWidth,
  startResize: startPanelResize,
  isResizing: isResizingPanel,
  collapsed: resultsPanelCollapsed,
  resetWidth: resetPanelWidth,
} = usePanelResize({
  containerRef: workAreaRef,
  storageKey: 'etl',
  collapsible: true,
  initialWidthPercent: 60,
});

/* ------------------------------------------------------------------ *
 * A pipeline is scratch until it is saved, then it is an EtlJob.
 *
 * This screen had no persistence at all: a reload lost the SQL, the mappings
 * and the template together. The scratch record fixed the reload; what it did
 * not fix was that a pipeline could never leave the browser, because nothing
 * here had ever been wired to the `/etl-jobs` endpoints the server already
 * had. It is wired now, so ETL saves the way queries and groups save: Save
 * creates the job and its v1, and a saved pipeline's Save creates vN+1
 * (nav doc §1).
 *
 * The three bodies — SQL, column mappings, SPARQL template — go into one
 * version, because they are one thing: a mapping that does not match the SQL
 * it was inferred from is not a state worth being able to save.
 * ------------------------------------------------------------------ */

const props = defineProps<{
  scratchId: string | null;
  /** Set when a saved pipeline is open; mutually exclusive with `scratchId`. */
  etlJobId?: string | null;
}>();

const emit = defineEmits<{
  'scratch-saved': [payload: { id: string; name: string; libraryId: string }];
  /**
   * A row in the Tests tab was clicked; the page decides where that goes. The
   * payload is shaped like the query and group screens' so one handler on the
   * page serves all three.
   */
  'open-entity': [payload: { type: 'test' | 'benchmark'; id: string }];
}>();

const pipelineName = ref('Untitled pipeline');
const pipelineDescription = ref('');
const DEFAULT_SQL = `SELECT * FROM read_csv('data/examples/people.csv')`;

interface EtlScratchBody {
  sql?: string;
  sparqlTemplate?: string;
  outputFormat?: string;
  backendId?: string;
  columnMappings?: ColumnMapping[];
  hasUserEditedSparql?: boolean;
}

/*
 * The SPARQL template is an editor like any other, so it learns prefixes like
 * any other — this one holds its own CodeMirror rather than the shared panel,
 * which is why the discovery is wired here by hand.
 */
const prefixSource = computed(() =>
  prefixSourceToken('etl', props.scratchId ?? props.etlJobId ?? null),
);
usePrefixDiscovery(() => sparqlTemplate.value, () => prefixSource.value);

const { isScratch, savedAt: scratchSavedAt, flush: flushScratch } = useScratchRecord({
  scratchId: () => props.scratchId,
  missingMessage: 'That pipeline is not in this browser',
  track: [sqlQuery, sparqlTemplate, outputFormat, selectedBackendId, columnMappings, pipelineName, pipelineDescription],
  hydrate: (record) => {
    const body = (record.body ?? {}) as EtlScratchBody;
    pipelineName.value = record.name;
    pipelineDescription.value = record.description ?? '';
    sqlQuery.value = body.sql ?? DEFAULT_SQL;
    sparqlTemplate.value = body.sparqlTemplate ?? '';
    outputFormat.value = body.outputFormat ?? 'text/turtle';
    selectedBackendId.value = body.backendId ?? EPHEMERAL_BACKEND_ID;
    columnMappings.value = body.columnMappings ? [...body.columnMappings] : [];
    /*
     * Carried across too, because it is not a preference — it is the record of
     * whether the template is the user's or the auto-generator's, and losing it
     * means the next schema change silently overwrites hand-written SPARQL.
     */
    hasUserEditedSparql.value = body.hasUserEditedSparql ?? false;
  },
  collect: (record) => ({
    name: pipelineName.value || record.name,
    description: pipelineDescription.value || null,
    body: {
      sql: sqlQuery.value,
      sparqlTemplate: sparqlTemplate.value,
      outputFormat: outputFormat.value,
      backendId: selectedBackendId.value,
      columnMappings: [...columnMappings.value],
      hasUserEditedSparql: hasUserEditedSparql.value,
    },
  }),
});

/* ------------------------------------------------------------------ *
 * Saved pipelines.
 * ------------------------------------------------------------------ */

const etlJobsStore = useEtlJobsStore();
const draftsStore = useCallableDrafts();
const { activeLibraryId } = useActiveLibrary();

const isSaving = ref(false);
const isLoadingJob = ref(false);
const jobVersions = ref<EtlJobVersion[]>([]);
const selectedVersionId = ref<string | null>(null);
const currentVersionId = ref<string | null>(null);
const detailsPanelRef = ref<InstanceType<typeof EntityDetailsPanel> | null>(null);

const currentVersionNumber = computed(() => {
  const current = jobVersions.value.find((version) => version.id === currentVersionId.value);
  return current?.version ?? null;
});

/** A pipeline still wearing its fallback name has to be named before saving. */
const UNTITLED_PATTERN = /^Untitled pipeline \d+$/;
const needsName = computed(() => isScratch.value && UNTITLED_PATTERN.test(pipelineName.value.trim()));

/* ------------------------------------------------------------------ *
 * Unsaved edits to a saved pipeline.
 *
 * Scratch has always been safe here — a pipeline that was never saved
 * survives a reload as a scratch record. What did not was an edit to a
 * *saved* pipeline: the SQL, the mapping and the template lived in the open
 * tab and nowhere else, so closing it lost them silently, where a query or a
 * rule set would have had them waiting. With versions now snapshots (#191) a
 * draft is the only home in-progress work has, so this screen keeps one the
 * way every other section does (#190, design §7a).
 *
 * One draft over all three bodies, because they are one thing: a mapping that
 * does not match the SQL it was inferred from is not a state worth restoring
 * half of. Name and description belong to the job rather than to a version and
 * already autosave directly, so they are not in here.
 * ------------------------------------------------------------------ */

interface EtlDraftBody {
  sql?: string;
  sparqlTemplate?: string;
  backendId?: string;
  columnMappings?: ColumnMapping[];
}

/** The editor payload of the version on screen, to compare edits against. */
const savedBody = ref('');
let draftSaveHandle: ReturnType<typeof setTimeout> | null = null;

/** What the three editors hold now, in the shape a draft records it. */
function editorBody(): EtlDraftBody {
  return {
    sql: sqlQuery.value,
    sparqlTemplate: sparqlTemplate.value,
    backendId: selectedBackendId.value,
    columnMappings: columnMappings.value.map((mapping) => ({ ...mapping })),
  };
}

function applyEditorBody(body: EtlDraftBody) {
  sqlQuery.value = body.sql ?? DEFAULT_SQL;
  sparqlTemplate.value = body.sparqlTemplate ?? '';
  selectedBackendId.value = body.backendId ?? EPHEMERAL_BACKEND_ID;
  columnMappings.value = body.columnMappings ? body.columnMappings.map((mapping) => ({ ...mapping })) : [];
  // A body that was saved is the author's, never the generator's: editing the
  // mappings must not overwrite the template it came back with.
  hasUserEditedSparql.value = true;
}

const openDraft = computed(() => {
  void draftsStore.allDrafts.value;
  const id = props.etlJobId;
  return id ? draftsStore.draftFor(id) : null;
});

const editCount = computed(() => (isScratch.value ? 0 : openDraft.value?.edits ?? 0));

/* ------------------------------------------------------------------ *
 * The tuple set sink (#211).
 * ------------------------------------------------------------------ */

const { isEnabled: isFeatureEnabled } = useFeatureFlags();
const tupleSetsEnabled = computed(() => isFeatureEnabled('tupleSets'));

/**
 * Why the rows cannot be saved right now, or null when they can.
 *
 * Both refusals come from the same fact: the server runs the *saved* version's
 * SQL through the *saved* mapping. A scratch pipeline has no such version, and
 * a pipeline with unsaved edits has one that no longer says what the screen
 * says — a snapshot taken from it would carry a version id that does not
 * explain its own rows. Saving first makes both true again.
 */
const tupleSinkBlockedReason = computed(() => {
  if (isScratch.value || !props.etlJobId) {
    return 'Save this pipeline first — a stored table records which pipeline version produced it';
  }
  if (!currentVersionId.value) return 'This pipeline has no saved version yet';
  if (editCount.value > 0) {
    return 'Save your edits first — the rows come from the saved version, not the editors';
  }
  return null;
});

/** Typing back to what is saved is an undo, not an edit. */
const matchesSaved = () => JSON.stringify(editorBody()) === savedBody.value;

function persistDraft() {
  const id = props.etlJobId;
  if (!id || isScratch.value) return;
  const existing = draftsStore.draftFor(id);
  draftsStore.save({
    id: existing?.id ?? `urn:ui-temp:draft-of-${id}`,
    libraryId: activeLibraryId.value || UNASSIGNED_LIBRARY_ID,
    type: 'query',
    kind: 'draft',
    section: 'etl',
    name: pipelineName.value,
    description: pipelineDescription.value || null,
    queryString: null,
    body: editorBody(),
    resultKind: 'GRAPH',
    inputTuples: [],
    limitParameters: [],
    offsetParameters: [],
    outputs: [],
    basedOn: id,
    edits: (existing?.edits ?? 0) + 1,
  });
}

function removeDraft() {
  const id = props.etlJobId;
  if (!id) return;
  const existing = draftsStore.draftFor(id);
  if (existing) draftsStore.remove(existing.id);
}

function cancelDraftSave() {
  if (!draftSaveHandle) return;
  clearTimeout(draftSaveHandle);
  draftSaveHandle = null;
}

watch(
  [sqlQuery, sparqlTemplate, selectedBackendId, columnMappings],
  () => {
    if (isScratch.value || isLoadingJob.value || !props.etlJobId) return;
    cancelDraftSave();
    draftSaveHandle = setTimeout(() => {
      draftSaveHandle = null;
      if (matchesSaved()) {
        removeDraft();
        return;
      }
      persistDraft();
    }, 500);
  },
  { deep: true },
);

/** Throw the unsaved edits away and go back to the saved version. */
function discardDraft() {
  cancelDraftSave();
  removeDraft();
  isLoadingJob.value = true;
  applyEditorBody(JSON.parse(savedBody.value || '{}') as EtlDraftBody);
  void Promise.resolve().then(() => { isLoadingJob.value = false; });
  toast.success('Draft discarded');
}

// The same bar the SQL and the template have to satisfy to run: a pipeline
// with no mapping is not a pipeline, it is a SQL query. A saved pipeline
// also needs something to save: an unchanged body would mint a version
// identical to the last one.
const canSave = computed(() => {
  if (isSaving.value || !canExecute.value) return false;
  if (!isScratch.value && props.etlJobId) return editCount.value > 0;
  return true;
});

const detailsProps = computed(() => ({
  name: pipelineName.value,
  description: pipelineDescription.value,
  isScratch: isScratch.value,
  entityId: isScratch.value ? null : (props.etlJobId ?? null),
  entityNoun: 'pipeline',
  // The backend belongs to the version rather than to the job, and it is
  // already a field in the template editor's header.
  showBackend: false,
  // Nothing detects a pipeline's signature: its inputs are SQL columns and its
  // output is whatever the CONSTRUCT builds.
  showSignature: false,
  versionOptions: jobVersions.value.map((version) => ({
    value: version.id,
    label: String(version.version),
    comment: version.comment ?? null,
    dateModified: version.dateModified ?? null,
  })),
  selectedVersion: selectedVersionId.value,
  currentVersion: currentVersionId.value,
  canAnnotateVersions: !isScratch.value && !!props.etlJobId,
  editCount: editCount.value,
  draftSavedAt: openDraft.value?.updatedAt ?? null,
  draftSelected: false,
}));

/*
 * The note on a version, written from the row that displays it — the same
 * decision as the query and rule set screens'. Optimistic, with the old note
 * put back if the write fails.
 */
async function annotateVersion({ value, comment }: { value: string; comment: string | null }) {
  const jobId = props.etlJobId;
  const version = jobVersions.value.find((candidate) => candidate.id === value);
  if (!jobId || !version) return;

  const previous = version.comment ?? null;
  const apply = (next: string | null) => {
    jobVersions.value = jobVersions.value.map((entry) => (
      entry.id === value ? { ...entry, comment: next ?? undefined } : entry
    ));
  };
  apply(comment);

  try {
    await etlJobsStore.annotateEtlJobVersion(jobId, value, comment);
  } catch (error) {
    apply(previous);
    console.error('[EtlPlayground] Failed to save the version note', error);
    toast.error('Failed to save the note');
  }
}

function promptForNameInDetails() {
  activeInspectorTab.value = 'details';
  resultsPanelCollapsed.value = false;
  toast.info('Give it a name in the Details tab, then save');
  void nextTick(() => detailsPanelRef.value?.focusName());
}

const copyEtlJobId = async () => {
  const id = props.etlJobId;
  if (!id) {
    toast.error('This pipeline has not been saved yet');
    return;
  }
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      throw new Error('Clipboard API unavailable');
    }
    await navigator.clipboard.writeText(id);
    toast.success('Pipeline ID copied');
  } catch (error) {
    console.error('[EtlPlayground] Failed to copy pipeline ID', error);
    toast.error('Failed to copy pipeline ID');
  }
};

/**
 * Read one version — and its column mapping — into the three editors.
 *
 * Hydration, never an edit: the flag holds the autosave off, and the version
 * that lands becomes what unsaved edits are measured against. Measuring
 * against the *current* version instead would make "I am looking at v1 while
 * v2 is current" indistinguishable from "I have unsaved edits", and the
 * pill would light for changes nobody made.
 */
const applyVersion = async (version: EtlJobVersion) => {
  const wasLoading = isLoadingJob.value;
  isLoadingJob.value = true;
  try {
    selectedVersionId.value = version.id;
    sqlQuery.value = version.sql;
    sparqlTemplate.value = version.sparqlTemplate;
    selectedBackendId.value = version.backendId;
    // A saved template is by definition the author's, not the generator's, so
    // editing the mappings must never overwrite it.
    hasUserEditedSparql.value = true;
    if (version.currentColumnMappingVersionId) {
      try {
        const mapping = await etlJobsStore.fetchColumnMappingVersion(version.currentColumnMappingVersionId);
        columnMappings.value = mapping.columns.map((column) => ({ ...column })) as ColumnMapping[];
      } catch (error) {
        console.error('[EtlPlayground] Failed to load the column mapping', error);
        toast.error('Loaded the pipeline but not its column mapping');
        columnMappings.value = [];
      }
    } else {
      columnMappings.value = [];
    }
    savedBody.value = JSON.stringify(editorBody());
  } finally {
    // Cleared after the refs settle, so hydration never lands as an edit.
    await Promise.resolve();
    isLoadingJob.value = wasLoading;
  }
};

const loadVersion = async (versionId: string) => {
  const version = jobVersions.value.find((entry) => entry.id === versionId);
  if (!version) return;
  await applyVersion(version);
};

const loadEtlJob = async (id: string) => {
  isLoadingJob.value = true;
  try {
    const [job, versions] = await Promise.all([
      etlJobsStore.fetchEtlJob(id),
      etlJobsStore.loadEtlJobVersions(id),
    ]);
    pipelineName.value = job.name;
    pipelineDescription.value = job.description ?? '';
    jobVersions.value = versions;
    currentVersionId.value = job.currentVersionId ?? versions[0]?.id ?? null;
    const target = versions.find((version) => version.id === currentVersionId.value) ?? versions[0];
    if (target) await applyVersion(target);

    /*
     * A draft wins over the saved version, because it is the newer of the
     * two — the whole point of keeping it is that a reload does not lose it.
     * The saved payload stays in `savedBody` so Discard has somewhere
     * to go back to.
     */
    const draft = openDraft.value?.body;
    if (draft && typeof draft === 'object') applyEditorBody(draft as EtlDraftBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load the pipeline';
    toast.error(message);
  } finally {
    // Cleared after the refs settle, so hydration never lands as an edit. The
    // watchers above are queued when the refs change and flush on the next
    // microtask; clearing synchronously would let them run with the flag
    // already down, and reopening a pipeline would count its own draft as a
    // fresh edit every time.
    await Promise.resolve();
    isLoadingJob.value = false;
  }
};

watch(
  () => props.etlJobId,
  (id) => {
    // A pending autosave belongs to the pipeline that was open, not the one
    // being opened; letting it fire would write the old body under the new id.
    cancelDraftSave();
    savedBody.value = '';
    if (!id) return;
    void loadEtlJob(id);
  },
  { immediate: true },
);

/*
 * Identity autosave for a saved pipeline. Name and description belong to
 * the job rather than to a version, so the Details fields save directly.
 */
let identitySaveHandle: ReturnType<typeof setTimeout> | null = null;
watch([pipelineName, pipelineDescription], () => {
  const id = props.etlJobId;
  if (isScratch.value || !id || isLoadingJob.value) return;
  if (identitySaveHandle) clearTimeout(identitySaveHandle);
  identitySaveHandle = setTimeout(() => {
    identitySaveHandle = null;
    void etlJobsStore
      .updateEtlJob(id, { name: pipelineName.value, description: pipelineDescription.value || null })
      .catch((error: unknown) => {
        console.error('[EtlPlayground] Failed to save the pipeline name', error);
        toast.error(error instanceof Error ? error.message : 'Failed to save the name');
      });
  }, 600);
});

const versionPayload = () => ({
  sql: sqlQuery.value,
  sparqlTemplate: sparqlTemplate.value,
  backendId: selectedBackendId.value,
  columnMappings: columnMappings.value.map((mapping) => ({ ...mapping })),
});

/**
 * Save a scratch pipeline: create the job in the active library, then give
 * it the SQL, mapping and template as v1.
 */
async function saveScratch(name: string) {
  const libraryId = activeLibraryId.value;
  if (!libraryId) {
    toast.error('Select a library before saving');
    return;
  }
  const scratchRecordId = props.scratchId!;
  flushScratch();

  let created;
  try {
    created = await etlJobsStore.createEtlJob({
      name,
      description: pipelineDescription.value || null,
      libraryId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save';
    toast.error(`Could not save “${name}”: ${message}`);
    throw error;
  }

  // A failure here leaves the scratch record exactly where it is — the SQL and
  // the mapping are never the thing that gets lost.
  try {
    await etlJobsStore.createEtlJobVersion(created.id, { ...versionPayload(), comment: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save';
    toast.error(`Created “${name}” but could not save its first version: ${message}`);
    throw error;
  }

  draftsStore.remove(scratchRecordId);
  toast.success(`Saved “${name}” as v1`);
  emit('scratch-saved', { id: created.id, name, libraryId });
}

/*
 * Save. It takes nothing: the bar collects no note and no name, so a new
 * version starts without a comment and gets one — if it deserves one — from
 * its row in the Details tab afterwards.
 */
async function save() {
  if (isSaving.value || !canSave.value) return;
  isSaving.value = true;
  try {
    if (isScratch.value) {
      await saveScratch(pipelineName.value.trim() || 'Untitled pipeline');
      return;
    }
    const id = props.etlJobId;
    if (!id) return;
    const version = await etlJobsStore.createEtlJobVersion(id, {
      ...versionPayload(),
      comment: null,
    });
    jobVersions.value = await etlJobsStore.loadEtlJobVersions(id);
    currentVersionId.value = version.id;
    selectedVersionId.value = version.id;
    // The editors now hold a saved version, so there are no unsaved
    // edits left to keep: the draft and its pill go together. A save that
    // *failed* falls through to the catch and leaves both exactly as they were.
    savedBody.value = JSON.stringify(editorBody());
    cancelDraftSave();
    removeDraft();
    toast.success(`Saved v${version.version}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save';
    console.error('[EtlPlayground] Save failed', error);
    if (!isScratch.value) toast.error(message);
  } finally {
    isSaving.value = false;
  }
}

/**
 * The subject a test would name, or null while there is nothing to name.
 *
 * A test points at a saved entity, so a scratch pipeline has no tests and can
 * acquire none — which is why the tab is absent rather than empty, the same
 * rule the rules, query and group screens follow. `useTestsSurface` adds the
 * second absence: a build with the feature off has no tests to list either.
 */
const { testSubject } = useTestsSurface();
const testSubjectId = testSubject(() => (isScratch.value ? null : props.etlJobId));

const inspectorTabs = computed<InspectorTab[]>(() => [
  { id: 'details', label: 'Details' },
  // Nothing to show until a run has produced something.
  { id: 'results', label: 'Results', hidden: !executionResult.value },
  { id: 'tests', label: 'Tests', hidden: !testSubjectId.value },
]);

/*
 * Editor extensions. Ctrl+Enter runs the pipeline because the run button
 * borrowed from the query screen says it does, and a hint that only sometimes
 * holds is worse than no hint. `executeEtl` is defined below; the arrow defers
 * the lookup to the keypress.
 */
const runFromKeymap = useExecuteKeymap(() => executeEtl());
const sqlExtensions = [
  ...languageExtensionsFor('application/sql'),
  rdfSyntaxHighlighting,
  runFromKeymap,
];
const sparqlExtensions = [
  ...languageExtensionsFor('application/sparql-query'),
  rdfSyntaxHighlighting,
  runFromKeymap,
];

/*
 * The same list, from the same place, as the query screen's run row: the
 * in-memory store first because it needs no configuring and is never
 * unavailable, then the configured backends, then whatever this pipeline
 * already points at if that is no longer among them — so a pipeline saved
 * against a since-deleted backend shows the id rather than silently reading as
 * the first option.
 */
const backendsStore = useBackendsStore();
const backendsLoading = computed(() => backendsStore.loading.value);
const backendOptions = computed(() => {
  const optionMap = new Map<string, string>();
  optionMap.set(EPHEMERAL_BACKEND_ID, EPHEMERAL_BACKEND_LABEL);
  for (const backend of backendsStore.backends.value) {
    optionMap.set(backend.id, backend.name);
  }
  const current = selectedBackendId.value;
  if (current && !optionMap.has(current)) {
    optionMap.set(current, current);
  }
  return Array.from(optionMap.entries()).map(([value, label]) => ({ value, label }));
});

/*
 * The duration for the results footer. ETL's own split — SQL, binding, SPARQL
 * — does not map onto the query breakdown's labels, so only the total is
 * handed over as a number and the split goes across as the hover text.
 */
const etlTiming = computed(() =>
  executionResult.value?.timing
    ? { breakdown: { clientTotalMs: executionResult.value.timing.totalMs } }
    : undefined,
);

// Computed
const canExecute = computed(() => {
  return sqlQuery.value.trim() !== '' &&
         sparqlTemplate.value.trim() !== '' &&
         selectedBackendId.value !== '' &&
         columnMappings.value.length > 0;
});

const timingTooltip = computed(() => {
  const timing = executionResult.value?.timing;
  if (!timing) return '';

  const lines = [
    `SQL total: ${timing.sqlMs}ms`,
    timing.sqlInitMs != null ? `SQL init: ${timing.sqlInitMs}ms` : null,
    timing.sqlConnectionMs != null ? `SQL connect: ${timing.sqlConnectionMs}ms` : null,
    timing.sqlQueryMs != null ? `SQL query: ${timing.sqlQueryMs}ms` : null,
    timing.sqlSerializeMs != null ? `SQL serialize: ${timing.sqlSerializeMs}ms` : null,
    `Binding: ${timing.bindingMs}ms`,
    `SPARQL: ${timing.sparqlMs}ms`,
    `Total: ${timing.totalMs}ms`,
  ].filter(Boolean);

  return lines.join('\n');
});

// XSD datatype mapping
const XSD_PREFIX = 'http://www.w3.org/2001/XMLSchema#';
const XSD_DATATYPES: Record<string, string> = {
  'xsd:string': `${XSD_PREFIX}string`,
  'xsd:integer': `${XSD_PREFIX}integer`,
  'xsd:decimal': `${XSD_PREFIX}decimal`,
  'xsd:double': `${XSD_PREFIX}double`,
  'xsd:float': `${XSD_PREFIX}float`,
  'xsd:boolean': `${XSD_PREFIX}boolean`,
  'xsd:date': `${XSD_PREFIX}date`,
  'xsd:dateTime': `${XSD_PREFIX}dateTime`,
  'xsd:time': `${XSD_PREFIX}time`,
};

// Helper function to map DuckDB types to XSD datatypes (returns full IRI)
const mapDuckDbTypeToXsd = (duckdbType: string): string => {
  const typeUpper = duckdbType.toUpperCase();

  if (typeUpper.includes('VARCHAR') || typeUpper.includes('TEXT')) {
    return XSD_DATATYPES['xsd:string'];
  }
  if (typeUpper.includes('INTEGER') || typeUpper.includes('BIGINT') || typeUpper.includes('SMALLINT')) {
    return XSD_DATATYPES['xsd:integer'];
  }
  if (typeUpper.includes('DOUBLE') || typeUpper.includes('FLOAT') || typeUpper.includes('REAL')) {
    return XSD_DATATYPES['xsd:double'];
  }
  if (typeUpper.includes('DECIMAL') || typeUpper.includes('NUMERIC')) {
    return XSD_DATATYPES['xsd:decimal'];
  }
  if (typeUpper.includes('BOOLEAN') || typeUpper.includes('BOOL')) {
    return XSD_DATATYPES['xsd:boolean'];
  }
  if (typeUpper.includes('TIMESTAMP') || typeUpper.includes('DATETIME')) {
    return XSD_DATATYPES['xsd:dateTime'];
  }
  if (typeUpper.includes('DATE')) {
    return XSD_DATATYPES['xsd:date'];
  }

  return XSD_DATATYPES['xsd:string'];
};

// Helper to convert full IRI to prefixed form for display
const getDatatypeDisplayValue = (datatypeIri?: string): string => {
  if (!datatypeIri) return 'xsd:string';

  // Check if it's a known XSD datatype
  for (const [prefix, iri] of Object.entries(XSD_DATATYPES)) {
    if (datatypeIri === iri) {
      return prefix;
    }
  }

  // Custom datatype
  return 'custom';
};

// Helper to convert prefixed form to full IRI
const expandDatatype = (prefixedForm: string): string => {
  return XSD_DATATYPES[prefixedForm] || prefixedForm;
};

// Handle datatype change
const onDatatypeChange = (index: number, value: string) => {
  if (value === 'custom') {
    // Set to empty string so user can enter custom IRI
    columnMappings.value[index].datatypeIri = '';
  } else {
    // Convert prefixed form to full IRI
    columnMappings.value[index].datatypeIri = expandDatatype(value);
  }
  onMappingEdit();
};

// Handle example selection
const onExampleChange = () => {
  const example = sqlExamples.find(e => e.label === selectedExample.value);
  if (example) {
    sqlQuery.value = example.sql;
    hasUserEditedSparql.value = false; // Reset so SPARQL template regenerates
    selectedExample.value = ''; // Reset dropdown to placeholder
  }
};

// Helper to get SQL type for a column
const getSqlType = (columnName: string): string => {
  const col = previewSchema.value.find(c => c.columnName === columnName);
  return col ? col.duckdbType : '';
};

// Helper to format cell values for display in peek table
const formatCellValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '(null)';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};

// Methods
const executePreview = async () => {
  isExecuting.value = true;
  try {
    const apiBaseUrl = config.public.apiBaseUrl.replace(/\/$/, '');
    const response = await fetch(`${apiBaseUrl}/etl-jobs/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: sqlQuery.value, limit: 10 }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = errorData.error || 'Preview failed';
      toast.error(errorMessage);
      return;
    }

    const data = await response.json();
    previewSchema.value = data.schema || [];

    // Auto-generate column mappings
    if (previewSchema.value.length > 0) {
      columnMappings.value = previewSchema.value.map(col => ({
        columnName: col.columnName,
        targetVariable: col.columnName, // Same as SQL column name
        termType: 'literal' as const,
        datatypeIri: mapDuckDbTypeToXsd(col.duckdbType),
        nullPolicy: 'undef' as const,
      }));

      // Auto-generate SPARQL template if user hasn't edited it
      if (!hasUserEditedSparql.value) {
        generateSparqlTemplate();
      }
    }
  } catch (error: unknown) {
    console.error('Preview failed:', error);
    toast.error(error instanceof Error ? error.message : 'Failed to execute preview');
  } finally {
    isExecuting.value = false;
  }
};

// Peek SQL results - shows first 10 rows in a focus modal
const peekSqlResults = async () => {
  if (!sqlQuery.value.trim()) return;

  isPeeking.value = true;
  peekResult.value = null;

  try {
    const apiBaseUrl = config.public.apiBaseUrl.replace(/\/$/, '');
    const response = await fetch(`${apiBaseUrl}/etl-jobs/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: sqlQuery.value, limit: 10 }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = errorData.error || 'Peek failed';
      toast.error(errorMessage);
      return;
    }

    const data = await response.json();
    peekResult.value = {
      schema: data.schema || [],
      rows: data.rows || [],
    };
    showPeekFocus.value = true;
  } catch (error: unknown) {
    console.error('Peek failed:', error);
    toast.error(error instanceof Error ? error.message : 'Failed to peek SQL results');
  } finally {
    isPeeking.value = false;
  }
};

const generateSparqlTemplate = () => {
  if (columnMappings.value.length === 0) {
    sparqlTemplate.value = '';
    return;
  }

  const variables = columnMappings.value.map(m => m.targetVariable);
  const predicateTriples = variables.map(v => `   <https://etl/${v}> ?${v}`).join(' ;\n');
  const valuesVars = variables.map(v => `?${v}`).join(' ');
  const undefValues = variables.map(() => 'UNDEF').join(' ');

  sparqlTemplate.value = `CONSTRUCT {
  [ ${predicateTriples} ]
} WHERE {
  VALUES (${valuesVars}) {
    ( ${undefValues} )
  }
}`;
};

const onSparqlEdit = () => {
  hasUserEditedSparql.value = true;
};

const onMappingEdit = () => {
  // When user edits mappings, regenerate SPARQL if they haven't manually edited it
  if (!hasUserEditedSparql.value) {
    generateSparqlTemplate();
  }
};

/** A run is the one thing worth being taken to the Results tab for. */
const showResults = () => {
  resultsPanelCollapsed.value = false;
  activeInspectorTab.value = 'results';
};

const executeEtl = async () => {
  if (!canExecute.value) return;

  isExecuting.value = true;

  try {
    const apiBaseUrl = config.public.apiBaseUrl.replace(/\/$/, '');
    const response = await fetch(`${apiBaseUrl}/playground/etl/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: sqlQuery.value,
        sparqlTemplate: sparqlTemplate.value,
        backendId: selectedBackendId.value,
        columns: columnMappings.value,
        outputFormat: outputFormat.value,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || 'ETL execution failed';
      toast.error(errorMessage);
      executionResult.value = { status: 'failed', errorMessage };
      showResults();
      return;
    }

    const data = await response.json();
    executionResult.value = data;
    showResults();

    if (data.status === 'completed') {
      toast.success('ETL completed');
    } else {
      toast.error(data.errorMessage || 'ETL failed');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : undefined;
    executionResult.value = {
      status: 'failed',
      errorMessage: message,
    };
    showResults();
    toast.error(message || 'ETL execution failed');
  } finally {
    isExecuting.value = false;
  }
};

/*
 * Both dividers move only the two panes they sit between: the pane on the far
 * side of the stack keeps the size the user gave it. Dragging the top divider
 * used to reflow mapping and SPARQL proportionally, so the bottom divider slid
 * around on its own.
 */
const clampSection = (value: number, pairTotal: number) =>
  Math.max(MIN_SECTION_PERCENT, Math.min(pairTotal - MIN_SECTION_PERCENT, value));

// Measured once per drag: the geometry can't change while the mouse is down.
let stackGeometry: { top: number; available: number; firstResizer: number } | null = null;

const measureStack = () => {
  const stack = editorStackRef.value;
  const first = resizer1Ref.value;
  const second = resizer2Ref.value;
  if (!stack || !first || !second) return null;

  const rect = stack.getBoundingClientRect();
  // The dividers are laid out before the weights are applied, so the split is
  // over what's left once they've taken their pixels.
  const available = rect.height - first.offsetHeight - second.offsetHeight;
  if (available <= 0) return null;

  return { top: rect.top, available, firstResizer: first.offsetHeight };
};

const beginDrag = (e: MouseEvent, move: (e: MouseEvent) => void, stop: () => void) => {
  stackGeometry = measureStack();
  if (!stackGeometry) return false;

  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', stop);
  // Without this a drag across the editors selects their text.
  document.body.style.userSelect = 'none';
  e.preventDefault();
  return true;
};

const endDrag = (move: (e: MouseEvent) => void, stop: () => void) => {
  stackGeometry = null;
  document.removeEventListener('mousemove', move);
  document.removeEventListener('mouseup', stop);
  document.body.style.userSelect = '';
};

// Resizer logic for SQL section
const startResizeSql = (e: MouseEvent) => {
  if (beginDrag(e, handleResizeSql, stopResizeSql)) {
    isResizingSql.value = true;
  }
};

const handleResizeSql = (e: MouseEvent) => {
  if (!isResizingSql.value || !stackGeometry) return;

  const pairTotal = sqlHeight.value + mappingHeight.value;
  const offsetY = e.clientY - stackGeometry.top;
  const newSqlHeight = clampSection((offsetY / stackGeometry.available) * 100, pairTotal);

  sqlHeight.value = newSqlHeight;
  mappingHeight.value = pairTotal - newSqlHeight;
};

const stopResizeSql = () => {
  isResizingSql.value = false;
  endDrag(handleResizeSql, stopResizeSql);
};

// Resizer logic for Mapping section
const startResizeMapping = (e: MouseEvent) => {
  if (beginDrag(e, handleResizeMapping, stopResizeMapping)) {
    isResizingMapping.value = true;
  }
};

const handleResizeMapping = (e: MouseEvent) => {
  if (!isResizingMapping.value || !stackGeometry) return;

  const pairTotal = mappingHeight.value + sparqlHeight.value;
  // Distance from the top of the mapping pane, i.e. past the SQL pane and the
  // divider above it.
  const offsetY = e.clientY - stackGeometry.top - stackGeometry.firstResizer;
  const position = (offsetY / stackGeometry.available) * 100 - sqlHeight.value;
  const newMappingHeight = clampSection(position, pairTotal);

  mappingHeight.value = newMappingHeight;
  sparqlHeight.value = pairTotal - newMappingHeight;
};

const stopResizeMapping = () => {
  isResizingMapping.value = false;
  endDrag(handleResizeMapping, stopResizeMapping);
};

// Watch SQL query for auto-detection
watch(sqlQuery, (newQuery) => {
  // Clear existing timeout
  if (autoDetectTimeout) {
    clearTimeout(autoDetectTimeout);
  }

  // Debounce auto-detection (wait 1 second after user stops typing)
  autoDetectTimeout = setTimeout(() => {
    if (newQuery.trim()) {
      executePreview();
    }
  }, 1000);
});

onMounted(async () => {
  // The shared store, so ETL sees the same backends as everywhere else — and
  // the in-memory store it falls back to needs no fetch to exist.
  await backendsStore.loadBackends();
  if (!selectedBackendId.value) {
    selectedBackendId.value = EPHEMERAL_BACKEND_ID;
  }

  // Trigger initial preview if SQL query has default value
  if (sqlQuery.value.trim()) {
    executePreview();
  }
});

onBeforeUnmount(() => {
  if (!draftSaveHandle) return;
  cancelDraftSave();
  // Closing the tab mid-debounce should not lose the edit that was queued.
  if (!isScratch.value && props.etlJobId && !matchesSaved()) persistDraft();
});

onUnmounted(() => {
  if (autoDetectTimeout) {
    clearTimeout(autoDetectTimeout);
  }
  // Cleanup resize listeners
  document.removeEventListener('mousemove', handleResizeSql);
  document.removeEventListener('mouseup', stopResizeSql);
  document.removeEventListener('mousemove', handleResizeMapping);
  document.removeEventListener('mouseup', stopResizeMapping);
  // In case we unmount mid-drag.
  document.body.style.userSelect = '';
});
</script>

<style scoped>
.etl-playground {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.etl-work-area {
  flex: 1;
  display: flex;
  position: relative;
  overflow: hidden;
  gap: 0;
}

.main-content {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  transition: width 0.3s ease;
  flex-shrink: 0;
  will-change: width;
}

/* Disable transition while actively resizing for immediate feedback */
.main-content.resizing {
  transition: none;
}

.editor-stack {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* The three panes share the stack by flex-grow weight; a zero basis keeps the
   weights honest, and min-height: 0 lets a pane get down to its 10% floor
   instead of being propped up by its editor's content. */
.editor-section,
.mapping-section {
  flex-basis: 0;
  min-height: 0;
}

.editor-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sql-section {
  border-bottom: none;
}

.sparql-section {
  border-bottom: none;
}

.mapping-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.horizontal-resizer {
  height: 4px;
  background: var(--border-default);
  cursor: row-resize;
  transition: background 0.2s;
  flex-shrink: 0;
}

.horizontal-resizer:hover,
.horizontal-resizer.resizing {
  background: var(--action);
}

.horizontal-resizer.resizing {
  user-select: none;
}

.editor-wrapper {
  flex: 1;
  overflow: auto;
}

.code-editor {
  height: 100%;
  font-size: var(--text-body-lg);
}

.mapping-content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

/*
 * Both panes this sits in set `padding: 0`, because the table that normally
 * fills them runs edge to edge. The well is the exception, so it carries its
 * own inset — the one thing `EmptyState boxed` leaves to the caller, margin
 * being the parent's business rather than the primitive's.
 */
.inset-well {
  margin: var(--space-6);
}

.mappings-table {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.table-header {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1.5fr 1fr 2fr;
  gap: 6px;
  padding: var(--space-2) var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.table-body {
  flex: 1;
  overflow-y: auto;
}

.mapping-row {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1.5fr 1fr 2fr;
  gap: 6px;
  padding: var(--space-2) var(--space-5);
  border-bottom: 1px solid var(--border-default);
  align-items: center;
  transition: background 0.15s;
}

.mapping-row:hover {
  background: var(--surface-subtle);
}

.col-sql-var,
.col-sql-type,
.col-sparql-var,
.col-term-type,
.col-datatype {
  display: flex;
  align-items: center;
  min-height: 28px;
}

.sql-col-name {
  font-weight: 500;
  font-size: var(--text-body);
  color: var(--ink);
  font-family: monospace;
}

.sql-type {
  font-size: var(--text-label);
  color: var(--ink-muted);
  font-family: monospace;
  padding: var(--space-1) var(--space-2);
  background: var(--surface-subtle);
  border-radius: var(--radius-sm);
}

.col-sparql-var input,
.col-datatype input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: var(--text-body);
  font-family: monospace;
}

.col-term-type select,
.col-datatype select {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: var(--text-body);
}

.col-datatype {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.datatype-select {
  font-size: var(--text-label) !important;
}

.datatype-custom-input {
  font-size: var(--text-micro) !important;
  padding: var(--space-1) var(--space-2) !important;
}

.iri-note {
  font-size: var(--text-label);
  color: var(--ink-muted);
  font-style: italic;
}

/* Vertical Resizer (between main content and results panel) */
.vertical-resizer {
  width: 8px;
  /* Identical to the query and rules handles: same bar, same grip, same hover. */
  background: var(--surface-raised);
  cursor: col-resize;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.3s ease, width 0.3s ease;
}

.vertical-resizer.hidden {
  opacity: 0;
  width: 0;
  pointer-events: none;
}

.vertical-resizer:hover {
  background: var(--action);
}

.vertical-resizer .resizer-handle {
  width: 2px;
  height: 40px;
  background: var(--gray-600);
  border-radius: var(--radius-sm);
  pointer-events: none;
}

.vertical-resizer:hover .resizer-handle {
  background: var(--surface);
}

.results-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 48px;
  overflow: hidden;
  /* The border and the tab strip belong to InspectorPanel; this is the shell
     the resizer sizes. */
  transition: flex 0.3s ease, min-width 0.3s ease;
}

.results-panel.collapsed {
  flex: 0 0 48px;
  max-width: 48px;
}

.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-3);
  font-size: var(--text-title);
  color: var(--ink-muted);
  border-radius: var(--radius);
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.btn-icon:hover:not(:disabled) {
  background: var(--surface-sunken);
  color: var(--ink);
}

.btn-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.result-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.stat {
  font-size: var(--text-body);
  color: var(--ink-muted);
  padding: var(--space-2) var(--space-4);
  background: var(--surface);
  border-radius: var(--radius);
  font-weight: 500;
}

.result-content {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* The Tests tab: a list of rows, as long as the suite is. */
.tab-pane.scrollable {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.error-banner {
  padding: var(--space-5) var(--space-6);
  background: var(--danger-surface);
  color: var(--danger);
  border-bottom: 1px solid var(--danger);
  font-size: var(--text-body-lg);
}

/* Focus Mode Overlay */
.focus-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* No backdrop-filter: blurring the full viewport halves the frame rate of
     the open animation. See tests/e2e/perf/ablation.spec.ts. */
  background: rgba(0, 0, 0, 0.72);
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5vh 5vw;
  animation: fadeIn 0.12s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.focus-container {
  width: 100%;
  height: 100%;
  background: var(--surface);
  border-radius: var(--radius-xl);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.15s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.focus-content {
  flex: 1;
  overflow: auto;
  background: var(--surface);
}

/* Focus mode scrollbar */
.focus-content::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}

.focus-content::-webkit-scrollbar-track {
  background: var(--surface-subtle);
}

.focus-content::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: var(--radius-panel);
  border: 3px solid var(--surface-subtle);
}

.focus-content::-webkit-scrollbar-thumb:hover {
  background: var(--border-hover);
}

.example-select {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
  cursor: pointer;
  max-width: 200px;
}

.example-select:hover {
  border-color: var(--action);
}

.example-select:focus {
  outline: none;
  border-color: var(--action);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--action) 20%, transparent);
}

/* Peek Button */
.btn-peek {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-peek:hover:not(:disabled) {
  background: var(--surface-subtle);
  border-color: var(--action);
  color: var(--action);
}

.btn-peek:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Peek Focus Mode */
/* The accent rule is what marks this overlay as a truncated preview rather than
   a result, so it stays with the pane that means it. The fill it also set is
   `sunken`'s now, and no longer written here. */
.peek-focus :deep(.panel-header) {
  border-bottom: 2px solid var(--action);
}

.peek-badge {
  background: var(--action);
  color: var(--ink-muted);
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-full);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.peek-table-container {
  overflow: auto;
  height: 100%;
}

.peek-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-body-lg);
}

.peek-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.peek-table th {
  background: var(--surface-subtle);
  border-bottom: 2px solid var(--border-default);
  padding: var(--space-5) var(--space-6);
  text-align: left;
  font-weight: 600;
}

.peek-th-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.peek-col-name {
  font-family: monospace;
  color: var(--ink);
}

.peek-col-type {
  font-size: var(--text-label);
  color: var(--ink-muted);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.peek-table td {
  border-bottom: 1px solid var(--border-default);
  padding: var(--space-4) var(--space-6);
  vertical-align: top;
}

.peek-table tbody tr:hover {
  background: var(--surface-subtle);
}

.peek-cell-value {
  font-family: monospace;
  font-size: var(--text-body);
  word-break: break-word;
  white-space: pre-wrap;
}

.peek-table tbody tr td:first-child .peek-cell-value {
  color: var(--action);
}
</style>
