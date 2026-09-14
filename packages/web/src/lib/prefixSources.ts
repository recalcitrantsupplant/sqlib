/**
 * Where a discovered prefix came from, as one token the Prefix Manager can
 * read back.
 *
 * A mapping's provenance used to be written in whatever shape the screen that
 * discovered it happened to hold — a bare query URN here, `rule-set:<urn>`
 * there, `scratch:rules:<id>` for an unsaved one — so the manager could only
 * describe some of them, and an unsaved rule set read as "from scratch:rules:…"
 * rather than as a rule set. What a person wants from that column is the *kind*
 * of thing that taught them the prefix; whether it was saved yet is a detail of
 * the link, not of the label.
 *
 * So one token: `<kind>:<id>`. The id says the rest — an unsaved item carries a
 * `urn:ui-temp:` id, which is what routes it to `?scratch=` instead of to its
 * section's own parameter.
 */

export type PrefixSourceKind =
  | 'query'
  | 'query-group'
  | 'rule-set'
  | 'test'
  | 'benchmark'
  | 'etl'
  | 'data-graph'
  | 'tuple-set'
  | 'results'
  | 'endpoint';

export interface PrefixSource {
  kind: PrefixSourceKind;
  /** The entity the prefixes were read from; a backend id for results. */
  id: string;
  /** True while the item has no server identity — it is still scratch. */
  draft: boolean;
}

const KINDS: PrefixSourceKind[] = [
  'query',
  'query-group',
  'rule-set',
  'test',
  'benchmark',
  'etl',
  'data-graph',
  'tuple-set',
  'results',
  'endpoint',
];

const KIND_LABELS: Record<PrefixSourceKind, string> = {
  query: 'Query',
  'query-group': 'Query group',
  'rule-set': 'Rule set',
  test: 'Test',
  benchmark: 'Benchmark',
  etl: 'ETL pipeline',
  'data-graph': 'Data graph',
  'tuple-set': 'Tuple set',
  results: 'Query results',
  endpoint: 'Endpoint',
};

/** The route parameter each kind opens under on the library page. */
const KIND_ROUTE_PARAM: Partial<Record<PrefixSourceKind, string>> = {
  query: 'query',
  'query-group': 'queryGroup',
  'rule-set': 'ruleSet',
  test: 'test',
  benchmark: 'benchmark',
  etl: 'etlJob',
  'data-graph': 'dataGraph',
  'tuple-set': 'tupleSet',
};

/** Scratch ids are minted by `useScratchItems`; nothing else uses this prefix. */
const DRAFT_ID_PREFIX = 'urn:ui-temp:';

function isDraftId(id: string): boolean {
  return id.startsWith(DRAFT_ID_PREFIX);
}

/**
 * The token to record against a discovered mapping.
 *
 * Returns null for an item with no id yet — a query being typed before its
 * first save has nothing to point at, and a provenance that resolves to
 * nowhere is worse than none.
 */
export function prefixSourceToken(
  kind: PrefixSourceKind,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return `${kind}:${id}`;
}

/**
 * Read a token back, including the shapes older builds wrote.
 *
 * Legacy: a bare query/group/rule-set URN, `rule-set:<urn>`, and
 * `scratch:<section>:<id>`. They are still in people's localStorage, so they
 * are still readable here rather than degrading to raw text on screen.
 */
export function parsePrefixSource(token: string | null | undefined): PrefixSource | null {
  if (!token) return null;
  const value = token.trim();
  if (!value) return null;

  // Current shape: `<kind>:<id>`.
  for (const kind of KINDS) {
    if (value.startsWith(`${kind}:`)) {
      const id = value.slice(kind.length + 1);
      if (id) return { kind, id, draft: isDraftId(id) };
    }
  }

  // Legacy: `scratch:<section>:<id>`.
  const scratch = /^scratch:([^:]+):(.+)$/.exec(value);
  if (scratch) {
    const section = scratch[1]!;
    const id = scratch[2]!;
    const kind = LEGACY_SECTION_KINDS[section];
    if (kind) return { kind, id, draft: true };
    return null;
  }

  // Legacy: entity URNs written bare.
  if (value.startsWith('urn:sqlib:query:')) return { kind: 'query', id: value, draft: false };
  if (value.startsWith('urn:sqlib:group:')) return { kind: 'query-group', id: value, draft: false };
  if (value.startsWith('urn:sqlib:ruleset:')) return { kind: 'rule-set', id: value, draft: false };

  return null;
}

const LEGACY_SECTION_KINDS: Record<string, PrefixSourceKind> = {
  queries: 'query',
  query: 'query',
  groups: 'query-group',
  group: 'query-group',
  rules: 'rule-set',
  rule: 'rule-set',
  etl: 'etl',
  bench: 'benchmark',
  test: 'test',
  dataGraph: 'data-graph',
  tupleSet: 'tuple-set',
};

/**
 * What the Prefix Manager shows in the source column: the kind of thing, and
 * "draft" only as a qualifier on it. A prefix learned from an unsaved rule set
 * came from a rule set.
 */
export function prefixSourceLabel(source: PrefixSource): string {
  const label = KIND_LABELS[source.kind];
  return source.draft ? `${label} (draft)` : label;
}

/** Where the source opens, or null when it is not addressable. */
export function prefixSourceRoute(
  source: PrefixSource,
): { path: string; query: Record<string, string> } | null {
  if (source.draft) return { path: '/', query: { scratch: source.id } };
  const param = KIND_ROUTE_PARAM[source.kind];
  if (!param) return null;
  return { path: '/', query: { [param]: source.id } };
}
