/**
 * One key per parameter, so "does this argument set fit?" is answered the same
 * way everywhere.
 *
 * A callable declares parameters — a `VALUES` clause, a `TUPLE(…)` read, a
 * start-node graph port, a `LIMIT`/`OFFSET` placeholder — and an argument set
 * fills some of them. Three questions hang off that, and before this module
 * each was answered by its own ad-hoc spelling:
 *
 * - **Fit** (client): which callables does this set serve?
 * - **Conflict** (server): may a run supply an inline value *and* name a set?
 * - **Match** (runtime): which clause do these rows go in?
 *
 * The spellings had already drifted apart in a way that was a live bug.
 * `ArgumentSetService` keyed its runtime map on the stored binding's variables
 * **in stored order**, while `/execute` validated the same payload against a
 * **sorted** signature. So a set whose variables were written in a different
 * order from the query's clause passed validation and then failed the map
 * lookup, and its rows were silently dropped — the run went ahead
 * unconstrained rather than filtered. `alignArgumentSets` in the runtime had
 * the right answer all along (it sorts before comparing, for exactly the
 * reason its docblock gives), so sorted is canonical here.
 *
 * Keys are prefixed by kind, so a table over `?x` and the graph in slot `x`
 * could never collide.
 */

/** The kinds of parameter a callable can declare. */
export type ParameterKind = 'table' | 'graph' | 'limit' | 'offset';

/** A parameter key: `<kind>:<identity>`. Opaque; compare, do not parse. */
export type ParameterKey = string;

const bare = (variable: string): string => variable.replace(/^\?/, '');

/**
 * The key for a table parameter, from the variables it binds.
 *
 * Sorted, because a set binding `?b ?a` fills a clause declaring `?a ?b` —
 * the rows are keyed by name, so order carries no meaning. Duplicates
 * collapse: `VALUES (?a ?a)` is not expressible.
 */
export function tableParameterKey(variables: readonly string[]): ParameterKey {
  const names = Array.from(new Set(variables.map(bare))).sort();
  return `table:${names.join('|')}`;
}

/**
 * Put positioned items in their declared order.
 *
 * An RDF `@array` is a set, so the order a binding list comes back in is not
 * the order it was written in. Anything routed by slot has to be sorted by an
 * explicit `position` first; one that predates the field falls back to where
 * it happens to sit, which is the best available answer and no worse than
 * today's. Stable, so equal positions keep their relative order.
 */
export function orderByPosition<T extends { position?: number | null }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index, key: typeof item?.position === 'number' && Number.isFinite(item.position) ? item.position : index }))
    .sort((a, b) => (a.key - b.key) || (a.index - b.index))
    .map(entry => entry.item);
}

/**
 * The key for a graph parameter, from the slot it fills.
 *
 * By slot and nothing else: an argument set carries payload in order and the
 * group routes it, so a graph has no name to be keyed by
 * (`2026-09-07-payload-and-routing.md`). The previous spelling keyed by port
 * name and gave every unnamed graph the key `graph:`, so two positional graphs
 * collapsed into one and the completion check on `/execute` could not tell
 * them apart.
 */
export function graphParameterKey(position: number): ParameterKey {
  return `graph:#${Number.isFinite(position) ? position : 0}`;
}

/** The key for a `LIMIT` or `OFFSET` parameter, from its placeholder name. */
export function scalarParameterKey(kind: 'limit' | 'offset', name: string): ParameterKey {
  return `${kind}:${name.trim()}`;
}

/** Human-readable name for a key, for the messages a refusal has to be readable as. */
export function describeParameterKey(key: ParameterKey): string {
  const separator = key.indexOf(':');
  if (separator < 0) return key;
  const kind = key.slice(0, separator);
  const identity = key.slice(separator + 1);
  switch (kind) {
    case 'table':
      return identity ? `the VALUES clause (${identity.split('|').map(v => `?${v}`).join(' ')})` : 'a VALUES clause';
    case 'graph':
      return `data graph input ${Number(identity.replace('#', '')) + 1}`;
    case 'limit':
      return `LIMIT parameter '${identity}'`;
    case 'offset':
      return `OFFSET parameter '${identity}'`;
    default:
      return key;
  }
}

/** The shape `parameterKeysOf` reads — a stored version, or a run's inline values. */
export interface ParameterBearing {
  tupleBindings?: Array<{ variables?: string[]; head?: { vars?: string[] } }> | null;
  scalarBindings?: Array<{ parameterKind?: string; parameterName?: string }> | null;
  graphBindings?: Array<{ position?: number | null }> | null;
}

/**
 * Every parameter the bearer fills.
 *
 * Used by the completion check on `/execute`: a run may name an argument set
 * *and* supply inline values, but only for parameters the set leaves open.
 * Overlap is a refusal rather than a silent precedence rule, because either
 * precedence would surprise half the callers.
 */
export function parameterKeysOf(bearer: ParameterBearing): Set<ParameterKey> {
  const keys = new Set<ParameterKey>();
  for (const binding of bearer.tupleBindings ?? []) {
    const variables = binding?.variables ?? binding?.head?.vars ?? [];
    if (variables.length) keys.add(tableParameterKey(variables));
  }
  for (const scalar of bearer.scalarBindings ?? []) {
    const kind = scalar?.parameterKind;
    if ((kind === 'limit' || kind === 'offset') && scalar?.parameterName) {
      keys.add(scalarParameterKey(kind, scalar.parameterName));
    }
  }
  // Indexed, so a set that leaves `position` unset still gets one key per
  // graph rather than every graph collapsing onto one.
  (bearer.graphBindings ?? []).forEach((graph, index) => {
    keys.add(graphParameterKey(graph?.position ?? index));
  });
  return keys;
}
