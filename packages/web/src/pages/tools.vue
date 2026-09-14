<template>
  <div class="page">
    <header>
      <h1>Utilities</h1>
      <p>Helper tools for SPARQL detection, execution, and proxying.</p>
    </header>

    <section class="card">
      <h2>Detect Inputs & Outputs</h2>
      <form @submit.prevent="runDetections">
        <label>SPARQL Query</label>
        <textarea v-model="detectionQuery" rows="8" placeholder="SELECT ?s WHERE { ?s ?p ?o } LIMIT 10" required />
        <div class="actions">
          <button type="button" @click="detectInputsHandler">Detect Inputs</button>
          <button type="button" @click="detectOutputsHandler">Detect Outputs</button>
        </div>
      </form>
      <div v-if="detectionError" class="error">{{ detectionError }}</div>
      <div class="results">
        <div>
          <h3>Detected Inputs</h3>
          <pre v-if="inputsResult">{{ inputsResult }}</pre>
          <p v-else class="placeholder">No inputs detected yet.</p>
        </div>
        <div>
          <h3>Detected Outputs</h3>
          <pre v-if="outputsResult">{{ outputsResult }}</pre>
          <p v-else class="placeholder">No outputs detected yet.</p>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Execute Query or Group</h2>
      <form @submit.prevent="executeTargetHandler">
        <div class="grid">
          <label>
            Target ID
            <input v-model="executeForm.targetId" placeholder="urn:sqlib:query:example" required />
          </label>
          <label>
            Backend ID
            <input v-model="executeForm.backendId" placeholder="urn:sqlib:backend:default" required />
          </label>
        </div>
        <label>
          Arguments JSON
          <textarea v-model="executeForm.arguments" rows="4" placeholder='[{"head":{"vars":["param"]},"arguments":{"bindings":[{"param":{"type":"literal","value":"42"}}]}}]' />
        </label>
        <div class="parameter-builders">
          <section class="builder-panel">
            <header class="builder-header">
              <h3>Limit Parameters</h3>
              <button type="button" class="secondary" @click="addLimitEntry">Add Limit</button>
            </header>
            <p class="builder-hint">Optional limit overrides for templated queries.</p>
            <div
              v-for="entry in limitEntries"
              :key="entry.id"
              class="builder-row"
            >
              <input v-model="entry.name" placeholder="Parameter name" />
              <input v-model="entry.value" inputmode="decimal" placeholder="Value" />
              <button
                type="button"
                class="icon-button"
                @click="removeLimitEntry(entry.id)"
                aria-label="Remove limit"
              >×</button>
            </div>
            <p v-if="!limitEntries.length" class="builder-empty">No limits configured.</p>
            <pre class="builder-preview">{{ limitsPreview }}</pre>
          </section>
          <section class="builder-panel">
            <header class="builder-header">
              <h3>Offset Parameters</h3>
              <button type="button" class="secondary" @click="addOffsetEntry">Add Offset</button>
            </header>
            <p class="builder-hint">Optional offset overrides for templated queries.</p>
            <div
              v-for="entry in offsetEntries"
              :key="entry.id"
              class="builder-row"
            >
              <input v-model="entry.name" placeholder="Parameter name" />
              <input v-model="entry.value" inputmode="decimal" placeholder="Value" />
              <button
                type="button"
                class="icon-button"
                @click="removeOffsetEntry(entry.id)"
                aria-label="Remove offset"
              >×</button>
            </div>
            <p v-if="!offsetEntries.length" class="builder-empty">No offsets configured.</p>
            <pre class="builder-preview">{{ offsetsPreview }}</pre>
          </section>
        </div>
        <div class="actions">
          <button type="submit">Execute</button>
          <button type="button" class="secondary" :disabled="streaming" @click="executeTargetStreamHandler">
            {{ streaming ? 'Streaming…' : 'Stream Execute' }}
          </button>
        </div>
      </form>
      <div v-if="executeError" class="error">{{ executeError }}</div>
      <p v-else-if="streaming" class="streaming-indicator">Streaming response&hellip;</p>
      <pre v-if="executeResult" class="result">{{ executeResult }}</pre>
      <p v-else class="placeholder">No execution result yet.</p>
    </section>

    <section class="card">
      <h2>SPARQL Proxy</h2>
      <form @submit.prevent="runSparqlHandler">
        <div class="grid">
          <label>
            Backend ID
            <input v-model="sparqlForm.backendId" placeholder="urn:sqlib:backend:default" required />
          </label>
        </div>
        <label>
          SPARQL Query
          <textarea v-model="sparqlForm.query" rows="6" placeholder="SELECT ?s WHERE { ?s ?p ?o } LIMIT 10" required />
        </label>
        <div class="actions">
          <button type="submit">Execute SPARQL</button>
        </div>
      </form>
      <div v-if="sparqlError" class="error">{{ sparqlError }}</div>
      <pre v-if="sparqlResult" class="result">{{ sparqlResult }}</pre>
      <p v-else class="placeholder">No SPARQL response yet.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useApiClient } from '../composables/useApiClient';
