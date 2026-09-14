<template>
  <div class="sandbox-shell">
    <header class="sandbox-header">
      <div>
        <h1>Query Group Canvas Sandbox</h1>
        <p>
          Component playground for the forthcoming query group canvas. This page renders representative
          node and edge cards using mocked data so we can refine visuals and interactions before wiring
          the main work area to the backend.
        </p>
      </div>
      <span class="version-pill">Phase 2</span>
    </header>

    <section aria-labelledby="node-palette-heading">
      <div class="section-heading">
        <h2 id="node-palette-heading">Node Palette</h2>
        <p class="section-description">
          Each node card lists its inputs and outputs, the backing query or backend, and quick metadata.
          These cards mirror the information we plan to expose in the VueFlow nodes.
        </p>
      </div>
      <div class="node-grid">
        <article
          v-for="node in sampleNodes"
          :key="node.id"
          class="node-card"
          :data-node-type="node.nodeType"
        >
          <header class="node-card__header">
            <h3 class="node-card__title">
              {{ node.label }}
            </h3>
            <span class="node-card__tag">
              {{ node.nodeType }}
            </span>
          </header>

          <dl class="node-meta">
            <div v-if="node.queryLabel" class="node-meta__item">
              <dt>Query</dt>
              <dd>{{ node.queryLabel }}</dd>
            </div>
            <div v-if="node.backendLabel" class="node-meta__item">
              <dt>Backend</dt>
              <dd>{{ node.backendLabel }}</dd>
            </div>
            <div v-if="node.description" class="node-meta__item">
              <dt>Description</dt>
              <dd>{{ node.description }}</dd>
            </div>
          </dl>

          <div v-if="node.outputs.length > 0" class="port-block">
            <h4 class="port-block__title">Outputs</h4>
            <ul class="port-list">
              <li v-for="port in node.outputs" :key="port.id" class="port-list__item">
                <span class="port-name">
                  {{ port.label }}
                </span>
                <code class="port-entity">{{ port.entityType }}</code>
                <small v-if="port.description">{{ port.description }}</small>
              </li>
            </ul>
          </div>

          <div v-if="node.inputs.length > 0" class="port-block">
            <h4 class="port-block__title">Inputs</h4>
            <ul class="port-list">
              <li v-for="port in node.inputs" :key="port.id" class="port-list__item">
                <span class="port-name">
                  {{ port.label }}
                </span>
                <code class="port-entity">{{ port.entityType }}</code>
                <small v-if="port.description">{{ port.description }}</small>
              </li>
            </ul>
          </div>
        </article>
      </div>
    </section>

    <section aria-labelledby="edge-showcase-heading">
      <div class="section-heading">
        <h2 id="edge-showcase-heading">Edge Flow Types</h2>
        <p class="section-description">
          Sample edges demonstrate how each flow type is rendered. Data flow edges list the I/O entities
          they connect, while control flow edges emphasise execution order without data transfer.
        </p>
      </div>
      <div class="edge-grid">
        <article v-for="edge in sampleEdges" :key="edge.id" class="edge-card">
          <header class="edge-card__header">
            <h3 class="edge-card__title">{{ edge.label }}</h3>
            <span class="edge-card__tag" :data-flow-type="edge.flowType">
              {{ edge.flowType }}
            </span>
          </header>
          <p class="edge-summary">{{ edge.summary }}</p>
          <dl class="edge-meta">
            <div class="edge-meta__item">
              <dt>Source</dt>
              <dd>
                <strong>{{ edge.sourceNode }}</strong>
                <template v-if="edge.sourceOutput">
                  <br />
                  <code>{{ edge.sourceOutput }}</code>
                </template>
              </dd>
            </div>
            <div class="edge-meta__item">
              <dt>Target</dt>
              <dd>
                <strong>{{ edge.targetNode }}</strong>
                <template v-if="edge.targetInput">
                  <br />
                  <code>{{ edge.targetInput }}</code>
                </template>
              </dd>
            </div>
          </dl>
        </article>
      </div>
    </section>

    <section aria-labelledby="compatibility-heading">
      <div class="section-heading">
        <h2 id="compatibility-heading">I/O Compatibility Explorer</h2>
        <p class="section-description">
          Select a flow type and pair of entities to check whether the connection is valid according to
          our shared compatibility matrix (`IO_COMPATIBILITY`). Use this when designing new nodes or
          adjusting edge visuals.
        </p>
      </div>

      <div class="compatibility-controls" role="group" aria-label="Compatibility explorer">
        <label class="field">
          <span class="field__label">Flow Type</span>
          <select v-model="interactiveFlowType" class="field__select">
            <option v-for="type in edgeFlowTypes" :key="type" :value="type">
              {{ type }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="field__label">Source Entity</span>
          <select v-model="selectedSourceEntity" class="field__select">
            <option v-for="option in sourceEntityOptions" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="field__label">Target Entity</span>
          <select v-model="selectedTargetEntity" class="field__select">
            <option v-for="option in targetEntityOptions" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
        </label>
      </div>

      <div
        class="compatibility-result"
        :class="{
          'is-valid': compatibilityResult === 'valid',
          'is-invalid': compatibilityResult === 'invalid',
          'is-na': compatibilityResult === 'na'
        }"
        role="status"
        aria-live="polite"
      >
        <template v-if="compatibilityResult === 'valid'">
          <strong>Compatible:</strong>
          {{ selectedSourceEntity }} → {{ selectedTargetEntity }} for {{ interactiveFlowType }} edges.
        </template>
        <template v-else-if="compatibilityResult === 'invalid'">
          <strong>Not Compatible:</strong>
          {{ interactiveFlowType }} edges expect
          <code>{{ expectedSourceEntity }}</code>
          → <code>{{ expectedTargetEntity }}</code>.
        </template>
        <template v-else>
          <strong>Control Flow:</strong>
          CONTROL_FLOW edges do not transfer data, so I/O entities are ignored.
        </template>
      </div>

      <table class="compatibility-table">
        <caption>Compatibility matrix derived from IO_COMPATIBILITY</caption>
        <thead>
          <tr>
            <th scope="col">Flow Type</th>
            <th scope="col">Source Entity</th>
            <th scope="col">Target Entity</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in compatibilityEntries" :key="entry.flowType">
            <th scope="row">{{ entry.flowType }}</th>
            <td><code>{{ entry.source }}</code></td>
            <td><code>{{ entry.target }}</code></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  DATA_FLOW_TYPES,
  IO_COMPATIBILITY,
  type DataFlowType,
  type InputIOType,
  type OutputIOType,
} from '@sparql-query-lib/types';

