<template>
  <div class="execution-results">
    <EmptyState
      v-if="!results"
      title="Execution Results"
      description="Results from rule set execution will appear here"
    >
      <template #icon><span class="placeholder-glyph">📊</span></template>
    </EmptyState>

    <div v-else class="results-container">
      <!-- Status Badge -->
      <div class="status-section">
        <div class="status-header">
          <div class="status-header-left">
            <Badge
              :variant="statusVariant"
              class="result-status"
            >
              <component :is="statusIcon" :size="14" />
              {{ statusMessage }}
            </Badge>
          </div>
        </div>
        <p v-if="statusDetails" class="status-details">{{ statusDetails }}</p>
      </div>

      <!--
        The same action bar the query panel carries, for the same reason: what
        you are looking at, the filter over it, and what you can do to the
        response — one row, and only where a response exists. The run facts are
        in the footer below.
      -->
      <div class="results-action-bar">
        <SegmentedToggle
          v-model="viewMode"
          :options="viewOptions"
          group-label="Rule set results view"
        />
        <!--
          Tuples are working data rules write, not inference, so everything
          this toggle governs lives in the Summary — hence no toggle beside a
          Replay that has nothing to apply it to.
        -->
        <label
          v-if="hasTuples && viewMode === 'summary'"
          class="tuples-toggle"
          :class="{ on: showTuples }"
          :title="showTuples ? 'Hide the tuple store changes rules made' : 'Show the tuple store changes rules made'"
        >
          <input
            type="checkbox"
            data-testid="results-tuples-toggle"
            :checked="showTuples"
            @change="showTuples = ($event.target as HTMLInputElement).checked"
          />
          <Table2 :size="14" />
          Show Tuple Store Changes
        </label>
        <Input
          v-if="viewMode === 'graph'"
          v-model="graphFilter"
          class="results-filter"
          placeholder="Filter triples…"
          data-testid="results-graph-filter"
        />
        <div class="action-bar-right">
          <button
            v-if="hasDownloadableContent"
            type="button"
            class="btn-action"
            data-testid="results-download"
            title="Download the inference graph"
            @click="downloadInferenceGraph"
          >
            <Download :size="14" />
            <span class="btn-action-label">Inference graph</span>
          </button>
          <button
            type="button"
            class="btn-action btn-action--icon"
            data-testid="results-expand"
            title="Pop out"
            @click="showFocus = true"
          >
            <Expand :size="14" />
          </button>
        </div>
      </div>

      <RuleSetExecutionReplay
        v-if="viewMode === 'replay'"
        :results="results"
        :rule-label="ruleLabelFor"
        :abbreviate="abbreviateQuad"
      />

      <!-- Iterations Accordion -->
      <div v-if="viewMode === 'summary'" class="iterations-section">
        <SectionLabel as="h4" size="md" class="section-title">Iterations</SectionLabel>
        <Accordion type="multiple" class="iterations-accordion">
          <AccordionItem
            v-for="iteration in results.iterations"
            :key="iteration.index"
            :value="`iteration-${iteration.index}`"
          >
            <AccordionTrigger class="iteration-trigger">
              <div class="iteration-trigger-content">
                <div class="iteration-header-row">
                  <div class="iteration-title">
                    <IterationCw :size="14" />
                    <span>Iteration {{ iteration.index }}</span>
                  </div>
                  <div
                    class="iteration-delta"
                    :class="{
                      'delta-positive': iteration.delta > 0,
                      'delta-negative': iteration.delta < 0,
                      'delta-zero': iteration.delta === 0
                    }"
                  >
                    {{ iteration.delta > 0 ? '+' : '' }}{{ iteration.delta }}
                  </div>
                </div>
                <div v-if="hasTripleChanges(iteration) || (showTupleRows && hasTupleChanges(iteration))" class="iteration-triple-rows">
                  <template v-for="(rule, ruleIdx) in iteration.rules || []" :key="`rule-${iteration.index}-${ruleIdx}`">
                    <template v-for="(quad, quadIdx) in insertedTriplesFor(rule)" :key="`ins-${iteration.index}-${ruleIdx}-${quadIdx}`">
                      <div class="triple-row triple-row--added">
                        <div class="triple-rule" :title="ruleIriFor(rule)">
                          {{ quadIdx === 0 && deletedTriplesFor(rule).length === 0 ? ruleLabelFor(rule) : '' }}
                        </div>
                        <div class="triple-value">
                          <code>{{ abbreviateQuad(quad) }}</code>
                        </div>
                      </div>
                    </template>
                    <template v-for="(quad, quadIdx) in deletedTriplesFor(rule)" :key="`del-${iteration.index}-${ruleIdx}-${quadIdx}`">
                      <div class="triple-row triple-row--removed">
                        <div class="triple-rule" :title="ruleIriFor(rule)">
                          {{ quadIdx === 0 ? ruleLabelFor(rule) : '' }}
                        </div>
                        <div class="triple-value">
                          <code>{{ abbreviateQuad(quad) }}</code>
                        </div>
                      </div>
                    </template>
                    <!--
                      The tuples this rule wrote, in the same rule-then-row shape
                      as the triples above: the workspace is where a tuple rule's
                      work is visible at all, since tuples never reach the
                      inference graph.
                    -->
                    <template v-if="showTupleRows">
                      <template v-for="(tuple, tupleIdx) in tuplesFor(rule)" :key="`tup-${iteration.index}-${ruleIdx}-${tupleIdx}`">
                        <div class="triple-row triple-row--tuple">
                          <div class="triple-rule" :title="ruleIriFor(rule)">
                            {{ tupleIdx === 0 && insertedTriplesFor(rule).length === 0 && deletedTriplesFor(rule).length === 0 ? ruleLabelFor(rule) : '' }}
                          </div>
                          <div class="triple-value">
                            <code>{{ abbreviateQuad(tuple) }}</code>
                          </div>
                        </div>
                      </template>
                    </template>
                  </template>
                </div>
                <div v-else class="iteration-triple-empty">
                  <span>No triple changes</span>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div class="iteration-details">
                <!-- Metrics -->
                <div class="detail-metrics">
                  <div class="metric-item">
                    <span
                      class="metric-label"
                      :title="changesLabelTitle"
                    >{{ changesLabel }}</span>
                  </div>
                </div>

                <!-- Rules executed in this iteration -->
                <div v-if="iteration.rules?.length" class="rules-table-container">
                  <table class="rules-table">
                    <thead>
                      <tr>
                        <th class="col-rule-name">Rule</th>
                        <th class="col-triples" title="Triples this rule wrote into the evaluation graph on this pass.">Triples</th>
                        <th v-if="showTupleRows" class="col-tuples" title="Named tuples this rule wrote into the workspace. Tuples are working data — they never enter the inference graph.">Tuples</th>
                        <th class="col-timing">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(rule, ruleIdx) in iteration.rules"
                        :key="ruleIdx"
                        :class="{ 'rule-timeout': rule.timedOut }"
                      >
                        <td class="col-rule-name">
                          <span class="rule-name" :title="ruleIriFor(rule)">{{ ruleLabelFor(rule) }}</span>
                        </td>
                        <td class="col-triples">
                          <span v-if="rule.triplesInserted > 0" class="count-triples">
                            {{ rule.triplesInserted }}
                          </span>
                          <span v-else class="count-zero">—</span>
                        </td>
                        <td v-if="showTupleRows" class="col-tuples">
                          <span v-if="tuplesFor(rule).length > 0" class="count-tuples">
                            {{ tuplesFor(rule).length }}
                          </span>
                          <span v-else class="count-zero">—</span>
                        </td>
                        <td class="col-timing">
                          <div class="timing-cell">
                            <span class="duration">{{ rule.durationMs.toFixed(2) }}ms</span>
                            <Badge
                              v-if="rule.timedOut"
                              variant="destructive"
                              class="timeout-badge-inline"
                            >
                              <Clock :size="10" />
                            </Badge>
                          </div>
                        </td>
                      </tr>
                      <tr v-if="iteration.rules.length > 1" class="totals-row">
                        <td class="col-rule-name">
                          <SectionLabel size="md" class="totals-label">Total</SectionLabel>
                        </td>
                        <td class="col-triples">
                          <span class="count-total-triples">
                            {{ iteration.rules.reduce((sum, r) => sum + r.triplesInserted, 0) }}
                          </span>
                        </td>
                        <td v-if="showTupleRows" class="col-tuples">
                          <span class="count-total-tuples">
                            {{ iteration.rules.reduce((sum, r) => sum + tuplesFor(r).length, 0) }}
                          </span>
                        </td>
                        <td class="col-timing">
                          <div class="timing-cell">
                            <span class="duration-total">{{ iteration.rules.reduce((sum, r) => sum + r.durationMs, 0).toFixed(2) }}ms</span>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <!--
        The named-tuple workspace as the run left it.

        Separate from the inference graph on purpose: tuples are intermediate
        working data that never enter it, so without this section a tuple-driven
        rule set shows its plumbing nowhere and only its final triples.
      -->
      <div
        v-if="viewMode === 'summary' && showTupleRows && workspaceTuples.length"
        class="tuple-workspace-section"
      >
        <div class="section-title-row">
          <SectionLabel as="h4" size="md" class="section-title">Named Tuple Workspace</SectionLabel>
          <InlineNote as="span">{{ workspaceTuples.length }} row{{ workspaceTuples.length === 1 ? '' : 's' }} when the run ended</InlineNote>
        </div>
        <div class="tuple-workspace-rows">
          <div v-for="(tuple, idx) in workspaceTuples" :key="`workspace-${idx}`" class="triple-row triple-row--tuple">
            <div class="triple-value">
              <code>{{ abbreviateQuad(tuple) }}</code>
            </div>
          </div>
        </div>
      </div>

      <!--
        The inference graph is a third reading of the run, not a section under
        the first: promoted to a peer view so Summary / Replay / Graph are one
        control in one slot, the way Table / Raw are next door.
      -->
      <div v-if="viewMode === 'graph' && finalGraphContent" class="final-graph-content">
        <RdfContentViewer
          ref="graphTableRef"
          v-model:global-filter="graphFilter"
          :content="finalGraphContent"
          :content-type="finalGraphContentType ?? 'application/n-triples'"
          :show-metadata="false"
          :hide-toolbar="true"
          :hide-view-tabs="true"
          :hide-filter-row="true"
          :hide-row-count="true"
          :hide-pagination-bar="true"
          @state="graphTableState = $event"
        />
      </div>

      <ResultsFooter
        :table="viewMode === 'graph' ? graphTableState : null"
        row-noun="triple"
        :executed-at="executedAt"
        :media-type="viewMode === 'graph' ? finalGraphContentType ?? 'application/n-triples' : null"
        :duration-ms="totalDurationMs"
        @set-page="setGraphPage"
        @set-page-size="setGraphPageSize"
      />
    </div>

    <!-- Focus Mode Overlay -->
    <div v-if="showFocus" class="focus-overlay" @click.self="showFocus = false">
      <div class="focus-container">
        <PanelHeader title="Execution Results" size="lg" sunken>
          <template #actions>
            <button class="btn-icon" title="Close Focus Mode" @click="showFocus = false">
              <X :size="20" />
            </button>
          </template>
        </PanelHeader>
        <div class="focus-content">
          <!-- Status and Controls Bar -->
          <div class="focus-controls-bar">
            <div class="focus-controls-left">
              <Badge
                :variant="statusVariant"
                class="result-status"
              >
                <component :is="statusIcon" :size="14" />
                {{ statusMessage }}
              </Badge>
            </div>
            <div class="focus-controls-right">
              <SegmentedToggle
                v-model="viewMode"
                :options="viewOptions"
                group-label="Rule set results view"
              />
              <label
                v-if="hasTuples && viewMode === 'summary'"
                class="tuples-toggle"
                :class="{ on: showTuples }"
                :title="showTuples ? 'Hide the tuple store changes rules made' : 'Show the tuple store changes rules made'"
              >
                <input
                  type="checkbox"
                  data-testid="results-tuples-toggle"
                  :checked="showTuples"
                  @change="showTuples = ($event.target as HTMLInputElement).checked"
                />
                <Table2 :size="14" />
                Show Tuple Store Changes
              </label>
              <Input
                v-if="viewMode === 'graph'"
                v-model="graphFilter"
                class="results-filter"
                placeholder="Filter triples…"
              />
              <button
                v-if="hasDownloadableContent"
                type="button"
                class="btn-action"
                title="Download the inference graph"
                @click="downloadInferenceGraph"
              >
                <Download :size="14" />
                <span class="btn-action-label">Inference graph</span>
              </button>
            </div>
          </div>

          <RuleSetExecutionReplay
            v-if="viewMode === 'replay'"
            :results="results"
            :rule-label="ruleLabelFor"
            :abbreviate="abbreviateQuad"
          />

          <!-- Iterations in Focus Mode with 3-column layout -->
          <div v-if="viewMode === 'summary'" class="focus-iterations">
            <SectionLabel as="h4" size="md" class="focus-section-heading">Iterations</SectionLabel>
            <Accordion type="multiple" class="iterations-accordion-focus">
              <AccordionItem
                v-for="iteration in results?.iterations ?? []"
                :key="iteration.index"
                :value="`iteration-${iteration.index}`"
              >
                <AccordionTrigger class="iteration-trigger-focus">
                  <div class="iteration-trigger-content iteration-trigger-content--focus">
                    <div class="iteration-header-row">
                      <div class="iteration-title">
                        <IterationCw :size="14" />
                        <span>Iteration {{ iteration.index }}</span>
                      </div>
                      <div
                        class="iteration-delta"
                        :class="{
                          'delta-positive': iteration.delta > 0,
                          'delta-negative': iteration.delta < 0,
                          'delta-zero': iteration.delta === 0
                        }"
                      >
                        {{ iteration.delta > 0 ? '+' : '' }}{{ iteration.delta }}
                      </div>
                    </div>
                    <div v-if="hasTripleChanges(iteration) || (showTupleRows && hasTupleChanges(iteration))" class="iteration-triple-rows iteration-triple-rows--focus">
                      <template v-for="(rule, ruleIdx) in iteration.rules || []" :key="`focus-rule-${iteration.index}-${ruleIdx}`">
                        <template v-for="(quad, quadIdx) in insertedTriplesFor(rule)" :key="`focus-ins-${iteration.index}-${ruleIdx}-${quadIdx}`">
                          <div class="triple-row triple-row--added">
                            <div class="triple-rule" :title="ruleIriFor(rule)">
                              {{ quadIdx === 0 && deletedTriplesFor(rule).length === 0 ? ruleLabelFor(rule) : '' }}
                            </div>
                            <div class="triple-value">
                              <code>{{ abbreviateQuad(quad) }}</code>
                            </div>
                          </div>
                        </template>
                        <template v-for="(quad, quadIdx) in deletedTriplesFor(rule)" :key="`focus-del-${iteration.index}-${ruleIdx}-${quadIdx}`">
                          <div class="triple-row triple-row--removed">
                            <div class="triple-rule" :title="ruleIriFor(rule)">
                              {{ quadIdx === 0 ? ruleLabelFor(rule) : '' }}
                            </div>
                            <div class="triple-value">
                              <code>{{ abbreviateQuad(quad) }}</code>
                            </div>
                          </div>
                        </template>
                        <template v-if="showTupleRows">
                          <template v-for="(tuple, tupleIdx) in tuplesFor(rule)" :key="`focus-tup-${iteration.index}-${ruleIdx}-${tupleIdx}`">
                            <div class="triple-row triple-row--tuple">
                              <div class="triple-rule" :title="ruleIriFor(rule)">
                                {{ tupleIdx === 0 && insertedTriplesFor(rule).length === 0 && deletedTriplesFor(rule).length === 0 ? ruleLabelFor(rule) : '' }}
                              </div>
                              <div class="triple-value">
                                <code>{{ abbreviateQuad(tuple) }}</code>
                              </div>
                            </div>
                          </template>
                        </template>
                      </template>
                    </div>
                    <div v-else class="iteration-triple-empty">
                      <span>No triple changes</span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="iteration-details-focus">
                    <!-- Metrics -->
                    <div class="detail-metrics">
                      <div class="metric-item">
                        <span class="metric-label" :title="changesLabelTitle">{{ changesLabel }}</span>
                      </div>
                    </div>

                    <!-- Rules executed -->
                    <div v-if="iteration.rules?.length" class="rules-table-container">
                      <table class="rules-table">
                        <thead>
                          <tr>
                            <th class="col-rule-name">Rule</th>
                            <th class="col-triples" title="Triples this rule wrote into the evaluation graph on this pass.">Triples</th>
                            <th v-if="showTupleRows" class="col-tuples" title="Named tuples this rule wrote into the workspace. Tuples are working data — they never enter the inference graph.">Tuples</th>
                            <th class="col-timing">Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="(rule, ruleIdx) in iteration.rules"
                            :key="ruleIdx"
                            :class="{ 'rule-timeout': rule.timedOut }"
                          >
                            <td class="col-rule-name">
                              <span class="rule-name" :title="ruleIriFor(rule)">{{ ruleLabelFor(rule) }}</span>
                            </td>
                            <td class="col-triples">
                              <span v-if="rule.triplesInserted > 0" class="count-triples">
                                {{ rule.triplesInserted }}
                              </span>
                              <span v-else class="count-zero">—</span>
                            </td>
                            <td v-if="showTupleRows" class="col-tuples">
                              <span v-if="tuplesFor(rule).length > 0" class="count-tuples">
                                {{ tuplesFor(rule).length }}
                              </span>
                              <span v-else class="count-zero">—</span>
                            </td>
                            <td class="col-timing">
                              <div class="timing-cell">
                                <span class="duration">{{ rule.durationMs.toFixed(2) }}ms</span>
                                <Badge
                                  v-if="rule.timedOut"
                                  variant="destructive"
                                  class="timeout-badge-inline"
                                >
                                  <Clock :size="10" />
                                </Badge>
                              </div>
                            </td>
                          </tr>
                          <tr v-if="iteration.rules.length > 1" class="totals-row">
                            <td class="col-rule-name">
                              <SectionLabel size="md" class="totals-label">Total</SectionLabel>
                            </td>
                            <td class="col-triples">
                              <span class="count-total-triples">
                                {{ iteration.rules.reduce((sum, r) => sum + r.triplesInserted, 0) }}
                              </span>
                            </td>
                            <td v-if="showTupleRows" class="col-tuples">
                              <span class="count-total-tuples">
                                {{ iteration.rules.reduce((sum, r) => sum + tuplesFor(r).length, 0) }}
                              </span>
                            </td>
                            <td class="col-timing">
                              <div class="timing-cell">
                                <span class="duration-total">{{ iteration.rules.reduce((sum, r) => sum + r.durationMs, 0).toFixed(2) }}ms</span>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <div v-if="viewMode === 'graph' && finalGraphContent" class="focus-inference-content">
            <RdfContentViewer
              v-model:global-filter="graphFilter"
              :content="finalGraphContent"
              :content-type="finalGraphContentType ?? 'application/n-triples'"
              :show-metadata="false"
              :hide-toolbar="true"
              :hide-view-tabs="true"
              :hide-filter-row="true"
              :hide-row-count="true"
              :hide-pagination-bar="true"
              @state="graphTableState = $event"
            />
          </div>

          <ResultsFooter
            :table="viewMode === 'graph' ? graphTableState : null"
            row-noun="triple"
            :executed-at="executedAt"
            :media-type="viewMode === 'graph' ? finalGraphContentType ?? 'application/n-triples' : null"
            :duration-ms="totalDurationMs"
            @set-page="setGraphPage"
            @set-page-size="setGraphPageSize"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  CheckCircle,
  AlertCircle,
  IterationCw,
  Clock,
  X,
  Download,
  Expand,
  RefreshCw,
  AlertTriangle,
  Table2,
} from '@lucide/vue';
import InlineNote from './shared/InlineNote.vue';
import Badge from './ui/badge/Badge.vue';
import Accordion from './ui/accordion/Accordion.vue';
import AccordionItem from './ui/accordion/AccordionItem.vue';
import AccordionTrigger from './ui/accordion/AccordionTrigger.vue';
import AccordionContent from './ui/accordion/AccordionContent.vue';
import MediaTypeCodeViewer from './MediaTypeCodeViewer.vue';
import RdfContentViewer from './RdfContentViewer.vue';
import RuleSetExecutionReplay from './rules/RuleSetExecutionReplay.vue';
import EmptyState from './shared/EmptyState.vue';
import PanelHeader from './shared/PanelHeader.vue';
import ResultsFooter from './shared/ResultsFooter.vue';
import SectionLabel from './shared/SectionLabel.vue';
import SegmentedToggle from './shared/SegmentedToggle.vue';
import { Input } from './ui/input';
import type { DataTableState } from '@/composables/useDataTable';
import { usePrefixDiscovery } from '@/composables/usePrefixDiscovery';
import { usePrefixManager } from '@/composables/usePrefixManager';

