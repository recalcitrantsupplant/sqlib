import type { SrlAggregate, SrlBodyItem, SrlRule, SrlRuleSet } from './ast.js';
import { aggregateInnerVars } from './aggregates/scope.js';

/**
 * SRL well-formedness checks (separate from syntax — the input is already a
 * successfully parsed rule set).
 *
 * Categories map to the W3C suite's well-formedness conditions:
 *  - `unbound-head`:   a head variable is not bound anywhere in the body.
 *  - `set-rebinds`:    `SET (?v := …)` targets a variable already bound by the
 *                      body (SRL forbids re-assignment).
 *  - `use-before-bind`: a `FILTER` / `SET` expression references a variable that
 *                      is not yet bound at that point in the body. SRL evaluates
 *                      a body sequentially (unlike SPARQL, where FILTER is scoped
 *                      to the whole group), so order matters.
 *
 *  - `aggregate-scope`: a `GROUP` (w3c/data-shapes#1347) lists a `BY` variable
 *                      that neither the body before it nor its pattern binds,
 *                      assigns a variable that is already
 *                      bound, aggregates over a variable its pattern does not
 *                      bind, or has a `SET` in its pattern that re-binds a
 *                      variable.
 *
 * A `NOT { … }`'s own variables need not be bound outside it: they are
 * existentially quantified within the negated pattern (see W3C `wellformed-04`,
 * a positive test whose `NOT` introduces a fresh variable). Only the FILTERs and
 * SETs inside it are held to the order rule.
 */

export type WellFormednessCategory =
  | 'unbound-head'
  | 'set-rebinds'
  | 'use-before-bind'
  | 'aggregate-scope'
  | 'group-shadowing'
  | 'not-before-binding';

/**
 * `error` makes the document ill-formed. `warning` and `info` mark a rule that
 * is legal but probably not what its author meant; a document with only those
 * is well-formed.
 */
export type WellFormednessSeverity = 'error' | 'warning' | 'info';

export interface WellFormednessIssue {
  category: WellFormednessCategory;
  severity: WellFormednessSeverity;
  ruleIndex: number;
  ruleName?: string;
  message: string;
  /**
   * The range the issue is about, in the document that was parsed, in UTF-16
   * code units (JavaScript string indices, and CodeMirror's positions). The
   * variable concerned when the document was parsed with `sourceLocations`,
   * else the whole rule.
   */
  from: number;
  to: number;
}

/** Only the issues that make a document ill-formed. */
export function wellFormednessErrors(issues: readonly WellFormednessIssue[]): WellFormednessIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}

/**
 * Every issue in a rule set, errors and warnings both. A document is
 * well-formed when none has the severity `error` (see `wellFormednessErrors`).
 */
export function checkWellFormed(ruleSet: SrlRuleSet): WellFormednessIssue[] {
  const issues: WellFormednessIssue[] = [];
  ruleSet.rules.forEach((rule, ruleIndex) => {
    checkRule(rule, ruleIndex, issues);
  });
  return issues;
}

/** A range in the document, or none when the parse kept no locations. */
type Range = { from: number; to: number } | undefined;

type Report = (
  category: WellFormednessCategory,
  message: string,
  range?: Range,
  severity?: WellFormednessSeverity,
) => void;

function checkRule(rule: SrlRule, ruleIndex: number, issues: WellFormednessIssue[]): void {
  const report: Report = (category, message, range, severity = 'error') => {
    issues.push({
      category,
      severity,
      ruleIndex,
      ruleName: rule.name,
      message,
      from: range?.from ?? rule.span[0],
      to: range?.to ?? rule.span[1],
    });
  };
  const bodyVars = new Set<string>();
  const setTargets: SetTarget[] = [];
  collectBodyVars(rule.body, bodyVars, setTargets);

  checkBindOrder(rule, report);
  checkAggregates(rule, (message) => report('aggregate-scope', message));
  checkGroupShadowing(rule, report);
  checkNotBeforeBinding(rule, report);

  // SET must not re-bind a variable already produced by the body.
  for (const target of setTargets) {
    // bodyVars includes SET targets; a rebind is a target that also appears as a
    // non-SET binding, or as a duplicate SET target.
    const occurrences = setTargets.filter((t) => t.name === target.name).length;
    const boundElsewhere = varAppearsOutsideSet(rule.body, target.name);
    if (boundElsewhere || occurrences > 1) {
      report('set-rebinds', `SET (?${target.name} := …) re-binds a variable already bound in the body`, target.range);
    }
  }

  // Every head variable must be bound by the body.
  const head: Occurrence[] = [];
  collectOccurrences(rule.head, head);
  collectOccurrences(rule.headTuples, head);
  for (const v of headVars(rule)) {
    if (!bodyVars.has(v)) {
      report('unbound-head', `Head variable ?${v} is not bound by the rule body`, head.find((o) => !o.blank && o.name === v)?.range);
    }
  }
}

