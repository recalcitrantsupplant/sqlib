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
 *                      that is not bound before it,
 *                      uses a pattern variable that also appears outside it
 *                      without listing it, assigns a variable that is already
 *                      bound, aggregates over a variable its pattern does not
 *                      bind, or has a `SET` in its pattern that re-binds a
 *                      variable.
 *
 * A `NOT { … }`'s own variables need not be bound outside it: they are
 * existentially quantified within the negated pattern (see W3C `wellformed-04`,
 * a positive test whose `NOT` introduces a fresh variable). Only the FILTERs and
 * SETs inside it are held to the order rule.
 */

export type WellFormednessCategory = 'unbound-head' | 'set-rebinds' | 'use-before-bind' | 'aggregate-scope';

export interface WellFormednessIssue {
  category: WellFormednessCategory;
  ruleIndex: number;
  ruleName?: string;
  message: string;
}

export function checkWellFormed(ruleSet: SrlRuleSet): WellFormednessIssue[] {
  const issues: WellFormednessIssue[] = [];
  ruleSet.rules.forEach((rule, ruleIndex) => {
    checkRule(rule, ruleIndex, issues);
  });
  return issues;
}

function checkRule(rule: SrlRule, ruleIndex: number, issues: WellFormednessIssue[]): void {
  const bodyVars = new Set<string>();
  const setTargets: string[] = [];
  collectBodyVars(rule.body, bodyVars, setTargets);

  checkBindOrder(rule, ruleIndex, issues);
  checkAggregates(rule, (message) => {
    issues.push({ category: 'aggregate-scope', ruleIndex, ruleName: rule.name, message });
  });

  // SET must not re-bind a variable already produced by the body.
  for (const target of setTargets) {
    // bodyVars includes SET targets; a rebind is a target that also appears as a
    // non-SET binding, or as a duplicate SET target.
    const occurrences = setTargets.filter((t) => t === target).length;
    const boundElsewhere = varAppearsOutsideSet(rule.body, target);
    if (boundElsewhere || occurrences > 1) {
      issues.push({
        category: 'set-rebinds',
        ruleIndex,
        ruleName: rule.name,
        message: `SET (?${target} := …) re-binds a variable already bound in the body`,
      });
    }
  }

  // Every head variable must be bound by the body.
  for (const v of headVars(rule)) {
    if (!bodyVars.has(v)) {
      issues.push({
        category: 'unbound-head',
        ruleIndex,
        ruleName: rule.name,
        message: `Head variable ?${v} is not bound by the rule body`,
      });
    }
  }
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
function checkBindOrder(rule: SrlRule, ruleIndex: number, issues: WellFormednessIssue[]): void {
  walkBindOrder(rule.body, new Set(), (name, kind) => {
    issues.push({
      category: 'use-before-bind',
      ruleIndex,
      ruleName: rule.name,
      message: `?${name} is used by a ${kind === 'filter' ? 'FILTER' : 'SET'} before it is bound`,
    });
  });
}

function walkBindOrder(
  items: SrlBodyItem[],
  outer: ReadonlySet<string>,
  report: (name: string, kind: 'filter' | 'set') => void,
): void {
  const bound = new Set(outer);
  for (const item of items) {
    if (item.kind === 'filter' || item.kind === 'set') {
      const used = new Set<string>();
      collectVars(item.kind === 'filter' ? item.filter : item.expr, used);
      for (const name of used) if (!bound.has(name)) report(name, item.kind);
    } else if (item.kind === 'not') {
      // Binds nothing outside; inside, it sees what is bound so far.
      walkBindOrder(item.body, bound, report);
    } else if (item.kind === 'aggregate') {
      // Inside, it sees only its keys; whether those are bound is
      // `checkAggregates`' business, not an order fault inside the pattern.
      walkBindOrder(item.body, new Set(item.keys), report);
      narrowToGroup(bound, item.keys);
    }
    for (const name of boundBy(item)) bound.add(name);
  }
}

/** After a `GROUP` only its keys (and its results) stay bound. */
function narrowToGroup(bound: Set<string>, keys: readonly string[]): void {
  for (const name of [...bound]) if (!keys.includes(name)) bound.delete(name);
}

/**
 * The scope rules of `GROUP`.
 *
 * The one that matters most is the third. A pattern variable that is not a key
 * is local to the `GROUP`, so a name that also appears outside it would be two
 * variables spelled alike: correlated if the author meant it, independent if
 * they did not, and nothing on the page says which. Making the clash an error
 * means correlation is always written down, in the `BY` list.
 *
 * The first, that a `BY` variable is bound before the `GROUP`, is what lets a
 * key with nothing to count still have a row: the keys come from the rule body
 * rather than from what the pattern happens to match.
 */
function checkAggregates(rule: SrlRule, report: (message: string) => void): void {
  const bound = new Set<string>();
  rule.body.forEach((item, index) => {
    if (item.kind === 'aggregate') {
      checkAggregate(item, index, rule, bound, report);
      narrowToGroup(bound, item.keys);
    }
    for (const name of boundBy(item)) bound.add(name);
  });
}

function checkAggregate(
  item: SrlAggregate,
  index: number,
  rule: SrlRule,
  boundBefore: ReadonlySet<string>,
  report: (message: string) => void,
): void {
  const keys = item.keys;
  const inner = aggregateInnerVars(item);

  // A key the pattern does not use is allowed: it is carried through the
  // GROUP unchanged, which is how a second GROUP keeps the first one's results
  // (`GROUP BY ?x ?n { … } [ ?m := … ]`).
  for (const key of keys) {
    if (!boundBefore.has(key)) report(`GROUP BY ?${key} is not bound before the GROUP`);
  }

  // Every name used anywhere in the rule except inside this GROUP.
  const outside = new Set<string>();
  collectVars(rule.head, outside);
  rule.body.forEach((other, otherIndex) => {
    if (otherIndex === index) return;
    if (other.kind === 'aggregate') {
      // Another GROUP's pattern variables are its own business; its keys and
      // results are names of the outer body.
      for (const name of other.keys) outside.add(name);
      for (const name of boundBy(other)) outside.add(name);
      return;
    }
    collectVars(other, outside);
    for (const name of boundBy(other)) outside.add(name);
  });
  for (const name of inner) {
    if (keys.includes(name) || !outside.has(name)) continue;
    report(
      `?${name} is used in the GROUP pattern and outside it; list it after GROUP BY to correlate it, `
      + 'or rename the one in the pattern',
    );
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

  // A SET in the pattern follows the body's rule: its target must be new.
  const patternBound = new Set<string>(keys);
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
 * results. A FILTER binds nothing, and neither does a NOT — its variables are
 * existential — nor a GROUP's pattern.
 *
 * A GROUP also *unbinds* every earlier variable that is not one of its keys;
 * callers walking a body in order handle that themselves.
 */
export function boundBy(item: SrlBodyItem): string[] {
  const out = new Set<string>();
  if (item.kind === 'bgp') collectVars(item.triples, out);
  else if (item.kind === 'tuple') collectVars(item.tuple.terms, out);
  else if (item.kind === 'set') out.add(item.variable);
  else if (item.kind === 'aggregate') for (const a of item.assignments) out.add(a.variable);
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

function collectBodyVars(items: SrlBodyItem[], into: Set<string>, setTargets: string[]): void {
  for (const item of items) {
    // Variables under NOT do not *bind* head variables (negation as failure),
    // and a FILTER binds nothing, so `boundBy` returns nothing for either. A
    // GROUP binds its results, after unbinding every earlier variable that is
    // not one of its keys.
    if (item.kind === 'aggregate') narrowToGroup(into, item.keys);
    for (const name of boundBy(item)) into.add(name);
    if (item.kind === 'set') setTargets.push(item.variable);
  }
}

function varAppearsOutsideSet(items: SrlBodyItem[], name: string): boolean {
  return items.some((item) => item.kind !== 'set' && boundBy(item).includes(name));
}
