import type { SrlBodyItem, SrlTuple } from '../ast.js';

/**
 * Rule-tuples compile support.
 *
 * A tuple has no relation name: the store is keyed by **arity**, and matching is
 * position-by-position unification. So the only static "signature" is the arity
 * plus whichever slots are constants — everything else is decided at execution.
 */

/** A tuple read (body pattern) or write (head template) that a rule performs. */
export interface TupleRef {
  arity: number;
  /**
   * Rendered terms, in order: `?name` for a variable, otherwise the term in
   * SPARQL syntax. Constant slots are what narrow matching at execution time;
   * by convention slot 0 carries an identifying IRI.
   */
  terms: string[];
  /** True when this read sits under a `NOT` (negative dependency). */
  negated?: boolean;
}

/** Render a tuple term for VALUES injection / debugging. */
export function renderTerm(term: any): string {
  if (!term || typeof term !== 'object') return String(term ?? '');
  if (term.subType === 'variable') return `?${String(term.value ?? '')}`;
  if (term.subType === 'namedNode') {
    // `prefix` may be the empty string (`:rel` uses the default prefix), which is
    // still a prefixed name — testing truthiness here would render `<rel>`, a
    // bogus relative IRI. Check for the property's presence instead.
    return typeof term.prefix === 'string'
      ? `${term.prefix}:${String(term.value ?? '')}`
      : `<${String(term.value ?? '')}>`;
  }
  if (term.subType === 'blankNode') return `_:${String(term.label ?? term.value ?? '')}`;
  if (term.subType === 'literal') {
    const lex = JSON.stringify(String(term.value ?? ''));
    const langOrIri = term.langOrIri;
    if (typeof langOrIri === 'string' && langOrIri) return `${lex}@${langOrIri}`;
    if (langOrIri && typeof langOrIri === 'object') return `${lex}^^${renderTerm(langOrIri)}`;
    return lex;
  }
  return String(term.value ?? '');
}

/*
 * The tuple store matches rows by their *rendered* term strings, so the
 * syntactic form of a term is part of the lookup key: `:rel` and
 * `<http://ex/rel>` denote the same IRI and are different tuples. Every API
 * entry point expands before compiling ({@link expandIris}), which is why this
 * has never bitten — but nothing said so, and a caller of this package that
 * compiles without expanding gets a rule that silently infers nothing rather
 * than an error. These predicates state the invariant and let the store enforce
 * it. See issue #165.
 *
 * Deliberately a check, not a normalisation: canonicalising here would need the
 * prologue threaded into the store, and quietly accepting two spellings of one
 * term would leave the *stratifier* — which expands — and the store agreeing by
 * luck rather than by contract.
 */
const EXPANDED_IRI = /^<[^<>"{}|^`\\\s]*>$/;
const BLANK_NODE = /^_:\S+$/;
/** A literal whose datatype, if any, is an absolute IRI. `renderTerm` emits this. */
const EXPANDED_LITERAL =
  /^"(?:[^"\\]|\\.)*"(?:@[A-Za-z]+(?:-[A-Za-z0-9]+)*|\^\^<[^<>"{}|^`\\\s]*>)?$/;
const PREFIXED_NAME = /^[A-Za-zÀ-￿][\w.·À-￿-]*:|^:/;
const TYPED_LITERAL = /^"(?:[^"\\]|\\.)*"\^\^(.+)$/;

/**
 * Why `term` is not a tuple term in expanded form, or `undefined` if it is.
 *
 * Expanded form is what {@link renderTerm} produces once the AST has been
 * through `expandIris`: `<absolute-iri>`, `_:label`, or a literal whose datatype
 * is an absolute IRI. Note that the SRL parser already resolves numeric and
 * boolean shorthands to their datatype form, so `18` in a document reaches this
 * as `"18"^^<…#integer>`; a bare `18` here means a caller hand-built the row.
 */
export function expandedTermIssue(term: string): string | undefined {
  if (EXPANDED_IRI.test(term) || BLANK_NODE.test(term) || EXPANDED_LITERAL.test(term)) return undefined;
  if (term.startsWith('?') || term.startsWith('$')) {
    return `\`${term}\` is a variable, and a stored tuple row must be ground`;
  }
  const typed = TYPED_LITERAL.exec(term);
  if (typed) return `\`${term}\` gives its datatype as \`${typed[1]}\` rather than an absolute IRI`;
  if (/^[+-]?[0-9.]/.test(term) || term === 'true' || term === 'false') {
    return `\`${term}\` is a literal shorthand; the expanded form is \`"…"^^<…>\``;
  }
  if (PREFIXED_NAME.test(term)) return `\`${term}\` is a prefixed name rather than an absolute IRI`;
  return `\`${term}\` is not a SPARQL term in expanded form`;
}

/**
 * Throw unless every term is in expanded form. `what` names the operation, so
 * the message says which side of the store went wrong.
 */
