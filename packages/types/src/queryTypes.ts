export const QUERY_TYPE_IRI_BASE = 'https://sparql-query-lib/query-type/';

export const QueryTypeIri = {
  select: `${QUERY_TYPE_IRI_BASE}select`,
  construct: `${QUERY_TYPE_IRI_BASE}construct`,
  describe: `${QUERY_TYPE_IRI_BASE}describe`,
  ask: `${QUERY_TYPE_IRI_BASE}ask`,
  update: `${QUERY_TYPE_IRI_BASE}update`,
  insert: `${QUERY_TYPE_IRI_BASE}insert`,
  delete: `${QUERY_TYPE_IRI_BASE}delete`,
  deleteInsert: `${QUERY_TYPE_IRI_BASE}deleteInsert`,
  load: `${QUERY_TYPE_IRI_BASE}load`,
  clear: `${QUERY_TYPE_IRI_BASE}clear`,
  create: `${QUERY_TYPE_IRI_BASE}create`,
  drop: `${QUERY_TYPE_IRI_BASE}drop`,
  copy: `${QUERY_TYPE_IRI_BASE}copy`,
  move: `${QUERY_TYPE_IRI_BASE}move`,
  add: `${QUERY_TYPE_IRI_BASE}add`,
} as const;

export type QueryTypeKey = keyof typeof QueryTypeIri;
export type QueryTypeValue = typeof QueryTypeIri[QueryTypeKey];

const QUERY_TYPE_ENTRIES = Object.entries(QueryTypeIri) as Array<[QueryTypeKey, QueryTypeValue]>;
export const QUERY_TYPE_VALUES_SET = new Set<QueryTypeValue>(QUERY_TYPE_ENTRIES.map(([, value]) => value));

const LEGACY_KEY_TO_IRI: Record<string, QueryTypeValue> = {
  select: QueryTypeIri.select,
  ask: QueryTypeIri.ask,
  construct: QueryTypeIri.construct,
  describe: QueryTypeIri.describe,
  update: QueryTypeIri.update,
};

export function isQueryTypeIri(value: unknown): value is QueryTypeValue {
  return typeof value === 'string' && QUERY_TYPE_VALUES_SET.has(value as QueryTypeValue);
}

export function isResultSetQueryType(value: string | null | undefined): boolean {
  return value === QueryTypeIri.select || value === QueryTypeIri.ask;
}

export function isGraphQueryType(value: string | null | undefined): boolean {
  return value === QueryTypeIri.construct || value === QueryTypeIri.describe;
}

/**
 * The update forms that have a diff.
 *
 * `DELETE`/`INSERT` against a store is a change to some set of triples, so
 * "what did it do?" has an answer — the ground patch. The graph-management
 * verbs (`LOAD`, `CLEAR`, `DROP`, `COPY`, `MOVE`, `ADD`, `CREATE`) are also
 * updates and are deliberately not in here: they name whole graphs rather than
 * triples, so `packages/rdf-delta` does not derive one, and offering an output
 * format for them would promise a result nothing can produce.
 */
export function isUpdateQueryType(value: string | null | undefined): boolean {
  return (
    value === QueryTypeIri.update ||
    value === QueryTypeIri.insert ||
    value === QueryTypeIri.delete ||
    value === QueryTypeIri.deleteInsert
  );
}

export function isBooleanQueryType(value: string | null | undefined): boolean {
  return value === QueryTypeIri.ask;
}

export function getQueryTypeKeyFromIri(value: string | null | undefined): QueryTypeKey | undefined {
  if (!value) return undefined;
  const entry = QUERY_TYPE_ENTRIES.find(([, iri]) => iri === value);
  return entry?.[0];
}

export function toQueryTypeIri(value: string | null | undefined): QueryTypeValue | undefined {
  if (!value) return undefined;
  if (isQueryTypeIri(value)) return value;

  const normalized = value.trim().toLowerCase();
  return LEGACY_KEY_TO_IRI[normalized as keyof typeof LEGACY_KEY_TO_IRI];
}