/** A SET target, with where it is when the parse kept locations. */
interface SetTarget {
  name: string;
  range: Range;
}

function setTargetOf(item: Extract<SrlBodyItem, { kind: 'set' }>): SetTarget {
  const at = item.variableAt;
  // `?` or `$`, then the name.
  return { name: item.variable, range: at === undefined ? undefined : { from: at, to: at + 1 + item.variable.length } };
}

/** One variable or labelled blank node in a rule, and where it was written. */
interface Occurrence {
  name: string;
  /** A blank node label (`_:b`, stored as `e_b`) rather than a variable. */
  blank: boolean;
  /** Undefined for an AST parsed without `sourceLocations`. */
  range: Range;
}

/**
 * Every variable and labelled blank node under an AST node, in document order.
 *
 * Traqula records where a term starts but not where it ends, so the end comes
 * from its spelling: `?` or `$` and the name, or `_:` and the label (which
 * Traqula stores as `e_<label>`).
 */
function collectOccurrences(node: unknown, into: Occurrence[]): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n.type === 'term' && (n.subType === 'variable' || n.subType === 'blankNode')) {
    const loc = n.loc as { sourceLocationType?: unknown; start?: unknown } | undefined;
    const start = loc?.sourceLocationType === 'source' && typeof loc.start === 'number' ? loc.start : undefined;
    const blank = n.subType === 'blankNode';
    const name = String((blank ? n.label : n.value) ?? '');
    // `g_…` labels are minted for `[]`, which no other term can name.
    if (blank && !name.startsWith('e_')) return;
    // `e_b` is spelled `_:b`, one longer; `?o` and `$o` are one longer than `o`.
    const length = blank ? name.length : name.length + 1;
    into.push({ name, blank, range: start === undefined ? undefined : { from: start, to: start + length } });
    return;
  }
  for (const [key, value] of Object.entries(n)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const v of value) collectOccurrences(v, into);
    } else if (value && typeof value === 'object') {
      collectOccurrences(value, into);
    }
  }
}

/** The pattern occurrences of a `GROUP` or `NOT` element: its triple and tuple patterns, not its expressions. */
function patternOccurrences(items: SrlBodyItem[]): Occurrence[] {
  const out: Occurrence[] = [];
  for (const item of items) {
    if (item.kind === 'bgp') collectOccurrences(item.triples, out);
    else if (item.kind === 'tuple') collectOccurrences(item.tuple.terms, out);
  }
  return out;
}

/**
 * `group-shadowing`: a variable in a `GROUP` pattern with the name of one bound
 * before the `GROUP`, but not listed after `BY`.
 *
 * The pattern sees only its keys (w3c/data-shapes#1377), so the two are
 * separate variables. Used in a FILTER, a SET expression or an aggregate, that
 * is an error `checkAggregates` reports; in a triple pattern or as a SET target
 * it is legal (W3C proposed test `eval-group-09` depends on it), and probably
 * not what was meant. A labelled blank node is a variable in a body, so the
 * same holds for one, except that it cannot be listed after `BY`.
 */
function checkGroupShadowing(rule: SrlRule, report: Report): void {
  const bound = new Set<string>();
  const boundBlanks = new Set<string>();
  for (const item of rule.body) {
    if (item.kind === 'aggregate') {
      const keys = new Set(item.keys);
      for (const occurrence of patternOccurrences(item.body)) {
        if (occurrence.blank) {
          if (!boundBlanks.has(occurrence.name)) continue;
          const label = occurrence.name.slice(2);
          report(
            'group-shadowing',
            `_:${label} here is a separate blank node from the _:${label} before this GROUP. `
              + `Replace the label by a variable and list it after BY to use the same value.`,
            occurrence.range,
            'warning',
          );
        } else if (bound.has(occurrence.name) && !keys.has(occurrence.name)) {
          report('group-shadowing', shadowMessage(occurrence.name), occurrence.range, 'warning');
        }
      }
      for (const inner of item.body) {
        if (inner.kind !== 'set') continue;
        const target = setTargetOf(inner);
        if (bound.has(target.name) && !keys.has(target.name)) {
          report('group-shadowing', shadowMessage(target.name), target.range, 'warning');
        }
      }
    }
    for (const name of boundBy(item)) bound.add(name);
    for (const occurrence of patternOccurrences([item])) if (occurrence.blank) boundBlanks.add(occurrence.name);
  }
}

