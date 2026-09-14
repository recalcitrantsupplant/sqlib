<template>
  <DropdownMenuLabel class="type-menu-heading">Term type · ?{{ variable }}</DropdownMenuLabel>

  <!--
    Node kind first, because it decides whether the rest of the menu exists at
    all: an IRI carries neither datatype nor language, so a literal's two
    fields appear under it rather than beside it.

    `preventDefault` on select keeps the menu open. Choosing Literal and then
    having to reopen the menu to say *which* literal was the whole friction.
  -->
  <DropdownMenuItem
    v-for="kind in NODE_KINDS"
    :key="kind.value"
    @select="(event: Event) => { event.preventDefault(); setType(kind.value); }"
  >
    <Check :size="12" :class="['type-check', { 'type-check--hidden': value.type !== kind.value }]" />
    {{ kind.label }}
  </DropdownMenuItem>

  <template v-if="value.type === 'literal'">
    <DropdownMenuSeparator />
    <p class="type-note">A literal carries a datatype or a language tag, never both.</p>

    <div class="type-field" @click.stop @keydown.stop>
      <label class="type-field-label" :for="`datatype-${fieldId}`">Datatype</label>
      <select
        :id="`datatype-${fieldId}`"
        class="type-field-control"
        data-testid="term-datatype"
        :value="datatypeSelection"
        :disabled="hasLanguage"
        :title="hasLanguage ? LANG_WINS : undefined"
        @change="chooseDatatype(($event.target as HTMLSelectElement).value)"
      >
        <!--
          A language tag *is* a datatype — `rdf:langString` — so the select
          shows that rather than going blank, and locks while the tag stands.
        -->
        <option v-if="hasLanguage" :value="LANG_STRING">rdf:langString</option>
        <template v-else>
          <option value="">none (xsd:string)</option>
          <option v-for="dt in XSD_DATATYPES" :key="dt.value" :value="dt.value">{{ dt.label }}</option>
          <option :value="CUSTOM">custom IRI…</option>
        </template>
      </select>
    </div>

    <!--
      The custom row is only drawn once custom is chosen, and it holds the
      datatype IRI verbatim: a datatype outside the common list is a normal
      thing for a library to use, and the select alone had no way to show one.
    -->
    <div v-if="datatypeSelection === CUSTOM && !hasLanguage" class="type-field" @click.stop @keydown.stop>
      <label class="type-field-label" :for="`datatype-iri-${fieldId}`">IRI</label>
      <input
        :id="`datatype-iri-${fieldId}`"
        type="text"
        class="type-field-control"
        data-testid="term-datatype-iri"
        placeholder="http://example.org/datatype"
        :value="customDatatype"
        @input="setDatatype(($event.target as HTMLInputElement).value)"
      />
    </div>

    <div class="type-field" @click.stop @keydown.stop>
      <label class="type-field-label" :for="`language-${fieldId}`">Language</label>
      <input
        :id="`language-${fieldId}`"
        type="text"
        class="type-field-control"
        data-testid="term-language"
        placeholder="en"
        :value="value['xml:lang'] ?? ''"
        :disabled="hasDatatype"
        :title="hasDatatype ? DATATYPE_WINS : undefined"
        @input="setLanguage(($event.target as HTMLInputElement).value)"
      />
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check } from '@lucide/vue';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { NODE_KINDS, XSD_DATATYPES, type SparqlValue } from '@/types/argument-sets';

/**
 * The body of the term-type menu: what kind of node a cell holds, and — for a
 * literal — what types it.
 *
 * Extracted because three surfaces now edit the same term and must offer the
 * same choices: the cell field, the grid, and the clause view's tokens. The
 * menu chrome stays with the caller, since each opens it from a different
 * trigger; only the choices are shared.
 */
const props = defineProps<{
  value: SparqlValue;
  variable: string;
}>();

const emit = defineEmits<{ update: [value: SparqlValue] }>();

/** Sentinel for the select, never a datatype: an empty IRI is still "custom". */
const CUSTOM = '__custom__';

/**
 * RDF 1.1 §3.3: a literal has exactly one datatype IRI. A language-tagged
 * string's is `rdf:langString`, and an untagged one with none written is
 * `xsd:string` — so the two fields are not merely discouraged from combining,
 * they are two spellings of the same slot, and the UI locks whichever is not
 * in play.
 */
const LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';
const LANG_WINS = 'Cleared: a language-tagged literal is already rdf:langString.';
const DATATYPE_WINS = 'Cleared: a literal with a datatype cannot carry a language tag.';

const fieldId = computed(() => props.variable.replace(/[^A-Za-z0-9_-]/g, '') || 'value');

const isCommon = (iri: string) => XSD_DATATYPES.some((entry) => entry.value === iri);

// Custom is sticky: the row must survive the IRI being cleared back to empty,
// or typing one character at a time is impossible.
const custom = ref(false);
watch(
  () => props.value.datatype,
  (datatype) => {
    if (datatype && !isCommon(datatype)) custom.value = true;
  },
  { immediate: true },
);

const customDatatype = computed(() => {
  const datatype = props.value.datatype ?? '';
  return isCommon(datatype) ? '' : datatype;
});

const hasLanguage = computed(() => Boolean(props.value['xml:lang']));
const hasDatatype = computed(() => Boolean(props.value.datatype));

const datatypeSelection = computed(() => {
  if (hasLanguage.value) return LANG_STRING;
  const datatype = props.value.datatype ?? '';
  if (isCommon(datatype)) return datatype;
  if (custom.value) return CUSTOM;
  return '';
});

function write(patch: Partial<SparqlValue>) {
  emit('update', { ...props.value, ...patch });
}

function setType(type: 'uri' | 'literal') {
  if (type === 'uri') {
    // An IRI has neither, and leaving them behind means a term that claims a
    // datatype it cannot carry the moment someone flips back.
    custom.value = false;
    emit('update', { type: 'uri', value: props.value.value });
    return;
  }
  write({ type: 'literal' });
}

function chooseDatatype(next: string) {
  if (next === CUSTOM) {
    custom.value = true;
    setDatatype(customDatatype.value);
    return;
  }
  custom.value = false;
  setDatatype(next);
}

function setDatatype(next: string) {
  const patch: Partial<SparqlValue> = { datatype: next || undefined };
  // A datatype and a language tag are mutually exclusive in RDF.
  if (next) patch['xml:lang'] = undefined;
  write(patch);
}

function setLanguage(next: string) {
  const patch: Partial<SparqlValue> = { 'xml:lang': next || undefined };
  if (next) {
    patch.datatype = undefined;
    custom.value = false;
  }
  write(patch);
}
</script>

<style scoped>
.type-note {
  margin: 0;
  padding: var(--space-1) var(--space-4) var(--space-2);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.type-field-control:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.type-menu-heading {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.type-check {
  color: var(--ink);
}

.type-check--hidden {
  visibility: hidden;
}

.type-field {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  padding: var(--space-2) var(--space-4);
}

.type-field-label {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.type-field-control {
  width: 100%;
  height: 24px;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-micro);
}

.type-field-control:focus {
  outline: none;
  border-color: var(--action);
}
</style>
