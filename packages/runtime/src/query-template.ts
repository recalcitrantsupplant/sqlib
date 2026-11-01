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

/**
 * An argument set ready to substitute: a SPARQL Results JSON document, plus the
 * empty-input policy the runtime attaches.
 */
export interface TemplateArgumentSet {
  head: { vars: string[] };
  /**
   * A whole `null` or missing row is a blank row — every declared cell UNDEF.
   * That is what a JSON round-trip of a grid produces, so it is part of the
   * shape rather than a tolerance; see `arguments.ts`.
   */
  results: { bindings: Array<ArgumentRow | null | undefined> };
  /**
   * What a slot that received no bound rows means. Never on the wire: a caller
   * says "nothing arrived" by omitting the slot and "the empty set arrived" by
   * sending zero rows. The runtime sets it for an omitted slot, and a group sets
   * it from the author's edge policy (`require` is only ever the author's).
   */
  whenEmpty?: EmptyArgumentMode;
}

/**
 * The query author's empty-input policy for one parameter slot.
 *
 * It lives on the slot's input tuple, not in the query text, and it is what an
 * omitted slot, a lone all-UNDEF row or zero rows mean for this query. A slot
 * with no policy keeps the built-in reading: omitted runs open, zero rows match
 * nothing. Slots are named by their variables, as argument sets name them.
 */
export interface SlotPolicy {
  vars: readonly string[];
  whenEmpty: EmptyArgumentMode;
}

/**
 * The caller's identity slots.
 *
 * A query reads who is calling it through `VALUES ?authUser { UNDEF }` and
 * `VALUES ?authGroup { UNDEF }`. sqlib fills them from the sign-in; no argument
 * can. See `docs/guides/publishing-tools.md` ("The caller").
 */
export const AUTH_USER_VARIABLE = 'authUser';
export const AUTH_GROUP_VARIABLE = 'authGroup';
export const RESERVED_SLOT_VARIABLES: readonly string[] = [AUTH_USER_VARIABLE, AUTH_GROUP_VARIABLE];

export function isReservedSlotVariable(name: string): boolean {
  return RESERVED_SLOT_VARIABLES.includes(name);
}

/** Who a run is for: a user or client principal IRI, and its group principal IRIs. */
export interface CallerIdentity {
  user: string;
  groups: readonly string[];
}

/**
 * How a substitution fills the caller's identity slots.
 *
 * `caller` is three-valued, and the difference matters:
 *
 * - an identity fills `?authUser` with one row and `?authGroup` with one row
 *   per group;
 * - `null` says "no one": both slots get zero rows, so a query that joins on
 *   them matches nothing;
 * - omitted is a bug in the caller of this function, not a user error. A text
 *   that declares a slot is refused rather than run with the slot open,
 *   because an open slot would match every caller.
 */
export interface SubstitutionOptions {
  caller?: CallerIdentity | null;
  /**
   * Template verification only: probes fill reserved slots like any other,
   * so the template is checked on them too. Never set from a request.
   */
  verifyingTemplate?: boolean;
}

/** A refusal about the identity slots. A route answers it with a 400. */
export class ReservedSlotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReservedSlotError';
  }
}

/**
 * True when a text may declare an identity slot. A cheap text test, so that a
 * caller can decide to substitute even when it has no arguments: a false
 * positive costs one substitution, a false negative is impossible, because a
 * slot needs the variable name in the text.
 */
export function mayDeclareReservedSlot(queryString: string): boolean {
  return /[?$]auth(?:User|Group)\b/.test(queryString);
}

/**
 * The argument sets with the identity slots filled from `caller`.
 *
 * Refuses an argument set that names a reserved variable, a reserved variable
 * inside a multi-variable slot, and a declared slot with no `caller` option.
 * A filled set carries `whenEmpty: 'propagateEmpty'`, so no author policy can
 * turn "no caller" into "every caller".
 */