interface RuleExecution {
  ruleVersionId: string;
  /** The author's `RULE <iri>`, when the SRL names the rule. */
  ruleIri?: string;
  programSource: string;
  durationMs: number;
  triplesInserted: number;
  triplesDeleted: number;
  quadSamples?: string[];
  insertedQuads?: string[];
  deletedQuads?: string[];
  /** Named tuples this rule added to the workspace, rendered `TUPLE(a, b, …)`. */
  insertedTuples?: string[];
  timedOut: boolean;
  error?: { message: string };
}

interface Iteration {
  index: number;
  signature: string;
  tripleCount: number;
  /** Rows in the named-tuple workspace at the end of this iteration. */
  tupleCount?: number;
  delta: number;
  rules?: RuleExecution[];
}

interface DataBlock {
  dataBlockVersionId: string;
  programSource: string;
  durationMs: number;
  tripleDelta: number;
  error?: { message: string };
}

interface ExecutionResults {
  status: 'converged' | 'cycle' | 'maxIterations' | 'failed' | string;
  iterations: Iteration[];
  dataBlocks?: DataBlock[];
  /** What the DATA blocks seeded — the replay starts from these. */
  seededQuads?: string[] | null;
  finalGraphNQuads?: string;
  finalGraphContent?: string;
  finalGraphContentType?: string;
  /** The named-tuple workspace as it stood when the run ended. */
  finalTuples?: string[];
  cycle?: { startIteration: number; endIteration: number };
  maxIterations?: number;
}

