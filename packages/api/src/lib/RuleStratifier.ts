import {
  expandIris,
  parseRuleSet,
  stratify,
  type SrlRule,
  type StratificationCycle,
  type StratificationEdge,
  type MonotonicityKind as SrlMonotonicityKind,
  type StratificationReport as SrlStratificationReport,
} from '@sparql-query-lib/srl';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';

import { ruleTuplesAllowed } from './ruleTuples.js';
/**
 * Rule stratification, backed by the SRL (SHACL 1.2 Rules) package.
 *
 * This replaces the previous vendored-sparqljs implementation. Aggregation is
 * no longer supported, so monotonicity is `monotone | negation` (see the SRL
 * package). `grammarType` on a RuleVersion is now advisory — every rule is
 * parsed as SRL.
 *
 * ## Multi-rule RuleVersions
 *
 * An SRL document is a *ruleset*, so a `ruleString` can legally contain several
 * `RULE … WHERE …` blocks. Every rule is analysed — analysing only the first
 * would make a `NOT` in a later rule invisible to stratification, which is
 * precisely the unsoundness stratification exists to prevent.
 *
 * The report is still keyed by RuleVersion id (the executor orders whole
 * versions), so a version's stratum is the **maximum** over its rules. If a
 * version's rules do not all land in the same stratum it cannot be ordered
 * correctly — the rules execute as one program — so that is reported as an
 * issue advising the version be split into separate rules (which is what the
 * rule-set SRL import does automatically).
 */

export type MonotonicityKind = SrlMonotonicityKind;

export interface StratificationReport extends SrlStratificationReport {
  generatedAt: string;
}

/** Separator for the synthetic per-rule ids used during analysis. */
const RULE_INDEX_SEP = '#rule:';

export class RuleStratifier {
  analyzeRuleVersions(ruleVersions: LdkitRuleVersion[]): StratificationReport {
    // One analysis node per rule, so negation anywhere in a version is seen.
    const nodes: Array<{ id: string; ast: SrlRule; versionId: string }> = [];
    const rulesPerVersion = new Map<string, number>();

    for (const ruleVersion of ruleVersions) {
      const rules = parseRules(ruleVersion);
      rulesPerVersion.set(ruleVersion.$id, rules.length);
      rules.forEach((ast, index) => {
        nodes.push({ id: `${ruleVersion.$id}${RULE_INDEX_SEP}${index}`, ast, versionId: ruleVersion.$id });
      });
    }

    const report = stratify(nodes.map(({ id, ast }) => ({ id, ast })));
    const versionOf = new Map(nodes.map((n) => [n.id, n.versionId]));

    const strata: Record<string, number> = {};
    const monotonicity: Record<string, MonotonicityKind> = {};
    const runOnce: Record<string, boolean> = {};
    const perVersionStrata = new Map<string, Set<number>>();

    for (const [nodeId, stratum] of Object.entries(report.strata)) {
      const versionId = versionOf.get(nodeId) ?? nodeId;
      strata[versionId] = Math.max(strata[versionId] ?? 0, stratum);
      const seen = perVersionStrata.get(versionId) ?? new Set<number>();
      seen.add(stratum);
      perVersionStrata.set(versionId, seen);
    }

    // A version's rules run as one program, so one run-once rule makes the
    // whole version run-once. That is the safe direction: the version's rules
    // all sit at the version's (maximum) stratum, so everything they read is
    // already complete by the time it fires.
    for (const [nodeId, once] of Object.entries(report.runOnce ?? {})) {
      const versionId = versionOf.get(nodeId) ?? nodeId;
      runOnce[versionId] = (runOnce[versionId] ?? false) || once;
    }

    for (const [nodeId, kind] of Object.entries(report.monotonicity)) {
      const versionId = versionOf.get(nodeId) ?? nodeId;
      // Any negating rule makes the whole version non-monotone.
      if (kind === 'negation' || monotonicity[versionId] === 'negation') {
        monotonicity[versionId] = 'negation';
      } else {
        monotonicity[versionId] = monotonicity[versionId] ?? kind;
      }
    }

    const issues = [
      ...report.issues.map((issue) => rewriteIds(issue, versionOf)),
      ...unorderableVersionIssues(perVersionStrata, rulesPerVersion),
    ];

    return {
      strata,
      monotonicity,
      runOnce,
      edges: collapseEdges(report.edges, versionOf),
      issues,
      cycles: report.cycles.map((cycle) => collapseCycle(cycle, versionOf)),
      generatedAt: new Date().toISOString(),
    };
  }
}