type EdgeFlowType = 'CONTROL_FLOW' | DataFlowType;

type SandboxPort = {
  id: string;
  label: string;
  entityType: string;
  description?: string;
};

type SandboxNode = {
  id: string;
  label: string;
  nodeType: 'StartNode' | 'QueryNode' | 'DynamicQueryNode' | 'EndNode';
  queryLabel?: string;
  backendLabel?: string;
  description?: string;
  inputs: SandboxPort[];
  outputs: SandboxPort[];
};

type SandboxEdge = {
  id: string;
  label: string;
  flowType: EdgeFlowType;
  summary: string;
  sourceNode: string;
  targetNode: string;
  sourceOutput?: string;
  targetInput?: string;
};

const sampleNodes: SandboxNode[] = [
  {
    id: 'urn:__START__',
    label: 'Group Entry',
    nodeType: 'StartNode',
    description: 'Saves external parameters and kicks off control flow.',
    inputs: [],
    outputs: [
      {
        id: 'urn:sqlib:control-output:demo',
        label: 'Control Token',
        entityType: 'ControlFlowIO',
        description: 'Auto-created when version is minted; used for CONTROL_FLOW edges.',
      },
      {
        id: 'urn:sqlib:output-tuple:external-params',
        label: 'External Params [?region, ?year]',
        entityType: 'QueryOutputTuple',
        description: 'Synthetic tuple representing user-supplied parameters.',
      },
    ],
  },
  {
    id: 'urn:sqlib:node:get-countries',
    label: 'Get Countries',
    nodeType: 'QueryNode',
    queryLabel: 'SELECT ?country ?label',
    backendLabel: 'Wikidata SPARQL',
    description: 'Fetches all countries with preferred English labels.',
    inputs: [
      {
        id: 'urn:sqlib:input-tuple:region',
        label: 'Filter Region',
        entityType: 'QueryInputTuple',
        description: 'Start node maps ?region into VALUES clause.',
      },
    ],
    outputs: [
      {
        id: 'urn:sqlib:output-tuple:countries',
        label: 'Country Rows [?country, ?label]',
        entityType: 'QueryOutputTuple',
        description: 'Auto-generated tuple inferred from the SELECT projection.',
      },
    ],
  },
  {
    id: 'urn:sqlib:node:country-population',
    label: 'Country Population RDF',
    nodeType: 'QueryNode',
    queryLabel: 'CONSTRUCT population graph',
    backendLabel: 'Wikidata SPARQL',
    inputs: [
      {
        id: 'urn:sqlib:input-tuple:country-binding',
        label: 'Country Binding [?country]',
        entityType: 'QueryInputTuple',
        description: 'Receives ?country from SELECT node.',
      },
    ],
    outputs: [
      {
        id: 'urn:sqlib:triples-quads:population',
        label: 'Population RDF',
        entityType: 'TriplesQuadsIO',
        description: 'Serialized RDF graph emitted by the CONSTRUCT query.',
      },
    ],
    description: 'Transforms row bindings into RDF statements.',
  },
  {
    id: 'urn:sqlib:node:execution-gate',
    label: 'Population Threshold Gate',
    nodeType: 'QueryNode',
    queryLabel: 'ASK population > threshold',
    backendLabel: 'Local Fuseki',
    inputs: [
      {
        id: 'urn:sqlib:boolean-input:threshold',
        label: 'Gate Inputs',
        entityType: 'BooleanIO',
        description: 'ASK query consumes bool tuple representing thresholds.',
      },
    ],
    outputs: [
      {
        id: 'urn:sqlib:boolean-output:gate-result',
        label: 'Gate Result',
        entityType: 'BooleanIO',
        description: 'True when country population exceeds supplied limit.',
      },
    ],
    description: 'Example ASK node to exercise BOOLEAN data flow edges.',
  },
  {
    id: 'urn:sqlib:node:dynamic-variant',
    label: 'Dynamic Query Selector',
    nodeType: 'DynamicQueryNode',
    backendLabel: 'Local Fuseki',
    description: 'Executes one of several query variants chosen at runtime.',
    inputs: [
      {
        id: 'urn:sqlib:query-id-input:selector',
        label: 'Query Variant ID',
        entityType: 'QueryIdInput',
        description: 'Receives the ID of the query to execute.',
      },
    ],
    outputs: [
      {
        id: 'urn:sqlib:output-tuple:selector-bindings',
        label: 'Selected Query Result',
        entityType: 'QueryOutputTuple',
      },
    ],
  },
  {
    id: 'urn:sqlib:end-node:results',
    label: 'Group Exit',
    nodeType: 'EndNode',
    description: 'Collects the final payload returned to API callers.',
    inputs: [
      {
        id: 'urn:sqlib:triples-quads:population',
        label: 'Population RDF',
        entityType: 'TriplesQuadsIO',
        description: 'Matches the CONSTRUCT output routed into the end node.',
      },
    ],
    outputs: [],
  },
];