interface Props {
  results: ExecutionResults | null;
  executedAt?: string | null;
  /**
   * Whether the rule set opted into the rule-tuples extension.
   *
   * With the extension off there is no tuple store, so a run cannot have
   * written one: the checkbox, the Tuples column and the workspace section all
   * stay away rather than offering a view of something that cannot exist.
   * Defaults to true so a caller that has no opinion still shows whatever the
   * run reports.
   */
  tuplesEnabled?: boolean;
  /**
   * Where a prefix found in the inference graph is recorded against — the run's
   * rule set, or the backend it ran on. `null` discovers with no provenance.
   */
  prefixSource?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  executedAt: null,
  tuplesEnabled: true,
  prefixSource: null,
});

/**
 * Pop-out. A model rather than a prop so the results own the control that
 * opens it — it sits in their action bar, beside the download, because both
 * belong to the response rather than to the panel's tab strip.
 */
const showFocus = defineModel<boolean>('showFocus', { default: false });

/*
 * Summary is the whole run at once; Replay walks it a step at a time; Graph is
 * what it left behind. One trace, three readings — one control, in the slot
 * Table / Raw occupies next door.
 */
const viewMode = ref<'summary' | 'replay' | 'graph'>('summary');

const viewOptions = computed(() => [
  { value: 'summary', label: 'Summary', testId: 'results-mode-summary' },
  { value: 'replay', label: 'Replay', testId: 'results-mode-replay' },
  {
    value: 'graph',
    label: 'Graph',
    disabled: !finalGraphContent.value,
    title: finalGraphContent.value ? undefined : 'This run inferred no graph',
    testId: 'results-mode-graph',
  },
]);

