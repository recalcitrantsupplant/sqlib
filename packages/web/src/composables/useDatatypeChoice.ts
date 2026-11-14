import { computed, ref, watch } from 'vue';
import { XSD_DATATYPES } from '@/types/argument-sets';

/** Sentinel for a datatype select, never a datatype: an empty IRI is still "custom". */
export const CUSTOM_DATATYPE = '__custom__';

const isCommon = (iri: string) => XSD_DATATYPES.some((entry) => entry.value === iri);

/**
 * The state behind a datatype select with a "custom IRI…" choice.
 *
 * The select offers no datatype (`xsd:string`), the common datatypes in
 * `XSD_DATATYPES`, and custom. Custom is sticky: it stays chosen while the
 * IRI is empty, so a person can type an IRI one character at a time. A
 * select that derives its value from the datatype alone snaps back to the
 * first option as soon as custom writes an empty IRI.
 *
 * `datatype` reads the current IRI; `write` stores a new one, with
 * `undefined` for none.
 */
export function useDatatypeChoice(
  datatype: () => string | undefined,
  write: (next: string | undefined) => void,
) {
  const custom = ref(false);
  watch(
    datatype,
    (current) => {
      if (current && !isCommon(current)) custom.value = true;
    },
    { immediate: true },
  );

  /** The IRI the custom input shows: empty while a common datatype is set. */
  const customDatatype = computed(() => {
    const current = datatype() ?? '';
    return isCommon(current) ? '' : current;
  });

  /** The select's value: a common IRI, `CUSTOM_DATATYPE`, or `''` for none. */
  const selection = computed(() => {
    const current = datatype() ?? '';
    if (isCommon(current)) return current;
    if (custom.value) return CUSTOM_DATATYPE;
    return '';
  });

  function choose(next: string) {
    if (next === CUSTOM_DATATYPE) {
      custom.value = true;
      write(customDatatype.value || undefined);
      return;
    }
    custom.value = false;
    write(next || undefined);
  }

  function setCustom(iri: string) {
    write(iri || undefined);
  }

  /** Leave custom, for a caller whose other field clears the datatype. */
  function reset() {
    custom.value = false;
  }

  return { selection, customDatatype, isCustom: computed(() => selection.value === CUSTOM_DATATYPE), choose, setCustom, reset };
}