export function assertExpandedTerms(terms: readonly string[], what: string): void {
  for (const term of terms) {
    const issue = expandedTermIssue(term);
    if (issue === undefined) continue;
    throw new Error(
      `${what}: ${issue}. Tuple terms are matched by their rendered form, so a write and a read `
      + 'have to spell a term the same way — expand the parsed rule set with expandIris() before '
      + 'compiling or seeding.',
    );
  }
}

export function toTupleRef(tuple: SrlTuple, negated = false): TupleRef {
  const ref: TupleRef = { arity: tuple.terms.length, terms: tuple.terms.map(renderTerm) };
  if (negated) ref.negated = true;
  return ref;
}

/** Collect every tuple read in a body, marking those under `NOT` as negated. */
export function collectTupleReads(items: SrlBodyItem[], negated = false): TupleRef[] {
  const refs: TupleRef[] = [];
  for (const item of items) {
    if (item.kind === 'tuple') refs.push(toTupleRef(item.tuple, negated));
    else if (item.kind === 'not') refs.push(...collectTupleReads(item.body, true));
  }
  return refs;
}

/**
 * The variables a tuple read binds, in slot order (`undefined` for constant
 * slots). The executor uses this to build the `VALUES` header.
 */
export function tupleVars(ref: TupleRef): Array<string | undefined> {
  return ref.terms.map((t) => (t.startsWith('?') ? t.slice(1) : undefined));
}

/**
 * A tuple-read slot in a compiled program: the `# TUPLE( … )` comment line and
 * the `VALUES` line under it.
 *
 * Groups: the comment line, the `VALUES` header through its opening brace, and
 * the row text between the braces. A substitution re-emits the first two and
 * replaces the third, so the header — where the compiler's generated column
 * names live — and the label above it both survive into the injected program.
 *
 * **The comment is the anchor, and it has to be.** Which rows a slot wants is
 * readable from the `VALUES` line itself (its arity, and the constants pinned
 * into its row), so nothing needs to index into a side array. What is *not*
 * readable is whether a slot has already been filled: a fully-ground read pins
 * every position, so `{ (<r> <a>) }` is what it looks like before substitution
 * and after. The comment line distinguishes the two, and unlike a reserved token
 * it is something a reader wants there anyway.
 *
 * Nothing else in a compiled body can produce this pair: `compileBody` emits
 * comments only for tuple reads, and a `VALUES` only from a tuple placeholder.
 */