/*
 * The graph table's chrome, hoisted: its filter sits on the action bar and its
 * counts and paging in the footer, so the Graph view reads exactly like the
 * query panel's Table view.
 */
const graphFilter = ref('');
const graphTableState = ref<DataTableState | null>(null);
const graphTableRef = ref<{
  setPageIndex: (index: number) => void;
  setPageSize: (size: number) => void;
} | null>(null);
const setGraphPage = (index: number) => graphTableRef.value?.setPageIndex(index);
const setGraphPageSize = (size: number) => graphTableRef.value?.setPageSize(size);

/** What the run cost, summed over every rule in every iteration. */
const totalDurationMs = computed(() => {
  const iterations = props.results?.iterations;
  if (!iterations?.length) return null;
  return iterations.reduce(
    (total, iteration) =>
      total + (iteration.rules ?? []).reduce((sum, rule) => sum + (rule.durationMs ?? 0), 0),
    0,
  );
});

/*
 * Rule labels and replay quads follow the app-wide "Abbreviate IRIs" setting.
 * There is no control here: the per-column menu that replaced the display
 * toggle belongs to a table, and neither of these is one.
 */
const { abbreviateIri, enabled: prefixEnabled } = usePrefixManager();


/**
 * What a result is attributed to: the rule's own IRI where the SRL declares one
 * (`RULE <http://example.org/reaches>`), else the id of the rule version that
 * ran. Never a friendly label invented here — the reader can look either up.
 */
