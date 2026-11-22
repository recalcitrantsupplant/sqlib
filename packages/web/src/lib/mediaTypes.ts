/**
 * Media type utilities for the web UI
 * Re-exports from the main package with additional UI-specific helpers
 */

// Re-export all media types from the shared package
export {
  SPARQL_RESULTS_MEDIA_TYPES,
  RDF_MEDIA_TYPES,
  PATCH_MEDIA_TYPES,
  OUTPUT_MEDIA_TYPES,
  OUTPUT_MEDIA_TYPE_VALUES,
  MEDIA_TYPE_LABELS,
  type OutputMediaType,
  getDefaultMediaType,
  isMediaTypeValidForQuery,
} from '@sparql-query-lib/types';

import {
  OUTPUT_MEDIA_TYPES,
  MEDIA_TYPE_LABELS,
  type QueryTypeValue,
  isBooleanQueryType,
  isGraphQueryType,
  isResultSetQueryType,
  isUpdateQueryType,
  type OutputMediaType,
} from '@sparql-query-lib/types';

/**
 * Media type options for UI dropdowns
 */
export type MediaTypeOption = {
  value: OutputMediaType | typeof UPDATE_RESULT_MEDIA_TYPE;
  label: string;
};

/**
 * The shapes a SPARQL result can come back in. Every output media type belongs
 * to exactly one of them, whatever the query happens to be.
 *
 * `RESULT` is a plain run of an update: it writes, and the server answers
 * with a status and no body. `PATCH` is the other thing an update can be asked
 * for (#290): the change it would make, derived without writing.
 */
export type MediaTypeCategory = 'TABULAR' | 'GRAPH' | 'RESULT' | 'PATCH';

/**
 * The `Accept` value for a plain run of an update. The API runs the update for
 * any type except RDF Patch, and answers 204, so this asks for whatever comes.
 */
export const UPDATE_RESULT_MEDIA_TYPE = '*/*' as const;
const UPDATE_RESULT_LABEL = 'Result';

/** SPARQL Results formats, in the order dropdowns show them. */
const TABULAR_FORMATS: readonly OutputMediaType[] = [
  OUTPUT_MEDIA_TYPES.JSON,
  OUTPUT_MEDIA_TYPES.XML,
  OUTPUT_MEDIA_TYPES.CSV,
  OUTPUT_MEDIA_TYPES.TSV,
];

/** RDF serialisations, in the order dropdowns show them. */
const GRAPH_FORMATS: readonly OutputMediaType[] = [
  OUTPUT_MEDIA_TYPES.TURTLE,
  OUTPUT_MEDIA_TYPES.N_TRIPLES,
  OUTPUT_MEDIA_TYPES.RDF_XML,
  OUTPUT_MEDIA_TYPES.JSON_LD,
  OUTPUT_MEDIA_TYPES.N3,
  OUTPUT_MEDIA_TYPES.TRIG,
  OUTPUT_MEDIA_TYPES.N_QUADS,
];

/** The patch dialect, which only an update can be asked for. */
const PATCH_FORMATS: readonly OutputMediaType[] = [OUTPUT_MEDIA_TYPES.RDF_PATCH];

const toOptions = (values: readonly OutputMediaType[]): MediaTypeOption[] =>
  values.map(value => ({ value, label: MEDIA_TYPE_LABELS[value] }));

/**
 * Get all media type options for dropdowns
 */
export function getAllMediaTypeOptions(): MediaTypeOption[] {
  return [
    ...toOptions(TABULAR_FORMATS),
    ...toOptions(GRAPH_FORMATS),
    { value: UPDATE_RESULT_MEDIA_TYPE, label: UPDATE_RESULT_LABEL },
    ...toOptions(PATCH_FORMATS),
  ];
}

/**
 * Get SPARQL Results media type options (for SELECT/ASK queries)
 */
export function getSparqlResultsMediaTypeOptions(): MediaTypeOption[] {
  return toOptions(TABULAR_FORMATS);
}

/**
 * Get RDF media type options (for CONSTRUCT/DESCRIBE queries)
 */
export function getRdfMediaTypeOptions(): MediaTypeOption[] {
  return toOptions(GRAPH_FORMATS);
}

/**
 * Query type for media type organization
 */
export type QueryType = QueryTypeValue | null;

/**
 * Media type option with priority flag
 */
export type PrioritizedMediaTypeOption = MediaTypeOption & {
  isPrimary: boolean;
};

/**
 * Grouped media type options with category
 */
export type GroupedMediaTypeOption = {
  category: MediaTypeCategory;
  /**
   * The heading a dropdown draws. Normally the category, but an ASK answers
   * with a boolean rather than a table, so the SPARQL Results group says so.
   */
  label: string;
  options: PrioritizedMediaTypeOption[];
};