export function withCallerArguments(
  slotVars: readonly (readonly string[])[],
  argumentSets: readonly TemplateArgumentSet[],
  options: SubstitutionOptions,
): TemplateArgumentSet[] {
  if (options.verifyingTemplate) return [...argumentSets];
  for (const set of argumentSets) {
    const named = (set?.head?.vars ?? []).filter(isReservedSlotVariable);
    if (named.length > 0) {
      throw new ReservedSlotError(
        `${describeSlot(named)} is filled from the caller's sign-in. An argument cannot set it.`,
      );
    }
  }
  const filled = [...argumentSets];
  for (const vars of slotVars) {
    const reserved = vars.filter(isReservedSlotVariable);
    if (reserved.length === 0) continue;
    if (vars.length > 1) {
      throw new ReservedSlotError(
        `${describeSlot(reserved)} must be declared on its own, as VALUES ?${reserved[0]} { UNDEF }, not inside VALUES (${describeSlot(vars)}).`,
      );
    }
    if (options.caller === undefined) {
      throw new ReservedSlotError(
        `This query reads the caller (${describeSlot(reserved)}) and was run without one.`,
      );
    }
    const name = reserved[0];
    const values = options.caller === null
      ? []
      : name === AUTH_USER_VARIABLE ? [options.caller.user] : [...options.caller.groups];
    filled.push({
      head: { vars: [name] },
      results: { bindings: values.map((value) => ({ [name]: { type: 'uri', value } })) },
      whenEmpty: 'propagateEmpty',
    });
  }
  return filled;
}

/** `?a, ?b` — how a refusal names a slot. */
export function describeSlot(vars: readonly string[]): string {
  return vars.map((v) => `?${v}`).join(', ');
}

/** True when a row binds nothing — every declared cell is UNDEF. */
function isAllUndefRow(row: ArgumentRow | null | undefined): boolean {
  if (row == null) return true;
  const values = Object.values(row);
  return values.length === 0 || values.every((v) => v == null);
}

/**
 * Pair argument sets with the slots they are for, by variable rather than order.
 *
 * A caller supplies at most one argument set per parameter slot, and the obvious
 * reading is that the nth set fills the nth slot. That is a trap: an argument set
 * knows which variables it binds -- it says so in `head.vars` -- and the order it
 * happens to arrive in is an artefact of wherever it came from. An argument set
 * stored against a query keeps the order its rows were written in, so a
 * perfectly valid saved payload can present `?facetField` before `?term` for a
 * query that declares `?term` first.
 *
 * So slots claim their sets by signature, in slot order. Two slots declaring the
 * same variables are genuinely interchangeable, and taking the first unclaimed
 * match keeps them positional with respect to each other -- which is the only
 * signal available when the signatures cannot tell them apart.
 *
 * A slot nothing claims is `undefined` in `slots`: the caller omitted it. A set
 * that claims no slot is returned in `unmatched`, for the caller to report. This
 * function finds the arrangement; deciding what an omission or a leftover means
 * is the caller's.
 */
export function assignArgumentSets<T extends { head?: { vars?: string[] } }>(
  slotVars: readonly (readonly string[])[],
  argumentSets: readonly T[],
): { slots: (T | undefined)[]; unmatched: T[] } {
  const signature = (vars: readonly string[] | undefined) =>
    Array.isArray(vars) ? [...vars].sort().join(' ') : null;

  const unclaimed = argumentSets.map((set) => ({ set, taken: false }));
  const slots = slotVars.map((vars) => {
    const wanted = signature(vars);
    const at = unclaimed.findIndex(
      (entry) => !entry.taken && signature(entry.set?.head?.vars) === wanted,
    );
    if (at === -1) return undefined;
    unclaimed[at].taken = true;
    return unclaimed[at].set;
  });

  return { slots, unmatched: unclaimed.filter((entry) => !entry.taken).map((entry) => entry.set) };
}

/**
 * One argument set per slot, in slot order, ready to substitute.
 *
 * A slot the caller omitted runs unconstrained: nothing arrived, so nothing is
 * filtered. An argument that fits no slot is refused, naming what it binds and
 * what the query declares, because silently dropping it would run the query
 * without a filter the caller asked for.
 *
 * `slotPolicies` are the query author's, from the slot's input tuple. A policy
 * fills in for an omitted slot and for a set that carries no `whenEmpty` of its
 * own. A set that does carry one (a group edge's) wins, except that it cannot
 * reopen a slot the author closed: `unconstrained` over a `require` or
 * `propagateEmpty` slot is refused.
 */