const ruleIriFor = (rule: { ruleIri?: string; ruleVersionId: string }) =>
  rule.ruleIri || rule.ruleVersionId;

/**
 * The same identity, shortened for a table cell. A registered prefix wins
 * (`ex:reaches`); anything else is elided to its local name (`…:rule-1`) rather
 * than dressed in an invented prefix, so nothing on screen claims a mapping
 * that does not exist. The full IRI is always the cell's title.
 *
 * With abbreviation switched off in Settings the whole IRI is shown.
 */
const ruleLabelFor = (rule: { ruleIri?: string; ruleVersionId: string }): string => {
  const iri = ruleIriFor(rule);
  if (!prefixEnabled.value) return iri;
  const abbreviated = abbreviateIri(iri);
  if (abbreviated.wasAbbreviated) return abbreviated.abbreviated;
  const local = /[^/#:]+$/.exec(iri)?.[0];
  return local && local !== iri ? `…:${local}` : iri;
};

/**
 * Abbreviate IRIs in a quad/triple string using prefix mappings
 */
const abbreviateQuad = (quadString: string): string => {
  if (!prefixEnabled.value) return quadString;

  // Match IRIs in angle brackets: <http://example.com/...>
  return quadString.replace(/<([^>]+)>/g, (match, iri) => {
    const result = abbreviateIri(iri);
    return result.wasAbbreviated ? result.abbreviated : match;
  });
};

const statusIcon = computed(() => {
  if (!props.results) return CheckCircle;

  switch (props.results.status) {
    case 'converged':
      return CheckCircle;
    case 'cycle':
      return RefreshCw;
    case 'maxIterations':
      return AlertTriangle;
    case 'failed':
      return AlertCircle;
    default:
      return AlertCircle;
  }
});

const statusVariant = computed(() => {
  if (!props.results) return 'default';

  switch (props.results.status) {
    case 'converged':
      return 'success';
    case 'cycle':
      return 'secondary';
    case 'maxIterations':
      return 'destructive';
    case 'failed':
      return 'destructive';
    default:
      return 'destructive';
  }
});

const statusMessage = computed(() => {
  if (!props.results) return '';

  const iterationCount = props.results.iterations.length;
  const iterText = `${iterationCount} iteration${iterationCount !== 1 ? 's' : ''}`;

  switch (props.results.status) {
    case 'converged':
      return `Converged after ${iterText}`;
    case 'cycle':
      return `Cycle detected after ${iterText}`;
    case 'maxIterations':
      return `Maximum iterations reached (${iterText})`;
    case 'failed':
      return `Failed after ${iterText}`;
    default:
      return `${props.results.status} after ${iterText}`;
  }
});

const statusDetails = computed(() => {
  if (!props.results) return null;

  switch (props.results.status) {
    case 'converged':
      return null; // No details for normal convergence
    case 'cycle':
      if (props.results.cycle) {
        const { startIteration, endIteration } = props.results.cycle;
        return `A repeating pattern was detected: the graph state at iteration ${endIteration} matched iteration ${startIteration}.`;
      }
      return 'A repeating pattern of graph states was detected.';
    case 'maxIterations':
      return `A stratum reached the configured limit of ${props.results.maxIterations ?? 25} iterations without converging. The limit applies to each stratum separately, so a run with several strata may report more iterations than the limit.`;
    case 'failed':
      return 'One or more rules encountered an error during execution.';
    default:
      return null;
  }
});

const finalGraphContent = computed(() => {
  const res = props.results;
  if (!res) return '';
  return res.finalGraphContent ?? res.finalGraphNQuads ?? '';
});

/*
 * An inference graph comes back serialised by the engine, prefix declarations
 * and all. Those are as much a source of prefixes as the rule set that
 * produced them, so they are read the same way.
 */
usePrefixDiscovery(() => finalGraphContent.value, () => props.prefixSource ?? null, { delay: 0 });

const finalGraphContentType = computed(() => {
  const res = props.results;
  if (!res) return null;
  return res.finalGraphContentType ?? (res.finalGraphNQuads ? 'application/n-triples' : null);
});

const insertedTriplesFor = (rule: RuleExecution): string[] => {
  if (Array.isArray(rule.insertedQuads) && rule.insertedQuads.length > 0) {
    return rule.insertedQuads;
  }
  if (Array.isArray(rule.quadSamples) && rule.quadSamples.length > 0) {
    return rule.quadSamples;
  }
  return [];
};

const deletedTriplesFor = (rule: RuleExecution): string[] => {
  if (Array.isArray(rule.deletedQuads) && rule.deletedQuads.length > 0) {
    return rule.deletedQuads;
  }
  return [];
};

const hasTripleChanges = (iteration: Iteration): boolean => {
  if (!Array.isArray(iteration.rules) || iteration.rules.length === 0) {
    return false;
  }
  return iteration.rules.some((rule) => insertedTriplesFor(rule).length > 0 || deletedTriplesFor(rule).length > 0);
};

/**
 * Named tuples the rule added on this pass.
 *
 * The workspace is append-only within a run (the store is set-semantics and
 * nothing retracts), so unlike triples there is no deletion side to show.
 */
const tuplesFor = (rule: RuleExecution): string[] => (
  Array.isArray(rule.insertedTuples) ? rule.insertedTuples : []
);

const hasTupleChanges = (iteration: Iteration): boolean => (
  Array.isArray(iteration.rules) && iteration.rules.some((rule) => tuplesFor(rule).length > 0)
);

/**
 * Whether this run touched named tuples at all.
 *
 * The tuple controls appear only for a run that used the extension: a rule set
 * with no `TUPLE(…)` should not grow an empty section, and the reader of one
 * should not have to learn what a control they can never use does.
 */
const hasTuples = computed(() => {
  if (!props.results) return false;
  if (!props.tuplesEnabled) return false;
  if (props.results.finalTuples?.length) return true;
  return props.results.iterations.some(hasTupleChanges);
});

/**
 * Tuples are working data, not the answer, so they are shown on request — but
 * on by default for a run that produced them, since asking for them twice
 * (write TUPLE, then tick a box) is a poor trade for the clutter it saves.
 */
const showTuples = ref(true);

const showTupleRows = computed(() => hasTuples.value && showTuples.value);

/*
 * The heading names what the table below it covers, which grows a second half
 * once the tuple column is on screen.
 */
const changesLabel = computed(() => (
  showTupleRows.value ? 'Evaluation Graph and Named Tuples changes' : 'Evaluation Graph Changes'
));

const changesLabelTitle = computed(() => {
  const graph = 'What each rule wrote into the evaluation graph on this pass. The evaluation graph '
    + 'is the data graph the rules run against plus everything derived into it, DATA blocks included.';
  return showTupleRows.value
    ? `${graph} Named tuples are counted separately: they are working data and never enter the graph.`
    : graph;
});

const workspaceTuples = computed(() => props.results?.finalTuples ?? []);

const hasDownloadableContent = computed(() => {
  return !!(finalGraphContent.value && finalGraphContent.value.length > 0);
});

const downloadInferenceGraph = () => {
  const content = finalGraphContent.value;
  if (!content) {
    console.warn('No inference graph content available to download');
    return;
  }

  let filename = 'inference-graph';
  let mimeType = 'text/plain';
  
  // Determine file extension and mime type from content type
  const ct = (finalGraphContentType.value || '').toLowerCase();
  if (ct.includes('json-ld') || ct.includes('ld+json')) {
    filename += '.jsonld';
    mimeType = 'application/ld+json';
  } else if (ct.includes('json')) {
    filename += '.json';
    mimeType = 'application/json';
  } else if (ct.includes('turtle') || ct.includes('ttl')) {
    filename += '.ttl';
    mimeType = 'text/turtle';
  } else if (ct.includes('n-triples') || ct.includes('nt')) {
    filename += '.nt';
    mimeType = 'application/n-triples';
  } else if (ct.includes('n-quads') || ct.includes('nq')) {
    filename += '.nq';
    mimeType = 'application/n-quads';
  } else if (ct.includes('rdf+xml')) {
    filename += '.rdf';
    mimeType = 'application/rdf+xml';
  } else {
    filename += '.txt';
  }

  // Create and trigger download
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

</script>

<style scoped>
.execution-results {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

.placeholder-glyph {
  font-size: var(--text-display);
  opacity: 0.5;
}

.results-container {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Status Section */
.status-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 0 var(--space-6) 0;
}

.status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.status-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/*
 * Named for what it is rather than for the primitive. This rule re-types a
 * shadcn `Badge`, and it carried `.status-badge` — `StatusBadge`'s own class —
 * so the first `<StatusBadge>` this file ever rendered would have been re-typed
 * by it at equal specificity, with chunk order deciding. Same trap the
 * fourteenth pass found on `.section-label`.
 */
.result-status {
  width: fit-content;
  font-size: var(--text-label);
  padding: var(--space-1) var(--space-4);
  gap: 6px;
}

.status-details {
  margin: 0;
  font-size: var(--text-body-lg);
  line-height: 1.5;
  color: var(--ink-secondary);
}

/* Sections */

/*
 * A container, not a label. It was grouped into the `.section-title` rule by
 * 08bffbc, which deleted `.final-graph-section` and the `display: flex` body
 * along with it — so the column lost its stacking and took on a label's
 * typography, a stray bottom border, and 0.36px of tracking that every triple
 * below it inherited. (`.data-blocks-section` went with the same edit and has
 * no markup left; dropped rather than revived.)
 */
.iterations-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/*
 * Typography comes from SectionLabel (`md` is this rule's former spec exactly);
 * what stays here is the rule beneath it, which the primitive does not provide.
 * The label stretches to the container width as a flex item, so the border
 * still spans the section rather than the text.
 */
.section-title {
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

.section-title-row .section-title {
  padding-bottom: 0;
  border-bottom: none;
  flex: 1;
}

/* Iterations Accordion */
.iterations-accordion {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.iteration-trigger {
  padding: var(--space-5) var(--space-6);
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  transition: all 0.2s;
}

.iteration-trigger:hover {
  background: var(--surface-raised);
}

.iteration-trigger-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.iteration-trigger-content--focus {
  gap: 10px;
}

.iteration-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 22px;
}

.iteration-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: var(--text-body-lg);
  color: var(--ink);
  white-space: nowrap;
}

.iteration-delta {
  font-size: var(--text-body);
  font-weight: 600;
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-full);
  border: 1px solid rgba(108, 117, 125, 0.2);
  background: rgba(108, 117, 125, 0.1);
  color: var(--ink-muted);
  min-width: 48px;
  text-align: center;
}

.iteration-triple-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.iteration-triple-rows--focus {
  gap: 6px;
}

.triple-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.triple-rule {
  flex: 0 0 140px;
  max-width: 140px;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  mask-image: linear-gradient(90deg, rgba(0, 0, 0, 1) 80%, rgba(0, 0, 0, 0));
  -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 1) 80%, rgba(0, 0, 0, 0));
}

