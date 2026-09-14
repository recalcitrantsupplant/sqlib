/**
 * Query templates: the compiled form of a parameterised query.
 *
 * A stored query's *parameter slots* — the reserved all-UNDEF VALUES blocks —
 * are a fact about the query, not about the arguments. Their positions are the
 * same on every request. So we parse once, record each slot's span in a canonical
 * rendering of the query, and reduce per-request argument application to
 * "serialise a VALUES block, splice it over a span".
 *
 * That removes two costs from the hot path:
 *
 * - the re-parse (`applyArguments` parsed the stored query string on *every* call), and
 * - the regeneration, which ran the whole query back through Traqula's generator.
 *   The generator's string building is quadratic in VALUES rows, and was measured at
 *   ~97% of a 10k-row query-group hop.
 *
 * The same artifact is what a browser runtime would ship, since splicing needs no
 * parser.
 *
 * **Templates are never trusted on construction.** `SparqlQueryParser` verifies a
 * freshly built template against the AST path on adversarial probes before using
 * it, and falls back to the AST path if anything about the query is unusual. A
 * template that cannot be built or verified is not an error — it is a slow path.
 */

import { renderValuesBlock, type PrefixTable, type TermValue } from './sparql-terms.js';

/** How a parameter slot is rewritten when it has no bound rows. */
export type EmptyArgumentMode = 'unconstrained' | 'propagateEmpty' | 'require';

/** One parameter slot, as a half-open span `[start, end)` of {@link QueryTemplate.text}. */
export interface TemplateSlot {
  start: number;
  end: number;
  /** Declared variables, in the order the rendered block must list them. */
  vars: string[];
}

/**
 * A parameterised query compiled for substitution.
 *
 * `text` is the *canonical* rendering produced by Traqula's generator, not the
 * author's original source. That is not a behaviour change: `applyArguments` has
 * always returned generator output, so this is the same string the endpoint saw
 * before. It does mean the spans are only meaningful for this exact `text` — the
 * pair must travel together and must never be hand-edited.
 */
export interface QueryTemplate {
  text: string;
  /** Slots in order of appearance, non-overlapping and sorted by `start`. */
  slots: TemplateSlot[];
  /**
   * The query's prefix declarations. Carried so inserted IRIs can be abbreviated
   * exactly as the AST path abbreviates them — without this the two paths emit
   * `ex:thing` and `<http://example.org/thing>` for the same input.
   */
  prefixes: PrefixTable;
}

/**
 * One row of a VALUES block: variable name to term, absent meaning UNDEF.
 *
 * Declared here rather than beside `ArgumentSetInput` in `library.ts` so the shape
 * a caller writes and the shape this module reads are one declaration and cannot
 * drift. Both are exported from the package root.
 */
export type ArgumentRow = Record<string, TermValue | null | undefined>;

/** An argument set as supplied by a caller, in SPARQL Results JSON shape. */
export interface TemplateArgumentSet {
  head: { vars: string[] };
  /**
   * A whole `null` or missing row is a blank row — every declared cell UNDEF.
   * That is what a JSON round-trip of a grid produces, so it is part of the
   * shape rather than a tolerance; see `arguments.ts`.
   */
  arguments: { bindings: Array<ArgumentRow | null | undefined> };
  whenEmpty?: EmptyArgumentMode;
}

/** True when a row binds nothing — every declared cell is UNDEF. */
function isAllUndefRow(row: ArgumentRow | null | undefined): boolean {
  if (row == null) return true;
  const values = Object.values(row);
  return values.length === 0 || values.every((v) => v == null);
}

/**
 * Apply argument sets to a compiled template, returning the query to dispatch.
 *
 * Mirrors `SparqlQueryParser.applyArguments`'s contract exactly — same arity check,
 * same variable matching, same `whenEmpty` semantics, same rejection of a wildcard
 * row mixed with bound rows. Divergence here is a bug, and the differential suite
 * in parser.template-equivalence.test.ts exists to catch it.
 */
/**
 * Pair argument sets with the slots they are for, by variable rather than order.
 *
 * A caller supplies one argument set per parameter slot, and the obvious reading
 * is that the nth set fills the nth slot. That is a trap: an argument set knows
 * which variables it binds -- it says so in `head.vars` -- and the order it
 * happens to arrive in is an artefact of wherever it came from. An argument set
 * stored against a query keeps the order its rows were written in, so a
 * perfectly valid saved payload can present `?facetField` before `?term` for a
 * query that declares `?term` first, and a positional reading rejects it with
 * "Variable mismatch" for arguments that match the query exactly.
 *
 * So slots claim their sets by signature, in slot order. Two slots declaring the
 * same variables are genuinely interchangeable, and taking the first unclaimed
 * match keeps them positional with respect to each other -- which is the only
 * signal available when the signatures cannot tell them apart.
 *
 * Returns null when no complete assignment exists, leaving the caller to report
 * the mismatch in its own words: this function's job is to find an arrangement,
 * not to decide what a missing one means.
 */