const sampleEdges: SandboxEdge[] = [
  {
    id: 'edge-control',
    label: 'Start → Get Countries',
    flowType: 'CONTROL_FLOW',
    summary: 'Ensures the SELECT node executes after the query group begins.',
    sourceNode: 'Group Entry',
    targetNode: 'Get Countries',
  },
  {
    id: 'edge-variable-bindings',
    label: 'Start (Params) → Get Countries (VALUES)',
    flowType: 'VARIABLE_BINDINGS',
    summary: 'Maps external parameters into the SELECT query VALUES clause.',
    sourceNode: 'Group Entry',
    targetNode: 'Get Countries',
    sourceOutput: 'QueryOutputTuple',
    targetInput: 'QueryInputTuple',
  },
  {
    id: 'edge-variable-bindings-select-construct',
    label: 'Get Countries → Country Population RDF',
    flowType: 'VARIABLE_BINDINGS',
    summary: 'Feeds row bindings into the downstream CONSTRUCT query.',
    sourceNode: 'Get Countries',
    targetNode: 'Country Population RDF',
    sourceOutput: 'QueryOutputTuple',
    targetInput: 'QueryInputTuple',
  },
  {
    id: 'edge-rdf',
    label: 'Country Population RDF → Group Exit',
    flowType: 'RDF_GRAPH',
    summary: 'Routes the generated RDF graph into the end node for the API response.',
    sourceNode: 'Country Population RDF',
    targetNode: 'Group Exit',
    sourceOutput: 'TriplesQuadsIO',
    targetInput: 'TriplesQuadsIO',
  },
  {
    id: 'edge-boolean',
    label: 'Population Threshold Gate → Dynamic Selector',
    flowType: 'BOOLEAN',
    summary: 'Boolean guard controlling whether the dynamic query should execute.',
    sourceNode: 'Population Threshold Gate',
    targetNode: 'Dynamic Query Selector',
    sourceOutput: 'BooleanIO',
    targetInput: 'BooleanIO',
  },
  {
    id: 'edge-query-id',
    label: 'Dynamic Selector → Population Threshold Gate',
    flowType: 'QUERY_ID',
    summary: 'Example of QUERY_ID data flow into a DynamicQueryNode variant slot.',
    sourceNode: 'Dynamic Query Selector',
    targetNode: 'Dynamic Query Selector',
    sourceOutput: 'QueryOutputTuple',
    targetInput: 'QueryIdInput',
  },
];