.triple-value {
  flex: 1;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: var(--text-label);
  line-height: 1.4;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius);
  background: var(--surface-sunken);
  border-left: 3px solid transparent;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
}

.triple-value code {
  white-space: pre-wrap;
  word-break: break-word;
  color: inherit;
}

.triple-row--added .triple-value {
  background: rgba(40, 167, 69, 0.08);
  border-left-color: rgba(40, 167, 69, 0.5);
  color: var(--success-ink);
}

.triple-row--removed .triple-value {
  background: rgba(220, 53, 69, 0.08);
  border-left-color: rgba(220, 53, 69, 0.5);
  color: var(--danger-ink);
}

/* Deliberately not green: a tuple is not a triple the graph gained. */
.triple-row--tuple .triple-value {
  background: rgba(99, 102, 241, 0.08);
  border-left-color: rgba(99, 102, 241, 0.5);
  color: var(--ink);
}

.tuple-workspace-section {
  margin-top: var(--space-4);
}

.tuple-workspace-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: var(--space-2);
}

.tuples-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-size: var(--text-label);
  cursor: pointer;
}

.tuples-toggle input {
  margin: 0;
  cursor: pointer;
}

.tuples-toggle.on {
  background: var(--surface);
  color: var(--ink);
  border-color: var(--accent, var(--border-strong));
}

