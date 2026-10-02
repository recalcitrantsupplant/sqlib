import type { SrlAggregate, SrlBodyItem, SrlRule, SrlRuleSet } from './ast.js';
import { aggregateKeys } from './aggregates/scope.js';

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
 *  - `aggregate-scope`: an `AGGREGATE` (rule-aggregates extension) lists a
 *                      variable that is not bound before it or not used inside
 *                      it, uses an inner variable that also appears outside it
 *                      without listing it, assigns a variable that is already
 *                      bound, or aggregates over a variable its pattern does
 *                      not bind.
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
      const keys = aggregateKeys(item, bound);
      walkBindOrder(item.body, new Set(keys), report);
      if (item.mode === 'group') narrowToGroup(bound, keys);
    }
    for (const name of boundBy(item)) bound.add(name);
  }
}

/** After a `GROUP BY` aggregate only its listed variables stay bound. */
function narrowToGroup(bound: Set<string>, keys: readonly string[]): void {
  for (const name of [...bound]) if (!keys.includes(name)) bound.delete(name);
}

/**
 * The scope rules of the rule-aggregates extension.
 *
 * The one that matters most is the third. An inner variable that is not a key
 * is local to the aggregate, so a name that also appears outside it would be
 * two variables spelled alike: correlated if the author meant it, independent
 * if they did not, and nothing on the page says which. Making the clash an
 * error means correlation is always written down, in the key list.
 */
function checkAggregates(rule: SrlRule, report: (message: string) => void): void {
  const bound = new Set<string>();
  rule.body.forEach((item, index) => {
    if (item.kind === 'aggregate') {
      checkAggregate(item, index, rule, bound, report);
      if (item.mode === 'group') narrowToGroup(bound, aggregateKeys(item, bound));
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
  const keys = aggregateKeys(item, boundBefore);
  const inner = new Set<string>();
  collectVars(item.body, inner);
  const listed = item.mode === 'group' ? 'GROUP BY' : 'PER';

  for (const key of item.keys) {
    if (!boundBefore.has(key)) report(`${listed} ?${key} is not bound before the AGGREGATE`);
    if (!inner.has(key)) report(`${listed} ?${key} is not used inside the AGGREGATE`);
  }

  // Every name used anywhere in the rule except inside this aggregate.
  const outside = new Set<string>();
  collectVars(rule.head, outside);
  rule.body.forEach((other, otherIndex) => {
    if (otherIndex === index) return;
    if (other.kind === 'aggregate') {
      // Another aggregate's locals are its own business; its keys and
      // results are names of the outer body.
      for (const name of aggregateKeys(other, new Set())) outside.add(name);
      for (const name of boundBy(other)) outside.add(name);
      return;
    }
    collectVars(other, outside);
    for (const name of boundBy(other)) outside.add(name);
  });
  for (const name of inner) {
    if (keys.includes(name) || !outside.has(name)) continue;
    report(
      `?${name} is used inside the AGGREGATE and outside it; list it after ${listed} to correlate it, `
      + 'or rename the inner one',
    );
  }

  const results = item.assignments.map((a) => a.variable);
  results.forEach((name, position) => {
    if (boundBefore.has(name) || inner.has(name) || results.indexOf(name) !== position) {
      report(`AGGREGATE assigns ?${name}, which is already bound`);
    }
  });
  // A SET or another aggregate assigning the same name later is a rebind too;
  // a pattern mentioning it later is a join, which is allowed.
  rule.body.slice(index + 1).forEach((later) => {
    const assigned = later.kind === 'set' ? [later.variable]
      : later.kind === 'aggregate' ? later.assignments.map((a) => a.variable) : [];
    for (const name of assigned) {
      if (results.includes(name)) report(`?${name} is assigned by an AGGREGATE and again later in the body`);
    }
  });

  const patternBound = new Set<string>(keys);
  for (const innerItem of item.body) for (const name of boundBy(innerItem)) patternBound.add(name);
  for (const { aggregate } of item.assignments) {
    const used = new Set<string>();
    collectVars(aggregate, used);
    for (const name of used) {
      if (!patternBound.has(name)) report(`The aggregate over ?${name} uses a variable the AGGREGATE pattern does not bind`);
    }
  }
}

/**
 * The variables one body element binds for the elements after it: a triple
 * pattern's and a tuple pattern's variables, a SET's target, and an
 * AGGREGATE's results. A FILTER binds nothing, and neither does a NOT — its
 * variables are existential — nor an AGGREGATE's inner pattern.
 *
 * An AGGREGATE in `GROUP BY` mode also *unbinds* every earlier variable it does
 * not list; callers walking a body in order handle that themselves.
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
    // and a FILTER binds nothing, so `boundBy` returns nothing for either. An
    // AGGREGATE binds its results; under `GROUP BY` it first unbinds every
    // earlier variable it does not list.
    if (item.kind === 'aggregate' && item.mode === 'group') narrowToGroup(into, aggregateKeys(item, into));
    for (const name of boundBy(item)) into.add(name);
    if (item.kind === 'set') setTargets.push(item.variable);
  }
}

function varAppearsOutsideSet(items: SrlBodyItem[], name: string): boolean {
  return items.some((item) => item.kind !== 'set' && boundBy(item).includes(name));
}