export const TUPLE_READ_SLOT =
  /^([ \t]*# TUPLE\([^\n]*\)[ \t]*)\n([ \t]*VALUES[ \t]*\([^)\n]*\)[ \t]*\{)([^\n]*)\}[ \t]*$/gm;

/** The pattern as written, for the comment above a slot: `TUPLE(:rel, ?x, ?y)`. */
export function tuplePatternText(ref: TupleRef): string {
  return `TUPLE(${ref.terms.join(', ')})`;
}

/**
 * Placeholder column for a slot that has no variable of its own — a constant, or
 * a repeat of a variable already declared. Resolved to a real name by
 * {@link resolveSlotVars} once the rest of the program is known.
 */
const SLOT_VAR_TOKEN = /\?@@SV:(\d+):(\d+)@@/g;

/**
 * Replace generated-column placeholders with names that collide with nothing
 * else in the program.
 *
 * A generated name is per (read, slot) — never shared between two reads. Two
 * reads sharing a column name would join on it: `TUPLE(:a, ?x) TUPLE(:b, ?y)`
 * would silently require `:a` and `:b` to be the same term, and the rule would
 * produce nothing. Collision with an author's own variable is worse still, since
 * it constrains a variable the rule actually uses, so a name already present in
 * the program is prefixed until it is free.
 *
 * The scan is textual and deliberately runs over the finished program: it sees
 * the body, the head template and the prologue at once. The tokens themselves
 * cannot be mistaken for variables — `@` is not a `VARNAME` character.
 */
export function resolveSlotVars(program: string): string {
  if (!program.includes('?@@SV:')) return program;
  const used = new Set(program.match(/\?[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  // Memoised per slot, not per occurrence: a column and the `sameTerm` filter
  // that references it are two occurrences of one token, and allocating twice
  // would rename the filter's copy out from under the column it constrains.
  const allocated = new Map<string, string>();
  return program.replace(SLOT_VAR_TOKEN, (_match, read: string, slot: string) => {
    const key = `${read}:${slot}`;
    const seen = allocated.get(key);
    if (seen) return seen;
    let name = `?_read${read}_slot${slot}`;
    while (used.has(name)) name = `?_${name.slice(1)}`;
    used.add(name);
    allocated.set(key, name);
    return name;
  });
}

/**
 * The slot emitted where a body tuple pattern appears. The executor MUST replace
 * its rows with the tuple store's matching rows before running the program.
 *
 * ```sparql
 * # TUPLE(:reach, ?x, ?y)
 * VALUES (?_read0_slot0 ?x ?y) { (<http://ex/reach> UNDEF UNDEF) }
 * ```
 *
 * **One column per position**, so the block states the read's arity — the only
 * thing the tuple store is keyed by — and the rows injected into it are stored
 * rows entire, in slot order.
 *
 * **Constants are pinned, variable positions are `UNDEF`.** That makes the slot
 * say which rows it wants, in the same terms the store matches on: arity, and
 * equality at the constant positions. Nothing has to index into a side array to
 * find out, so two reads of the same arity are told apart by what actually
 * distinguishes them — `TUPLE(:cities, ?n, ?p)` and `TUPLE(:suburbs, ?n, ?p)`
 * differ in slot 0, and that is in the text. An all-`UNDEF` row would be a
 * tidier parameter slot but would erase exactly that.
 *
 * **A repeated variable becomes a `sameTerm` filter**, since `VALUES` cannot
 * declare one column twice and the agreement narrows the selection:
 *
 * ```sparql
 * # TUPLE(:r, ?x, ?x)
 * VALUES (?_read0_slot0 ?x ?_read0_slot2) { (<http://ex/r> UNDEF UNDEF) }
 * FILTER(sameTerm(?x, ?_read0_slot2))
 * ```
 *
 * With that filter emitted, the agreement is enforced by the query rather than
 * by whoever builds the rows — so a filled slot is equivalent to the read, and
 * the injector needs to know nothing about repeats. A position holding a
 * constant, or repeating a variable, has no name of its own and gets a generated
 * one; the generated columns are inert, and `resolveSlotVars` guarantees that
 * stays true.
 *
 * The program still *parses* pre-substitution (useful for validation), but an
 * unsubstituted program is not semantically meaningful: the single reserved row
 * binds the variable positions to nothing, so it yields one solution and joining
 * it is close to the identity, exactly as if the read were absent. Always
 * substitute when `tupleReads.length > 0`.
 *
 * The comment line runs to end-of-line: a caller must put a newline between this
 * and whatever follows, or an enclosing `}` on the same line is swallowed.
 * Continuation lines carry the two-space indent `compileBody` joins parts with,
 * so a slot lines up with the patterns around it — this text is read on the
 * equivalent-SPARQL tab, not just executed.
 */
export function tuplePlaceholder(index: number, ref: TupleRef): string {
  const declared = new Set<string>();
  const header: string[] = [];
  const filters: string[] = [];
  ref.terms.forEach((term, slot) => {
    const isVar = term.startsWith('?');
    if (isVar && !declared.has(term)) {
      declared.add(term);
      header.push(term);
      return;
    }
    const generated = `?@@SV:${index}:${slot}@@`;
    header.push(generated);
    // A repeat of a variable already declared: the columns are separate, so the
    // agreement the pattern asks for has to be said out loud.
    if (isVar) filters.push(`FILTER(sameTerm(${term}, ${generated}))`);
  });
  const row = ref.terms.map((term) => (term.startsWith('?') ? 'UNDEF' : term));
  const values = `VALUES (${header.join(' ')}) { (${row.join(' ')}) }`;
  return [`# ${tuplePatternText(ref)}`, values, ...filters].join('\n  ');
}

/**
 * Read a slot's `VALUES` row back: the terms it wants, position by position,
 * with `undefined` where the row says `UNDEF`.
 *
 * The inverse of what {@link tuplePlaceholder} pins into the row, and the reason
 * substitution needs no side table — arity is the length, and the defined
 * entries are the constants to match on.
 *
 * Tokenised rather than split on whitespace: a rendered term can contain spaces
 * (`"Port Douglas"`), and `UNDEF` inside a literal is a literal, not a hole.
 */
export function readSlotRow(rowText: string): Array<string | undefined> {
  const text = rowText.trim().replace(/^\(/, '').replace(/\)$/, '');
  const terms: Array<string | undefined> = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i += 1; continue; }
    const start = i;
    if (text[i] === '<') {
      i = text.indexOf('>', i) + 1;
      if (i === 0) break; // unterminated IRI: give up rather than guess
    } else {
      if (text[i] === '"' || text[i] === "'") {
        const quote = text[i];
        i += 1;
        while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
        i += 1;
        // A datatype or language tag binds tighter than the space that ends a cell.
        if (text.startsWith('^^', i)) i = text.indexOf('>', i) + 1;
        else if (text[i] === '@') while (i < text.length && !/\s/.test(text[i])) i += 1;
      }
      while (i < text.length && !/\s/.test(text[i])) i += 1;
    }
    const token = text.slice(start, i);
    terms.push(token === 'UNDEF' ? undefined : token);
  }
  return terms;
}