export function alignArgumentSets<T extends { head?: { vars?: string[] } }>(
  slotVars: readonly (readonly string[])[],
  argumentSets: readonly T[],
): T[] | null {
  if (slotVars.length !== argumentSets.length) return null;

  const signature = (vars: readonly string[] | undefined) =>
    vars ? [...vars].slice().sort().join(' ') : null;

  const unclaimed = argumentSets.map((set) => ({ set, taken: false }));
  const aligned: T[] = [];

  for (const vars of slotVars) {
    const wanted = signature(vars);
    const at = unclaimed.findIndex(
      (entry) => !entry.taken && signature(entry.set?.head?.vars) === wanted,
    );
    // A set with no head cannot be matched by signature, and one whose head
    // matches nothing is a real mismatch. Either way there is no arrangement.
    if (at === -1) return null;
    unclaimed[at].taken = true;
    aligned.push(unclaimed[at].set);
  }

  return aligned;
}

export function applyTemplateArguments(
  template: QueryTemplate,
  argumentSets: TemplateArgumentSet[],
): string {
  if (!Array.isArray(argumentSets)) {
    throw new Error('Invalid arguments format: Expected an array of argument sets.');
  }
  if (template.slots.length !== argumentSets.length) {
    throw new Error(
      `Mismatch: Found ${template.slots.length} UNDEF VALUES clauses, but received ${argumentSets.length} argument sets.`,
    );
  }

  /*
   * Order the sets by the slots they name before walking positionally. An
   * arrangement that matches is used; when none does, the caller's own order is
   * kept so the per-slot checks below report the mismatch as they always have.
   */
  const ordered =
    alignArgumentSets(
      template.slots.map((slot) => slot.vars),
      argumentSets,
    ) ?? argumentSets;

  let out = '';
  let cursor = 0;

  template.slots.forEach((slot, index) => {
    const argSet = ordered[index];
    if (!argSet || !argSet.head || !Array.isArray(argSet.head.vars) || !argSet.arguments || !Array.isArray(argSet.arguments.bindings)) {
      throw new Error(
        `Invalid structure for argument set at index ${index}. Expected { head: { vars: [...] }, arguments: { bindings: [...] } }.`,
      );
    }

    const patternVars = [...slot.vars].sort();
    const argVars = [...argSet.head.vars].sort();
    if (patternVars.length !== argVars.length || !patternVars.every((v, i) => v === argVars[i])) {
      throw new Error(
        `Variable mismatch for VALUES clause ${index + 1}. Query expects [${patternVars.join(', ')}], arguments provide [${argVars.join(', ')}].`,
      );
    }

    const bindings = argSet.arguments.bindings;
    const wildcardRows = bindings.filter(isAllUndefRow);
    if (bindings.length > 1 && wildcardRows.length > 0) {
      throw new Error(
        `Invalid bindings for VALUES clause ${index + 1}: an all-UNDEF row cannot be mixed with bound rows.`,
      );
    }
    const isWildcard = bindings.length === 1 && wildcardRows.length === 1;

    let replacement: string;
    if (bindings.length === 0 || isWildcard) {
      // `whenEmpty` governs an input that supplied no bound rows. It never
      // discards rows the caller did supply.
      const mode = argSet.whenEmpty ?? (isWildcard ? 'unconstrained' : 'propagateEmpty');
      if (mode === 'require') {
        throw new Error(`Required input for VALUES clause ${index + 1} received no bindings.`);
      }
      // 'unconstrained' drops the slot entirely rather than shipping an UNDEF
      // wildcard; 'propagateEmpty' keeps a zero-row block, which joins to nothing.
      replacement = mode === 'unconstrained' ? '' : renderValuesBlock(slot.vars, [], index, template.prefixes);
    } else {
      replacement = renderValuesBlock(
        slot.vars,
        bindings as Array<Record<string, TermValue | null | undefined>>,
        index,
        template.prefixes,
      );
    }

    out += template.text.slice(cursor, slot.start) + replacement;
    cursor = slot.end;
  });

  return out + template.text.slice(cursor);
}