function shadowMessage(name: string): string {
  return `?${name} here is a separate variable from the ?${name} bound before this GROUP. `
    + 'List it after BY to use the same value.';
}

/**
 * `not-before-binding`: a variable in a `NOT` pattern that is unbound when the
 * `NOT` runs and bound by a later element of the body.
 *
 * A `NOT` is checked against what is bound before it, so inside it the
 * variable is a separate, existential one. SPARQL's `FILTER NOT EXISTS`
 * applies to its whole group wherever it is written, so an author used to it
 * can expect the later binding to apply. `info`, not `warning`: a `NOT` placed
 * first to ask whether something has no match at all is a legitimate rule.
 */
function checkNotBeforeBinding(rule: SrlRule, report: Report): void {
  const bound = new Set<string>();
  rule.body.forEach((item, index) => {
    if (item.kind === 'not') {
      const later = new Set(rule.body.slice(index + 1).flatMap((after) => boundBy(after)));
      for (const occurrence of patternOccurrences(item.body)) {
        if (occurrence.blank || bound.has(occurrence.name) || !later.has(occurrence.name)) continue;
        report(
          'not-before-binding',
          `?${occurrence.name} in this NOT is a separate variable from the ?${occurrence.name} bound later in the body: `
            + 'a NOT sees only what is bound before it. Move the NOT after the pattern that binds '
            + `?${occurrence.name} to use the same value.`,
          occurrence.range,
          'info',
        );
      }
    }
    for (const name of boundBy(item)) bound.add(name);
  });
}

/**
 * Sequential "bound before use": walk body items in order, accumulating bound
 * variables, and require that every variable referenced by a FILTER or SET
 * expression is already bound at that point.
 *
 * The walk goes into `NOT { … }` too. The spec's negation condition asks that
 * the inner pattern be well-formed given the variables bound before the NOT,
 * so a FILTER inside it may use those plus whatever the inner pattern binds
 * ahead of it — and nothing bound later in the outer body.
 */
function checkBindOrder(rule: SrlRule, report: Report): void {
  walkBindOrder(rule.body, new Set(), (name, kind, range) => {
    report('use-before-bind', `?${name} is used by a ${kind === 'filter' ? 'FILTER' : 'SET'} before it is bound`, range);
  });
}

function walkBindOrder(
  items: SrlBodyItem[],
  outer: ReadonlySet<string>,
  report: (name: string, kind: 'filter' | 'set', range: Range) => void,
): void {
  const bound = new Set(outer);
  for (const item of items) {
    if (item.kind === 'filter' || item.kind === 'set') {
      const expression = item.kind === 'filter' ? item.filter : item.expr;
      const used = new Set<string>();
      collectVars(expression, used);
      const where: Occurrence[] = [];
      collectOccurrences(expression, where);
      for (const name of used) {
        if (!bound.has(name)) report(name, item.kind, where.find((o) => !o.blank && o.name === name)?.range);
      }
    } else if (item.kind === 'not') {
      // Binds nothing outside; inside, it sees what is bound so far.
      walkBindOrder(item.body, bound, report);
    } else if (item.kind === 'aggregate') {
      // Inside, it sees only the keys bound before it; a key the pattern binds
      // itself is held to the order rule like any other pattern variable.
      walkBindOrder(item.body, new Set(item.keys.filter((k) => bound.has(k))), report);
    }
    for (const name of boundBy(item)) bound.add(name);
  }
}

/**
 * The scope rules of `GROUP`.
 *
 * A pattern variable that is not a key is local to the `GROUP`, as a variable
 * a subquery does not project is local to it: one of the same name before or
 * after the `GROUP` is a different variable (w3c/data-shapes#840). Listing it
 * after `GROUP BY` correlates it.
 *
 * A key is bound before the `GROUP`, by its pattern, or both. The pattern sees
 * only the keys bound before it (`GKin` in w3c/data-shapes#1377), so a `SET` in
 * the pattern may compute a key that the body has not bound.
 */
function checkAggregates(rule: SrlRule, report: (message: string) => void): void {
  const bound = new Set<string>();
  rule.body.forEach((item) => {
    if (item.kind === 'aggregate') checkAggregate(item, rule, bound, report);
    for (const name of boundBy(item)) bound.add(name);
  });
}