/**
 * The formats that actually make sense for a query type — the ones a dropdown
 * suggests. `null` means "no opinion": nothing is known about the query, so
 * nothing is played down.
 *
 * CSV and TSV are defined for SELECT only, so an ASK narrows to JSON and XML.
 */
function getSuggestedMediaTypes(queryType: QueryType): Set<MediaTypeOption['value']> | null {
  if (!queryType) return null;

  if (isBooleanQueryType(queryType)) {
    return new Set([OUTPUT_MEDIA_TYPES.JSON, OUTPUT_MEDIA_TYPES.XML]);
  }

  if (isResultSetQueryType(queryType)) {
    return new Set(TABULAR_FORMATS);
  }

  if (isGraphQueryType(queryType)) {
    return new Set(GRAPH_FORMATS);
  }

  if (isUpdateQueryType(queryType)) {
    // A plain run writes; the patch derives the change without writing.
    return new Set([UPDATE_RESULT_MEDIA_TYPE, ...PATCH_FORMATS]);
  }

  // The graph-management verbs (LOAD, CLEAR, DROP, …) produce neither a result
  // set nor a triple diff; leave every option at full weight.
  return null;
}

/**
 * Get organized media type options based on detected query type
 * Primary options are shown first, secondary options are shown after (can be styled differently)
 */
export function getOrganizedMediaTypeOptions(queryType: QueryType): PrioritizedMediaTypeOption[] {
  const suggested = getSuggestedMediaTypes(queryType);
  const allOptions = getAllMediaTypeOptions();

  if (!suggested) {
    return allOptions.map(opt => ({ ...opt, isPrimary: true }));
  }

  const primary = allOptions.filter(opt => suggested.has(opt.value)).map(opt => ({ ...opt, isPrimary: true }));
  const secondary = allOptions.filter(opt => !suggested.has(opt.value)).map(opt => ({ ...opt, isPrimary: false }));

  return [...primary, ...secondary];
}

/**
 * Get grouped media type options organized by category (TABULAR vs GRAPH).
 *
 * Every option stays selectable — the query type only decides what is
 * *suggested*, so a CONSTRUCT still lets you ask for CSV, just quietly.
 */
export function getGroupedMediaTypeOptions(queryType: QueryType): GroupedMediaTypeOption[] {
  const suggested = getSuggestedMediaTypes(queryType);
  const prioritize = (values: readonly OutputMediaType[]): PrioritizedMediaTypeOption[] =>
    toOptions(values).map(opt => ({ ...opt, isPrimary: !suggested || suggested.has(opt.value) }));

  return [
    {
      category: 'TABULAR',
      label: isBooleanQueryType(queryType) ? 'BOOLEAN' : 'TABULAR',
      options: prioritize(TABULAR_FORMATS),
    },
    {
      category: 'GRAPH',
      label: 'GRAPH',
      options: prioritize(GRAPH_FORMATS),
    },
    /*
     * Only for an update. Every other format is offered for every query type,
     * muted when it is a poor fit. A plain run and a patch are things only an
     * update can be asked for, so a SELECT does not offer them.
     */
    ...(isUpdateQueryType(queryType)
      ? [{
          category: 'RESULT' as const,
          label: 'UPDATE',
          options: [{ value: UPDATE_RESULT_MEDIA_TYPE, label: UPDATE_RESULT_LABEL, isPrimary: true }],
        }, {
          category: 'PATCH' as const,
          label: 'PATCH',
          options: prioritize(PATCH_FORMATS),
        }]
      : []),
  ];
}

/**
 * Why an option is played down, said in words for its `title`. `null` when the
 * option is one of the suggested ones and needs no excuse.
 */
export function getMediaTypeHint(
  option: PrioritizedMediaTypeOption,
  queryType: QueryType | undefined,
): string | null {
  if (option.isPrimary) return null;
  if (isBooleanQueryType(queryType)) return `${option.label} is not a usual format for an ASK result`;
  if (isResultSetQueryType(queryType)) return `${option.label} is not a usual format for a result set`;
  if (isGraphQueryType(queryType)) return `${option.label} is not a usual format for a graph result`;
  if (isUpdateQueryType(queryType)) return `An update has no ${option.label} output`;
  return null;
}

/** The `RunBar` "as" clause draws the same groups; this is them in its shape. */
export function getMediaTypeChoiceGroups(queryType: QueryType) {
  return getGroupedMediaTypeOptions(queryType).map(group => ({
    key: group.category,
    label: group.label,
    options: group.options.map(option => ({
      value: option.value,
      label: option.label,
      muted: !option.isPrimary,
      title: getMediaTypeHint(option, queryType) ?? undefined,
    })),
  }));
}