import type { ExecutionRequest, SparqlRequest } from '@sparql-query-lib/contracts';
// @ts-ignore - Nuxt auto-imports
import { useRuntimeConfig } from '#imports';

const { detectInputs, detectOutputs, executeTarget, runSparql } = useApiClient();
const runtimeConfig = useRuntimeConfig();

const detectionQuery = ref('');
const detectionError = ref<string | null>(null);
const inputsResult = ref<string | null>(null);
const outputsResult = ref<string | null>(null);

const executeForm = ref({
  targetId: '',
  backendId: '',
  arguments: '',
});
const executeError = ref<string | null>(null);
const executeResult = ref<string | null>(null);
const streaming = ref(false);

type NumericEntry = { id: number; name: string; value: string };
let parameterEntryId = 0;
const createNumericEntry = (): NumericEntry => ({ id: ++parameterEntryId, name: '', value: '' });
const limitEntries = ref<NumericEntry[]>([createNumericEntry()]);
const offsetEntries = ref<NumericEntry[]>([createNumericEntry()]);

const addLimitEntry = () => {
  limitEntries.value.push(createNumericEntry());
};

const removeLimitEntry = (id: number) => {
  limitEntries.value = limitEntries.value.filter((entry) => entry.id !== id);
};

const addOffsetEntry = () => {
  offsetEntries.value.push(createNumericEntry());
};

const removeOffsetEntry = (id: number) => {
  offsetEntries.value = offsetEntries.value.filter((entry) => entry.id !== id);
};

const toNumericParameters = (entries: NumericEntry[]): Array<{ name: string; value: number }> | undefined => {
  const values = entries
    .map(({ name, value }) => ({ name: name.trim(), raw: typeof value === 'string' ? value.trim() : '' }))
    .filter(({ name, raw }) => name.length > 0 && raw.length > 0)
    .map(({ name, raw }) => ({ name, value: Number(raw) }))
    .filter(({ value }) => Number.isFinite(value));
  return values.length > 0 ? values : undefined;
};

const limitsPreview = computed(() => {
  const values = toNumericParameters(limitEntries.value);
  return values ? JSON.stringify(values, null, 2) : '[]';
});

const offsetsPreview = computed(() => {
  const values = toNumericParameters(offsetEntries.value);
  return values ? JSON.stringify(values, null, 2) : '[]';
});

const sparqlForm = ref({
  backendId: '',
  query: '',
});
const sparqlError = ref<string | null>(null);
const sparqlResult = ref<string | null>(null);