export function completeArgumentSets(
  slotVars: readonly (readonly string[])[],
  suppliedSets: readonly TemplateArgumentSet[],
  slotPolicies: readonly SlotPolicy[] = [],
  options: SubstitutionOptions = {},
): TemplateArgumentSet[] {
  if (!Array.isArray(suppliedSets)) {
    throw new Error('Invalid arguments format: Expected an array of argument sets.');
  }
  suppliedSets.forEach((set, index) => {
    if (!set || !set.head || !Array.isArray(set.head.vars) || !set.results || !Array.isArray(set.results.bindings)) {
      throw new Error(
        `Invalid structure for argument set at index ${index}. Expected { head: { vars: [...] }, results: { bindings: [...] } }.`,
      );
    }
  });
  // The identity slots are filled here, the one step every substitution takes,
  // so that no route can forget them and leave one open.
  const argumentSets = withCallerArguments(slotVars, suppliedSets, options);
  const { slots, unmatched } = assignArgumentSets(slotVars, argumentSets);
  if (unmatched.length > 0) {
    const describe = (vars: readonly string[]) => `[${vars.join(', ')}]`;
    const declared = slotVars.length > 0 ? slotVars.map(describe).join(', ') : 'no VALUES parameters';
    throw new Error(
      `Argument ${unmatched.map((set) => describe(set.head.vars)).join(', ')} matches no VALUES parameter left to fill. The query declares ${declared}.`,
    );
  }
  const policyKey = (vars: readonly string[]) => [...vars].sort().join(' ');
  const policies = new Map(slotPolicies.map((policy) => [policyKey(policy.vars), policy.whenEmpty]));
  return slots.map((set, index) => {
    const policy = policies.get(policyKey(slotVars[index]));
    if (!set) {
      return {
        head: { vars: [...slotVars[index]] },
        results: { bindings: [] },
        whenEmpty: policy ?? 'unconstrained',
      };
    }
    if (!policy) return set;
    if (set.whenEmpty === undefined) return { ...set, whenEmpty: policy };
    if (set.whenEmpty === 'unconstrained' && policy !== 'unconstrained') {
      throw new Error(
        `VALUES clause ${index + 1} (${describeSlot(slotVars[index])}) is marked '${policy}' by its query and cannot be run unconstrained.`,
      );
    }
    return set;
  });
}

/**
 * Apply argument sets to a compiled template, returning the query to dispatch.
 *
 * Mirrors `SparqlQueryParser.applyArguments`'s contract exactly — same slot
 * assignment (omitted slots run open, a leftover argument is refused), same `whenEmpty` semantics, same rejection of a wildcard
 * row mixed with bound rows. Divergence here is a bug, and the differential suite
 * in parser.template-equivalence.test.ts exists to catch it.
 */
export function applyTemplateArguments(
  template: QueryTemplate,
  argumentSets: TemplateArgumentSet[],
  slotPolicies: readonly SlotPolicy[] = [],
  options: SubstitutionOptions = {},
): string {
  const ordered = completeArgumentSets(
    template.slots.map((slot) => slot.vars),
    argumentSets,
    slotPolicies,
    options,
  );

  let out = '';
  let cursor = 0;

  template.slots.forEach((slot, index) => {
    const argSet = ordered[index];

    const patternVars = [...slot.vars].sort();
    const argVars = [...argSet.head.vars].sort();
    if (patternVars.length !== argVars.length || !patternVars.every((v, i) => v === argVars[i])) {
      throw new Error(
        `Variable mismatch for VALUES clause ${index + 1}. Query expects [${patternVars.join(', ')}], arguments provide [${argVars.join(', ')}].`,
      );
    }

    const bindings = argSet.results.bindings;
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
        throw new Error(`Required input for VALUES clause ${index + 1} (${describeSlot(slot.vars)}) received no bindings.`);
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