.iteration-triple-empty {
  font-size: var(--text-body);
  color: var(--ink-muted);
  padding: var(--space-1) 0 var(--space-2);
}

.delta-positive {
  color: var(--success);
  border-color: var(--success);
  background: rgba(40, 167, 69, 0.08);
}

.delta-zero {
  color: var(--ink-muted);
  border-color: var(--border-hover);
  background: rgba(108, 117, 125, 0.08);
}

.delta-negative {
  color: var(--danger);
  border-color: var(--danger);
  background: rgba(220, 53, 69, 0.08);
}

/* Iteration Details */
.iteration-details {
  padding: var(--space-6);
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  margin-top: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-metrics {
  display: flex;
  gap: 16px;
  align-items: center;
  padding-bottom: var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.metric-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.metric-label {
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink-muted);
}

/* Rules Table */
.rules-table-container {
  margin-top: var(--space-4);
  overflow-x: auto;
}

.rules-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-body-lg);
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  overflow: hidden;
}

.rules-table thead {
  background: var(--surface-subtle);
  border-bottom: 2px solid var(--border-default);
}

.rules-table th {
  padding: var(--space-4) var(--space-5);
  text-align: left;
  font-weight: var(--weight-semibold);
  font-size: var(--text-label);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--ink-muted);
}