function parseRules(ruleVersion: LdkitRuleVersion): SrlRule[] {
  const source = (ruleVersion.ruleString || '').trim();
  if (!source) {
    throw new Error(`RuleVersion ${ruleVersion.$id} has empty ruleString`);
  }
  // Parsed under the deployment's setting, so a stored rule written with the
  // withheld extension fails to stratify rather than quietly running. See
  // ./ruleTuples.ts.
  const parsed = expandIris(parseRuleSet(source, { tuples: ruleTuplesAllowed() }));
  if (parsed.rules.length === 0) {
    throw new Error(`RuleVersion ${ruleVersion.$id} did not produce a parsed rule`);
  }
  return parsed.rules;
}

/**
 * A version whose rules span more than one stratum cannot be ordered correctly,
 * because the whole version runs as a single program.
 */
function unorderableVersionIssues(
  perVersionStrata: Map<string, Set<number>>,
  rulesPerVersion: Map<string, number>,
): string[] {
  const issues: string[] = [];
  for (const [versionId, strata] of perVersionStrata) {
    if (strata.size <= 1) continue;
    const ordered = [...strata].sort((a, b) => a - b);
    issues.push(
      `RuleVersion ${versionId} contains ${rulesPerVersion.get(versionId) ?? strata.size} rules spanning strata `
        + `${ordered.join(', ')}; they execute as one program and cannot be ordered independently. `
        + 'Split it into separate rules (importing the rule set as an SRL document does this automatically).',
    );
  }
  return issues;
}

/** Map synthetic per-rule ids in a free-text issue back to RuleVersion ids. */
function rewriteIds(issue: string, versionOf: Map<string, string>): string {
  let out = issue;
  for (const [nodeId, versionId] of versionOf) {
    if (out.includes(nodeId)) out = out.split(nodeId).join(versionId);
  }
  return out;
}

/** A cycle between per-rule ids, restated in RuleVersion ids. */
function collapseCycle(cycle: StratificationCycle, versionOf: Map<string, string>): StratificationCycle {
  const rules = [...new Set(cycle.rules.map((id) => versionOf.get(id) ?? id))];
  const runOnce = cycle.runOnce?.map(({ rule, reasons }) => ({ rule: versionOf.get(rule) ?? rule, reasons }));
  const toVersion = (edge: StratificationEdge): StratificationEdge => ({
    ...edge,
    from: versionOf.get(edge.from) ?? edge.from,
    to: versionOf.get(edge.to) ?? edge.to,
  });
  return {
    ...cycle,
    rules,
    // Unlike `collapseEdges`, a version reading itself stays: inside a cycle it
    // may be the very dependency that closes the loop.
    edges: cycle.edges.map(toVersion),
    witness: cycle.witness.map(toVersion),
    ...(runOnce ? { runOnce } : {}),
  };
}

/** Collapse per-rule edges to per-version edges, merging duplicates. */
function collapseEdges(edges: StratificationEdge[], versionOf: Map<string, string>): StratificationEdge[] {
  const merged = new Map<string, StratificationEdge>();
  for (const edge of edges) {
    const from = versionOf.get(edge.from) ?? edge.from;
    const to = versionOf.get(edge.to) ?? edge.to;
    // A version depending on itself only because two of its own rules relate is
    // not a real inter-version dependency.
    if (from === to && edge.from !== edge.to) continue;
    const key = `${from}=>${to}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...edge, from, to });
      continue;
    }
    existing.reasons = [...existing.reasons, ...edge.reasons];
    // The strongest constraint wins: `negative` and `closed` both demand a
    // strictly higher stratum, and `negative` additionally records negation.
    if (edge.label === 'negative') existing.label = 'negative';
    else if (edge.label === 'closed' && existing.label === 'positive') existing.label = 'closed';
  }
  return [...merged.values()];
}
