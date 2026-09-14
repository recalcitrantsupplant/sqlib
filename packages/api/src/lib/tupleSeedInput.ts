/**
 * Resolving a rule set's tabular input on a run.
 *
 * A rule set declares `TUPLE(:seed, ?x, ?y)` reads and is given rows to fill
 * them. Until now the only way to supply those rows *per run* was the
 * playground's inline SRL text: the rule set's own execute route had no field
 * for them at all and ran whatever `tupleSeeds` its version stored, so the
 * "saved tuple set" choice on the rules screen was resolved to text in the
 * browser and honoured by one route out of two.
 *
 * This gives every rule-set run the same three ways in that every other input
 * slot takes (plan D14):
 *
 * - `tupleSetVersionId` — pinned, so the run is reproducible.
 * - `tupleSetId` — the set, floating to whatever its current version is.
 * - `inline` — an `application/sparql-arguments+json` document, the one wire
 *   spelling for tabular input everywhere else.
 *
 * Supplied, it *overrides* the version's stored seeds for that run; absent, the
 * stored seeds run as before. Nothing about what a rule-set version stores
 * changes: this is a request field, not a model change.
 *
 * ## Why the rows are matched positionally
 *
 * A rule-set tuple read matches on arity plus any ground terms in the
 * declaration, and column *names* are ignored — `TUPLE(:seed, ?x, ?y)` and
 * `TUPLE(:seed, ?p, ?q)` both match the same relation
 * (`docs/reference/srl-language.md`). So an SRJ document's `head.vars`
 * fixes the column *order* here and nothing else, and `whenEmpty` — a call
 * frame's concern, not a relation's — is ignored.
 */

import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { readStoredTupleContent } from './tupleContent.js';
import type { LdkitTupleSetVersion } from '../persistence/schemas/TupleSetVersionSchema.js';

/** Anything the caller could have got right is this, and routes answer it 400. */
export class TupleSeedInputError extends Error {}

export interface TupleSeedInputRequest {
  tupleSetVersionId?: string | null;
  tupleSetId?: string | null;
  /** An `application/sparql-arguments+json` document, or its SRJ equivalent. */
  inline?: unknown;
}

type TermValue = { type?: string; value?: string; datatype?: string; 'xml:lang'?: string };

/**
 * One SPARQL Results value as SRL writes it.
 *
 * The mirror of the web's `termToSrl`; the two must agree, because a set saved
 * from the rules screen and the same set resolved here have to seed identical
 * rows.
 */
function termToSrl(value: TermValue | undefined): string | null {
  if (!value || value.value === undefined) return null;
  if (value.type === 'uri') return `<${value.value}>`;
  if (value.type === 'bnode') return `_:${value.value}`;
  const literal = `"${value.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (value['xml:lang']) return `${literal}@${value['xml:lang']}`;
  if (value.datatype) return `${literal}^^<${value.datatype}>`;
  return literal;
}

/** Rows as the `TUPLE(…)` seed document a run is given, in column order. */
export function bindingsToTupleSeeds(
  columns: string[],
  bindings: Array<Record<string, TermValue>>,
): string {
  return bindings
    .map((binding) => {
      const terms = columns
        .map((column) => termToSrl(binding[column]))
        .filter((term): term is string => term !== null);
      return `TUPLE(${terms.join(', ')})`;
    })
    .join('\n');
}

/** Read an inline args-JSON or SRJ document into columns plus rows. */
function readInlineDocument(document: unknown): { columns: string[]; bindings: Array<Record<string, TermValue>> } {
  if (!document || typeof document !== 'object') {
    throw new TupleSeedInputError('Inline tuples must be a SPARQL arguments JSON document');
  }
  const record = document as {
    head?: { vars?: unknown };
    // `arguments` is the wire spelling, `results` the storage one; both are
    // accepted because a caller may reasonably be holding either.
    arguments?: { bindings?: unknown };
    results?: { bindings?: unknown };
  };
  const vars = Array.isArray(record.head?.vars) ? record.head!.vars as string[] : null;
  const bindings = record.arguments?.bindings ?? record.results?.bindings;
  if (!vars || !Array.isArray(bindings)) {
    throw new TupleSeedInputError(
      'Inline tuples need head.vars and arguments.bindings (or results.bindings)',
    );
  }
  return { columns: vars.map(v => String(v).replace(/^\?/, '')), bindings: bindings as Array<Record<string, TermValue>> };
}

/**
 * The seed document for a run, or null when the request names no tuples.
 *
 * Null means "use whatever the version stored", which is what every run did
 * before this existed.
 */
export function resolveTupleSeedInput(request: TupleSeedInputRequest | null | undefined): string | null {
  if (!request) return null;
  const pinnedId = request.tupleSetVersionId?.trim() || null;
  const setId = request.tupleSetId?.trim() || null;
  const hasInline = request.inline !== undefined && request.inline !== null;

  const supplied = [pinnedId, setId, hasInline ? 'inline' : null].filter(Boolean);
  if (supplied.length === 0) return null;
  if (supplied.length > 1) {
    throw new TupleSeedInputError(
      'Provide exactly one of tupleSetVersionId, tupleSetId or inline tuples',
    );
  }

  if (hasInline) {
    const { columns, bindings } = readInlineDocument(request.inline);
    return bindingsToTupleSeeds(columns, bindings);
  }

  const cacheCoordinator = getCacheCoordinator();
  let versionId = pinnedId;
  if (setId) {
    const set = cacheCoordinator.get(setId) as { '@type'?: string; currentVersion?: string } | null;
    if (!set || set['@type'] !== 'TupleSet') {
      throw new TupleSeedInputError(`Tuple set ${setId} not found`);
    }
    if (!set.currentVersion) {
      throw new TupleSeedInputError(`Tuple set ${setId} has no current version`);
    }
    versionId = set.currentVersion;
  }

  const version = cacheCoordinator.get(versionId!) as LdkitTupleSetVersion | null;
  if (!version || version['@type'] !== 'TupleSetVersion') {
    throw new TupleSeedInputError(`Tuple set version ${versionId} not found`);
  }

  const stored = readStoredTupleContent(version.contentString ?? '');
  const columns = Array.isArray(version.tupleColumns) && version.tupleColumns.length
    ? version.tupleColumns.map(column => String(column).replace(/^\?/, ''))
    // `tupleColumns` is `head.vars` lifted onto the version precisely so column
    // order survives storage; the document's own head is the fallback.
    : (stored?.head?.vars ?? []).map(column => String(column).replace(/^\?/, ''));

  return bindingsToTupleSeeds(columns, (stored?.results?.bindings ?? []) as Array<Record<string, TermValue>>);
}