const parseJson = <T>(label: string, value: string): T | undefined => {
  if (!value.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error: unknown) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const detectInputsHandler = async () => {
  detectionError.value = null;
  inputsResult.value = null;
  try {
    const result = await detectInputs(detectionQuery.value);
    inputsResult.value = JSON.stringify(result, null, 2);
  } catch (error: unknown) {
    detectionError.value = error instanceof Error ? error.message : 'Failed to detect inputs';
  }
};

const detectOutputsHandler = async () => {
  detectionError.value = null;
  outputsResult.value = null;
  try {
    const result = await detectOutputs(detectionQuery.value);
    outputsResult.value = JSON.stringify(result, null, 2);
  } catch (error: unknown) {
    detectionError.value = error instanceof Error ? error.message : 'Failed to detect outputs';
  }
};

const runDetections = () => {
  detectInputsHandler();
  detectOutputsHandler();
};

const composeExecutionPayload = (): ExecutionRequest => {
  const payload: ExecutionRequest = {
    targetId: executeForm.value.targetId.trim(),
    backendId: executeForm.value.backendId.trim(),
  };

  const args = parseJson<ExecutionRequest['arguments']>('Arguments', executeForm.value.arguments);
  if (args !== undefined) {
    payload.arguments = args;
  }

  const limits = toNumericParameters(limitEntries.value);
  if (limits) {
    payload.limits = limits;
  }

  const offsets = toNumericParameters(offsetEntries.value);
  if (offsets) {
    payload.offsets = offsets;
  }

  return payload;
};

const executeTargetHandler = async () => {
  executeError.value = null;
  executeResult.value = null;
  streaming.value = false;
  try {
    const payload = composeExecutionPayload();
    const result = await executeTarget(payload);
    const header = result.contentType ? `Content-Type: ${result.contentType}\n\n` : '';
    executeResult.value = `${header}${result.body ?? ''}`;
  } catch (error: unknown) {
    executeError.value = error instanceof Error ? error.message : 'Failed to execute target';
  }
};

const executeTargetStreamHandler = async () => {
  executeError.value = null;
  executeResult.value = null;
  streaming.value = true;
  try {
    const payload = composeExecutionPayload();
    const response = await fetch(new URL('/execute', runtimeConfig.public.apiBaseUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let message = response.statusText || 'Streaming execution failed';
      try {
        const details = await response.json();
        if (details && typeof details === 'object' && 'error' in details) {
          message = (details as { error?: string }).error ?? message;
        }
      } catch {
        const fallback = await response.text().catch(() => '');
        if (fallback) {
          message = fallback;
        }
      }
      throw new Error(message);
    }

    const body = response.body;
    if (!body) {
      const fallback = await response.text();
      executeResult.value = fallback ? fallback : null;
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let aggregated = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      aggregated += decoder.decode(value, { stream: true });
      executeResult.value = aggregated;
    }
    aggregated += decoder.decode();
    let output = aggregated;
    try {
      const parsed = JSON.parse(aggregated);
      output = JSON.stringify(parsed, null, 2);
    } catch {
      // Keep raw streaming output when JSON parse fails (e.g., chunked text)
    }
    executeResult.value = output || null;
  } catch (error: unknown) {
    executeError.value = error instanceof Error ? error.message : 'Failed to stream execution';
  } finally {
    streaming.value = false;
  }
};

const runSparqlHandler = async () => {
  sparqlError.value = null;
  sparqlResult.value = null;
  try {
    const payload: SparqlRequest = {
      query: sparqlForm.value.query,
      backendId: sparqlForm.value.backendId.trim(),
    };
    const result = await runSparql(payload);
    sparqlResult.value = JSON.stringify(result, null, 2);
  } catch (error: unknown) {
    sparqlError.value = error instanceof Error ? error.message : 'SPARQL proxy execution failed';
  }
};
</script>

<style scoped>
.page {
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  gap: 2rem;
}
header h1 {
  margin: 0 0 var(--space-4);
}
.card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-7);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.card h2 {
  margin: 0;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-weight: 600;
}
input,
textarea {
  padding: var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  font-family: inherit;
  font-size: var(--text-content);
}
.grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}
.actions {
  display: flex;
  gap: 0.75rem;
}
button {
  padding: var(--space-4) var(--space-6);
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  background: var(--action-hover);
  color: var(--action-fg);
  font-weight: 600;
}
button.secondary {
  background: var(--surface-sunken);
  color: var(--ink);
  border: 1px solid var(--border-default);
}
button.secondary:hover:not(:disabled) {
  background: var(--surface-raised);
}
button.secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.error {
  color: var(--danger-ink);
}
.results {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}
pre.result,
pre {
  background: var(--surface-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  overflow: auto;
  max-height: 260px;
}
.parameter-builders {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
.builder-panel {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  background: var(--surface-subtle);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.builder-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.builder-header h3 {
  margin: 0;
  font-size: var(--text-title);
}
.builder-hint {
  margin: 0;
  font-size: var(--text-content);
  color: var(--ink-secondary);
}
.builder-row {
  display: grid;
  grid-template-columns: 1fr 120px auto;
  gap: 0.5rem;
  align-items: center;
}
.builder-row input {
  width: 100%;
}
.icon-button {
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  background: var(--surface);
  color: var(--danger);
  font-size: var(--text-heading);
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.icon-button:hover {
  background: var(--danger-surface);
}
.builder-empty {
  margin: 0;
  font-size: var(--text-body);
  color: var(--ink-muted);
}
.builder-preview {
  margin: 0;
  font-family: 'Fira Code', 'Source Code Pro', monospace;
  font-size: var(--text-content);
  background: var(--surface);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  color: var(--ink-secondary);
  overflow-x: auto;
}
.streaming-indicator {
  font-size: var(--text-content);
  color: var(--action-hover);
}
.placeholder {
  color: var(--ink-muted);
  font-style: italic;
}
</style>