.rules-table tbody tr {
  border-bottom: 1px solid var(--border-subtle);
  transition: background-color 0.15s ease;
}

.rules-table tbody tr:last-child {
  border-bottom: none;
}

.rules-table tbody tr:hover {
  background-color: var(--surface-subtle);
}

.rules-table tbody tr.rule-timeout {
  background-color: rgba(220, 53, 69, 0.05);
}

.rules-table tbody tr.rule-timeout:hover {
  background-color: rgba(220, 53, 69, 0.08);
}

.rules-table th {
  white-space: nowrap;
}

.rules-table td {
  padding: var(--space-4) var(--space-5);
  vertical-align: middle;
}

.col-rule-name {
  width: auto;
}

.col-triples,
.col-tuples,
.col-timing {
  width: 1%;
  white-space: nowrap;
  text-align: right;
}

.rules-table th.col-triples,
.rules-table th.col-tuples,
.rules-table th.col-timing {
  text-align: right;
}

.rule-name {
  font-weight: 500;
  color: var(--ink);
}

/* A rule only ever writes, so a count is just a count: no sign, and none of the
   green/red a two-way diff would need. Triples and tuples read the same way for
   the same reason. */
.count-triples,
.count-tuples {
  color: var(--ink);
  font-weight: 600;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.count-zero {
  color: var(--ink-muted);
  font-size: var(--text-body);
}

.timing-cell {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.duration {
  color: var(--ink-muted);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: var(--text-body);
}

.timeout-badge-inline {
  font-size: var(--text-label);
  padding: var(--space-1) var(--space-4);
}

/* Totals Row */
.totals-row {
  background-color: var(--surface-sunken);
  border-top: 2px solid var(--border-default);
  font-weight: 600;
}

.totals-row:hover {
  background-color: var(--surface-raised);
}

.count-total-triples,
.count-total-tuples {
  color: var(--ink);
  font-weight: 700;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.duration-total {
  color: var(--ink-secondary);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: var(--text-body);
  font-weight: 600;
}

/* Final Graph */
.final-graph-content {
  padding: var(--space-5);
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  max-height: 300px;
  overflow-y: auto;
}

/* Scrollbar styling */
.results-container::-webkit-scrollbar,
.final-graph-content::-webkit-scrollbar {
  width: 8px;
}

.results-container::-webkit-scrollbar-track,
.final-graph-content::-webkit-scrollbar-track {
  background: var(--surface-subtle);
}

.results-container::-webkit-scrollbar-thumb,
.final-graph-content::-webkit-scrollbar-thumb {
  background: var(--surface-raised);
  border-radius: var(--radius);
}

.results-container::-webkit-scrollbar-thumb:hover,
.final-graph-content::-webkit-scrollbar-thumb:hover {
  background: var(--gray-500);
}

/* Download Button */
/* Focus Mode */
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

.focus-controls-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 var(--space-6) 0;
  flex-wrap: wrap;
}

.focus-controls-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.focus-controls-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.btn-icon {
  padding: var(--space-3);
  background: none;
  border: none;
  color: var(--ink-muted);
  cursor: pointer;
  border-radius: var(--radius-panel);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

.focus-content {
  flex: 1;
  overflow: auto;
  background: var(--surface);
  padding: var(--space-7);
}

.focus-iterations {
  max-width: 1400px;
  margin: 0 auto var(--space-9) auto;
  padding: var(--space-6);
  background: var(--surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
}

/* Typography from SectionLabel (`md`); the rule beneath it stays here. */
.focus-section-heading {
  margin: 0 0 var(--space-6) 0;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.focus-inference-content {
  /* Container for RdfContentViewer - no extra styling needed */
}

.iterations-accordion-focus {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.iteration-trigger-focus {
  padding: var(--space-6);
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  transition: all 0.2s;
}

.iteration-trigger-focus:hover {
  background: var(--surface-raised);
}

.iteration-trigger-content--focus .triple-rule {
  flex: 0 0 200px;
  max-width: 200px;
  font-size: var(--text-body-lg);
}

.iteration-trigger-content--focus .triple-value {
  font-size: var(--text-body);
  padding: var(--space-3) var(--space-5);
}

.iteration-details-focus {
  padding: var(--space-6) var(--space-7);
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  margin-top: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Dark mode support */
/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .execution-results {
  background: var(--gray-800);
}

.dark .focus-iterations {
  background: var(--gray-900);
  border-color: var(--gray-800);
}

/*
 * Only the rule, not the ink: the label's colour is SectionLabel's --ink-muted,
 * which the token layer already redefines for dark mode.
 */
.dark .focus-section-heading {
  border-bottom-color: var(--border-hover);
}

.dark .status-section {
  /* No background or border in dark mode either */
}

.dark .iteration-trigger {
  background: var(--gray-900);
  border-color: var(--border-hover);
}

.dark .iteration-trigger:hover {
  background: var(--gray-800);
}

.dark .iteration-details {
  background: var(--gray-900);
  border-color: var(--border-hover);
}

.dark .rule-item {
  background: var(--gray-800);
  border-color: var(--border-hover);
}

.dark .final-graph-content {
  background: var(--gray-900);
  border-color: var(--border-hover);
}

.dark .results-container::-webkit-scrollbar-track,
.dark .final-graph-content::-webkit-scrollbar-track {
  background: var(--gray-900);
}

.dark .results-container::-webkit-scrollbar-thumb,
.dark .final-graph-content::-webkit-scrollbar-thumb {
  background: var(--gray-700);
}

.dark .results-container::-webkit-scrollbar-thumb:hover,
.dark .final-graph-content::-webkit-scrollbar-thumb:hover {
  background: var(--gray-600);
}
</style>