const edgeFlowTypes: EdgeFlowType[] = ['CONTROL_FLOW', ...DATA_FLOW_TYPES];

const compatibilityEntries = computed(() =>
  DATA_FLOW_TYPES.map((flowType) => ({
    flowType,
    source: IO_COMPATIBILITY[flowType].source,
    target: IO_COMPATIBILITY[flowType].target,
  })),
);

const sourceEntityOptions: ReadonlyArray<OutputIOType | 'ControlFlowIO'> = [
  'ControlFlowIO',
  'QueryOutputTuple',
  'TriplesQuadsIO',
  'BooleanIO',
] as const;

const targetEntityOptions: ReadonlyArray<InputIOType | 'ControlFlowIO'> = [
  'ControlFlowIO',
  'QueryInputTuple',
  'TriplesQuadsIO',
  'BooleanIO',
  'QueryIdInput',
] as const;

const interactiveFlowType = ref<EdgeFlowType>('CONTROL_FLOW');
const selectedSourceEntity = ref<(typeof sourceEntityOptions)[number]>('ControlFlowIO');
const selectedTargetEntity = ref<(typeof targetEntityOptions)[number]>('ControlFlowIO');

const expectedSourceEntity = computed(() => {
  if (interactiveFlowType.value === 'CONTROL_FLOW') return null;
  return IO_COMPATIBILITY[interactiveFlowType.value].source;
});

const expectedTargetEntity = computed(() => {
  if (interactiveFlowType.value === 'CONTROL_FLOW') return null;
  return IO_COMPATIBILITY[interactiveFlowType.value].target;
});

const compatibilityResult = computed<'valid' | 'invalid' | 'na'>(() => {
  if (interactiveFlowType.value === 'CONTROL_FLOW') {
    return 'na';
  }
  const expectedSource = expectedSourceEntity.value;
  const expectedTarget = expectedTargetEntity.value;
  if (!expectedSource || !expectedTarget) {
    return 'invalid';
  }
  const matchesSource = selectedSourceEntity.value === expectedSource;
  const matchesTarget = selectedTargetEntity.value === expectedTarget;
  return matchesSource && matchesTarget ? 'valid' : 'invalid';
});

watch(
  interactiveFlowType,
  (newType) => {
    if (newType === 'CONTROL_FLOW') {
      selectedSourceEntity.value = 'ControlFlowIO';
      selectedTargetEntity.value = 'ControlFlowIO';
      return;
    }
    const expectation = IO_COMPATIBILITY[newType];
    selectedSourceEntity.value = expectation.source;
    selectedTargetEntity.value = expectation.target;
  },
  { immediate: true },
);
</script>

<style scoped>
.sandbox-shell {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: var(--space-9);
  max-width: 1080px;
  margin: 0 auto;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

.sandbox-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.sandbox-header h1 {
  font-size: var(--text-display-lg);
  margin: 0 0 var(--space-4);
}

.sandbox-header p {
  margin: 0;
  color: var(--ink-secondary);
  max-width: 720px;
}

.version-pill {
  align-self: flex-start;
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-full);
  background: var(--action-surface);
  color: var(--action-hover);
  font-weight: 600;
}

