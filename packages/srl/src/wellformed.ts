import type { SrlBodyItem, SrlRule, SrlRuleSet } from './ast.js';

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
 * Deliberately NOT enforced for `NOT { … }`: its variables are existentially
 * quantified within the negated pattern and need not be bound outside it (see
 * W3C `wellformed-04`, a positive test whose `NOT` introduces a fresh variable).
 */

export type WellFormednessCategory = 'unbound-head' | 'set-rebinds' | 'use-before-bind';

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
  for (const v of headVars(rule.head)) {
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
 */
function checkBindOrder(rule: SrlRule, ruleIndex: number, issues: WellFormednessIssue[]): void {
  const bound = new Set<string>();
  for (const item of rule.body) {
    if (item.kind === 'bgp') {
      const triples = (item.triples as any)?.triples;
      if (Array.isArray(triples)) for (const t of triples) collectTermVars(t, bound);
      continue;
    }
    if (item.kind === 'filter' || item.kind === 'set') {
      const used = new Set<string>();
      collectVars(item.kind === 'filter' ? item.filter : item.expr, used);
      for (const name of used) {
        if (!bound.has(name)) {
          issues.push({
            category: 'use-before-bind',
            ruleIndex,
            ruleName: rule.name,
            message: `?${name} is used by a ${item.kind === 'filter' ? 'FILTER' : 'SET'} before it is bound`,
          });
        }
      }
      if (item.kind === 'set') bound.add(item.variable);
    }
    // 'not' binds nothing and its variables are existentially scoped — skipped.
  }
}

/** Collect every variable name appearing anywhere in an AST node. */
function collectVars(node: unknown, into: Set<string>): void {
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

function headVars(head: unknown): Set<string> {
  const out = new Set<string>();
  const triples = (head as any)?.triples;
  if (Array.isArray(triples)) for (const t of triples) collectTermVars(t, out);
  return out;
}

function collectBodyVars(items: SrlBodyItem[], into: Set<string>, setTargets: string[]): void {
  for (const item of items) {
    if (item.kind === 'bgp') {
      const triples = (item.triples as any)?.triples;
      if (Array.isArray(triples)) for (const t of triples) collectTermVars(t, into);
    } else if (item.kind === 'not') {
      // Variables under NOT do not *bind* head variables (negation as failure),
      // so they are not added to the binding set.
    } else if (item.kind === 'set') {
      into.add(item.variable);
      setTargets.push(item.variable);
    }
    // 'filter' binds nothing.
  }
}

function varAppearsOutsideSet(items: SrlBodyItem[], name: string): boolean {
  for (const item of items) {
    if (item.kind === 'bgp') {
      const vars = new Set<string>();
      const triples = (item.triples as any)?.triples;
      if (Array.isArray(triples)) for (const t of triples) collectTermVars(t, vars);
      if (vars.has(name)) return true;
    }
  }
  return false;
}

function collectTermVars(triple: any, into: Set<string>): void {
  for (const key of ['subject', 'predicate', 'object'] as const) {
    const term = triple?.[key];
    if (term?.type === 'term' && term?.subType === 'variable') into.add(String(term.value ?? ''));
  }
}
