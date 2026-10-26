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

function collectBodyVars(items: SrlBodyItem[], into: Set<string>, setTargets: string[]): void {
  for (const item of items) {
    // Variables under NOT do not *bind* head variables (negation as failure),
    // and a FILTER binds nothing, so `boundBy` returns nothing for either. A
    // GROUP binds its keys and results and keeps every earlier variable.
    for (const name of boundBy(item)) into.add(name);
    if (item.kind === 'set') setTargets.push(item.variable);
  }
}

function varAppearsOutsideSet(items: SrlBodyItem[], name: string): boolean {
  return items.some((item) => item.kind !== 'set' && boundBy(item).includes(name));
}