.section-heading {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: var(--space-6);
}

.section-heading h2 {
  margin: 0;
  font-size: var(--text-display);
}

.section-description {
  margin: 0;
  color: var(--ink-secondary);
  max-width: 720px;
}

.node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}

.node-card {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  background: var(--surface);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
}

.node-card[data-node-type='StartNode'] {
  border-color: var(--action-border);
}

.node-card[data-node-type='EndNode'] {
  border-color: var(--violet-500);
}

.node-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.node-card__title {
  margin: 0;
  font-size: var(--text-heading);
}

.node-card__tag {
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: var(--surface-sunken);
  color: var(--ink-muted);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-panel);
}

.node-meta {
  display: grid;
  gap: 8px;
  margin: 0;
}

.node-meta__item {
  display: grid;
  gap: 2px;
}

.node-meta__item dt {
  font-size: var(--text-body);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--ink-muted);
}

.node-meta__item dd {
  margin: 0;
  font-size: var(--text-content);
}

.port-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.port-block__title {
  margin: 0;
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.025em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}

.port-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}

.port-list__item {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-5);
  background: var(--surface-subtle);
  font-size: var(--text-body-lg);
  display: grid;
  gap: 4px;
}

.port-name {
  font-weight: 600;
}

.port-entity {
  background: var(--surface);
  border-radius: var(--radius);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-label);
  width: fit-content;
}

.edge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.edge-card {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  background: var(--surface);
  padding: var(--space-6);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
  display: grid;
  gap: 12px;
}

.edge-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.edge-card__title {
  margin: 0;
  font-size: var(--text-title);
}

.edge-card__tag {
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-panel);
  background: var(--surface-sunken);
}

.edge-card__tag[data-flow-type='CONTROL_FLOW'] {
  background: var(--action-surface);
  color: var(--action);
}

.edge-card__tag[data-flow-type='VARIABLE_BINDINGS'] {
  background: var(--success-surface);
  color: var(--success);
}

.edge-card__tag[data-flow-type='RDF_GRAPH'] {
  background: var(--warning-surface);
  color: var(--warning);
}

.edge-card__tag[data-flow-type='BOOLEAN'] {
  background: var(--danger-surface);
  color: var(--danger);
}

.edge-card__tag[data-flow-type='QUERY_ID'] {
  background: var(--violet-50);
  color: var(--violet-500);
}

.edge-summary {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-content);
}

.edge-meta {
  margin: 0;
  display: flex;
  gap: 16px;
  font-size: var(--text-body-lg);
}

.edge-meta__item {
  flex: 1;
  display: grid;
  gap: 4px;
}

.edge-meta__item dt {
  font-size: var(--text-body);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--ink-muted);
}

.edge-meta__item dd {
  margin: 0;
}

.compatibility-controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: var(--space-6);
}

.field {
  display: grid;
  gap: 6px;
}

.field__label {
  font-size: var(--text-body);
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.field__select {
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-strong);
  font-size: var(--text-content);
}

.compatibility-result {
  padding: var(--space-5) var(--space-6);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  background: var(--surface-subtle);
  font-size: var(--text-content);
}

.compatibility-result.is-valid {
  border-color: var(--success);
  background: var(--success-surface);
  color: var(--success-ink);
}

.compatibility-result.is-invalid {
  border-color: var(--danger);
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.compatibility-result.is-na {
  border-color: var(--border-hover);
  background: var(--surface-sunken);
  color: var(--ink-secondary);
}

.compatibility-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: var(--space-6);
}

.compatibility-table caption {
  text-align: left;
  margin-bottom: var(--space-4);
  font-weight: 600;
  color: var(--ink-secondary);
}

.compatibility-table th,
.compatibility-table td {
  border: 1px solid var(--border-default);
  padding: var(--space-4) var(--space-5);
  font-size: var(--text-body-lg);
  text-align: left;
}

.compatibility-table th {
  background: var(--surface-sunken);
}

@media (max-width: 768px) {
  .sandbox-shell {
    padding: var(--space-8) var(--space-6);
  }
}
</style>
