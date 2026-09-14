/**
 * What a query asks for, and whether a given argument set answers it.
 *
 * The arguments panel leads with the query's signature — the VALUES clauses it
 * declares and the LIMIT / OFFSET parameters it names — and everything else on
 * the panel is a view of values filling that signature. This module is the
 * signature itself, kept out of the components because three of them need the
 * same answers and a disagreement between them is a set that reads "fits" in
 * the switcher and then binds nothing when it runs.
 */
import type { ArgumentSetDetail, ArgumentTupleBinding, SparqlBinding } from '../types/argument-sets';

/** One VALUES clause the query declares, in the order its variables appear. */
export interface SignatureClause {
  /** Variable names without the leading `?`, in clause order. */
  variables: string[];
  /**
   * 1-based line of the VALUES clause in the query text, when it could be
   * located. Advisory: detection reports variables, not positions, so this is
   * recovered from the text and is absent for a query we cannot re-find it in.
   */
  line?: number;
}

export interface QuerySignature {
  clauses: SignatureClause[];
  limitParameters: string[];
  offsetParameters: string[];
}

/** How well a set's bindings answer a signature. `mismatch` is greyed out. */
export type CompatibilityVerdict = 'fits' | 'partial' | 'mismatch';

export interface Compatibility {
  verdict: CompatibilityVerdict;
  /**
   * One short phrase for the chip's tooltip — "arity 5 ≠ 2", "binds 1 of 2
   * clauses". Empty when the set fits, because "fits" needs no excuse.
   */
  reason: string;
}

/** Detection reports `?x` in some places and `x` in others; the panel wants one. */
export function bareVariable(name: string): string {
  return name.replace(/^\?/, '');
}

/** The stable key for a clause: its variables, order-insensitive. */
export function clauseKey(variables: string[]): string {
  return [...variables.map(bareVariable)].sort().join('|');
}

/**
 * The signature as the API's tuple bindings spell it — variables joined in
 * clause order. This is what `ArgumentTupleBinding.tupleSignature` holds, and
 * it is order-*sensitive*, so it is not interchangeable with `clauseKey`.
 */
export function tupleSignature(variables: string[]): string {
  return variables.map(bareVariable).join('|');
}

/**
 * Recover the line each VALUES clause sits on.
 *
 * `POST /detection/inputs` answers with variable groups and no positions, and
 * adding positions to it would mean re-parsing on the server for a label. The
 * text is right here, so the panel scans it: every `VALUES` keyword, the
 * variable list that follows, matched against the detected clauses in order so
 * that two clauses over the same variables get different lines.
 *
 * Best-effort by construction. A clause we cannot find keeps `line` undefined
 * and the panel simply omits the chip rather than guessing.
 */
export function locateValuesClauses(queryText: string, clauses: string[][]): SignatureClause[] {
  const lines = queryText.split(/\r?\n/);
  /** Every VALUES occurrence in the text, as (key, line). */
  const found: { key: string; line: number }[] = [];

  lines.forEach((text, index) => {
    // A line may open more than one VALUES clause; walk them all.
    const pattern = /\bVALUES\b\s*(\(([^)]*)\)|(\?[A-Za-z0-9_]+))/gi;
    for (const match of text.matchAll(pattern)) {
      const varsText = match[2] ?? match[3] ?? '';
      const variables = [...varsText.matchAll(/\?([A-Za-z0-9_]+)/g)].map((m) => m[1]);
      if (variables.length === 0) continue;
      found.push({ key: clauseKey(variables), line: index + 1 });
    }
  });

  const consumed = new Set<number>();
  return clauses.map((variables) => {
    const key = clauseKey(variables);
    const hit = found.findIndex((candidate, index) => candidate.key === key && !consumed.has(index));
    if (hit === -1) return { variables: variables.map(bareVariable) };
    consumed.add(hit);
    return { variables: variables.map(bareVariable), line: found[hit].line };
  });
}

/** Build the signature the panel renders from detection plus the query text. */
export function buildQuerySignature(
  detected: {
    valuesInputs?: string[][] | null;
    limitParameters?: string[] | null;
    offsetParameters?: string[] | null;
  } | null,
  queryText?: string | null,
): QuerySignature {
  const valuesInputs = detected?.valuesInputs ?? [];
  return {
    clauses: queryText
      ? locateValuesClauses(queryText, valuesInputs)
      : valuesInputs.map((variables) => ({ variables: variables.map(bareVariable) })),
    limitParameters: detected?.limitParameters ?? [],
    offsetParameters: detected?.offsetParameters ?? [],
  };
}

/**
 * Judge a set's tuple bindings against a signature.
 *
 * Only variable names and arity, which is all the model knows today — queries
 * do not declare input type restrictions. When they do, the same verdict grows
 * a type-mismatch case and the chip does not change (design §5).
 */