function checkAggregate(
  item: SrlAggregate,
  rule: SrlRule,
  boundBefore: ReadonlySet<string>,
  report: (message: string) => void,
): void {
  const keys = item.keys;
  const inner = aggregateInnerVars(item);
  const index = rule.body.indexOf(item);

  // A key bound before but not used by the pattern is allowed: it is carried
  // through the GROUP unchanged.
  const patternBinds = new Set(item.body.flatMap((innerItem) => boundBy(innerItem)));
  for (const key of keys) {
    if (!boundBefore.has(key) && !patternBinds.has(key)) {
      report(`GROUP BY ?${key} is bound neither before the GROUP nor by its pattern`);
    }
  }

  const results = item.assignments.map((a) => a.variable);
  results.forEach((name, position) => {
    if (boundBefore.has(name) || inner.has(name) || results.indexOf(name) !== position) {
      report(`GROUP assigns ?${name}, which is already bound`);
    }
  });
  // A SET or another aggregate assigning the same name later is a rebind too;
  // a pattern mentioning it later is a join, which is allowed.
  rule.body.slice(index + 1).forEach((later) => {
    const assigned = later.kind === 'set' ? [later.variable]
      : later.kind === 'aggregate' ? later.assignments.map((a) => a.variable) : [];
    for (const name of assigned) {
      if (results.includes(name)) report(`?${name} is assigned by a GROUP and again later in the body`);
    }
  });

  // A SET in the pattern follows the body's rule: its target must be new. The
  // pattern starts from the keys bound before the GROUP (GKin in
  // w3c/data-shapes#1377), so a SET may compute a key the body has not bound.
  const patternBound = new Set<string>(keys.filter((k) => boundBefore.has(k)));
  for (const innerItem of item.body) {
    if (innerItem.kind === 'set' && patternBound.has(innerItem.variable)) {
      report(`SET (?${innerItem.variable} := …) in the GROUP pattern re-binds a variable already bound there`);
    }
    for (const name of boundBy(innerItem)) patternBound.add(name);
  }
  for (const { aggregate } of item.assignments) {
    const used = new Set<string>();
    collectVars(aggregate, used);
    for (const name of used) {
      if (!patternBound.has(name)) report(`The aggregate over ?${name} uses a variable the GROUP pattern does not bind`);
    }
  }
}

/**
 * The variables one body element binds for the elements after it: a triple
 * pattern's and a tuple pattern's variables, a SET's target, and a GROUP's
 * keys and results. A FILTER binds nothing, and neither does a NOT — its
 * variables are existential — nor a GROUP's pattern beyond its keys.
 */
export function boundBy(item: SrlBodyItem): string[] {
  const out = new Set<string>();
  if (item.kind === 'bgp') collectVars(item.triples, out);
  else if (item.kind === 'tuple') collectVars(item.tuple.terms, out);
  else if (item.kind === 'set') out.add(item.variable);
  else if (item.kind === 'aggregate') {
    for (const key of item.keys) out.add(key);
    for (const a of item.assignments) out.add(a.variable);
  }
  return [...out];
}

/** Collect every variable name appearing anywhere in an AST node. */
export function collectVars(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, any>;
  if (n.type === 'term' && n.subType === 'variable') {
    into.add(String(n.value ?? ''));
    return;
  }
  for (const [key, value] of Object.entries(n)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const v of value) collectVars(v, into);
    } else if (value && typeof value === 'object') {
      collectVars(value, into);
    }
  }
}

/**
 * Every variable in the head templates, at any depth: inside `[ … ]`,
 * `( … )`, `<<( … )>>` and annotations as well as at the top level.
 */
function headVars(rule: SrlRule): Set<string> {
  const out = new Set<string>();
  collectVars(rule.head, out);
  collectVars(rule.headTuples, out);
  return out;
}

function collectBodyVars(items: SrlBodyItem[], into: Set<string>, setTargets: SetTarget[]): void {
  for (const item of items) {
    // Variables under NOT do not *bind* head variables (negation as failure),
    // and a FILTER binds nothing, so `boundBy` returns nothing for either. A
    // GROUP binds its keys and results and keeps every earlier variable.
    for (const name of boundBy(item)) into.add(name);
    if (item.kind === 'set') setTargets.push(setTargetOf(item));
  }
}

function varAppearsOutsideSet(items: SrlBodyItem[], name: string): boolean {
  return items.some((item) => item.kind !== 'set' && boundBy(item).includes(name));
}