export function compatibility(
  signature: QuerySignature,
  bindings: ArgumentTupleBinding[],
): Compatibility {
  const wanted = signature.clauses.map((clause) => clauseKey(clause.variables));
  const offered = bindings.map((binding) =>
    clauseKey(binding.variables ?? binding.tupleSignature.split('|')),
  );

  // A set with nothing to offer fits a query that asks for nothing, and is
  // useless — not wrong — against one that asks for something.
  if (wanted.length === 0) {
    return offered.length === 0
      ? { verdict: 'fits', reason: '' }
      : { verdict: 'mismatch', reason: 'this query takes no arguments' };
  }
  if (offered.length === 0) return { verdict: 'mismatch', reason: 'no values' };

  const remaining = [...wanted];
  const matched: string[] = [];
  const unusable: string[] = [];
  for (const key of offered) {
    const at = remaining.indexOf(key);
    if (at === -1) unusable.push(key);
    else {
      matched.push(...remaining.splice(at, 1));
    }
  }

  if (matched.length === 0) {
    // The commonest way to be wrong is to be the right idea at the wrong
    // width, so say the widths rather than "incompatible".
    const arities = new Set(offered.map((key) => key.split('|').length));
    const wantedArities = new Set(wanted.map((key) => key.split('|').length));
    const reason =
      arities.size === 1 && wantedArities.size === 1
        ? `arity ${[...arities][0]} ≠ ${[...wantedArities][0]}`
        : 'no clause in common';
    return { verdict: 'mismatch', reason };
  }

  if (remaining.length === 0 && unusable.length === 0) {
    return { verdict: 'fits', reason: '' };
  }

  const parts: string[] = [];
  if (remaining.length > 0) parts.push(`binds ${matched.length} of ${wanted.length} clauses`);
  if (unusable.length > 0) parts.push(`${unusable.length} unused`);
  return { verdict: 'partial', reason: parts.join(', ') };
}

/** The same judgement for a whole set, saved or scratch. */
export function setCompatibility(
  signature: QuerySignature,
  set: Pick<ArgumentSetDetail, 'tupleBindings' | 'currentVersion'>,
): Compatibility {
  return compatibility(signature, set.currentVersion?.tupleBindings ?? set.tupleBindings ?? []);
}

/**
 * Judge one tuple set against one VALUES clause.
 *
 * Separate from `compatibility` above because the two answer different
 * questions. An argument set binds a *whole* signature, so its verdict is over
 * every clause at once; a tuple set is one relation (design §2), so it is
 * judged against one clause and the caller decides which.
 *
 * Names, not positions — for a query. A tuple set bound to a rule set's
 * `TUPLE(…)` declaration matches positionally and ignores column names
 * entirely (design §6), which is why that case does not share this function.
 *
 * Missing a column is `partial` rather than `mismatch`: a row that omits a
 * variable binds UNDEF, which is legal and leaves that variable unconstrained.
 * Extra columns are `partial` too, and simply go unused.
 */
export function tupleSetFit(clauseVariables: string[], columns: string[]): Compatibility {
  const wanted = clauseVariables.map(bareVariable);
  const offered = columns.map(bareVariable);

  if (offered.length === 0) return { verdict: 'mismatch', reason: 'no columns' };
  if (wanted.length === 0) return { verdict: 'mismatch', reason: 'this clause takes no variables' };

  const offeredSet = new Set(offered);
  const wantedSet = new Set(wanted);
  const missing = wanted.filter((name) => !offeredSet.has(name));
  const extra = offered.filter((name) => !wantedSet.has(name));

  if (missing.length === wanted.length) {
    // The commonest way to be wrong is to be the right idea at the wrong
    // width, so say the widths rather than "incompatible".
    return {
      verdict: 'mismatch',
      reason: offered.length === wanted.length
        ? 'no column names in common'
        : `arity ${offered.length} ≠ ${wanted.length}`,
    };
  }

  if (missing.length === 0 && extra.length === 0) return { verdict: 'fits', reason: '' };

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`${missing.map((name) => `?${name}`).join(', ')} unbound`);
  if (extra.length > 0) parts.push(`${extra.length} column${extra.length === 1 ? '' : 's'} unused`);
  return { verdict: 'partial', reason: parts.join(', ') };
}

/**
 * Drop the blanks on the way out.
 *
 * A cell left empty binds UNDEF, and UNDEF in the SPARQL results format is an
 * absent key rather than an empty string — sending `{"city": {"value": ""}}`
 * binds the empty literal, which matches nothing and looks like a bug in the
 * data. The panel therefore renders blanks and exports omissions.
 */
export function pruneUndef(values: SparqlBinding): SparqlBinding {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => (value?.value ?? '').trim().length > 0),
  );
}

/** A one-line précis of a row, for the collapsed summary on a stacked block. */
export function summariseRow(variables: string[], values: SparqlBinding): string {
  const parts = variables.map((name) => {
    const bare = bareVariable(name);
    const value = values[bare]?.value ?? values[name]?.value ?? '';
    return value.trim().length > 0 ? value : '—';
  });
  return parts.join(' · ');
}
