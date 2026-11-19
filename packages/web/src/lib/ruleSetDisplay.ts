/**
 * How a notebook shows a rule set: its rules, the graph it inferred, and what
 * each rule added.
 *
 * The run returns the inferred graph as N-Quads with full IRIs. The cell shows
 * it as Turtle with the rule set's own prefixes, so it reads like the rules
 * that made it. The value the cell binds keeps the N-Quads: cells below send
 * it on unchanged.
 */
import { DataFactory, Parser as N3Parser, Writer as N3Writer } from 'n3';

/** The `PREFIX p: <iri>` declarations of an SRL document, by prefix. */
export function srlPrefixes(srl: string): Record<string, string> {
  const prefixes: Record<string, string> = {};
  for (const match of srl.matchAll(/^\s*PREFIX\s+([A-Za-z][\w.-]*)?:\s*<([^>]*)>/gim)) {
    prefixes[match[1] ?? ''] = match[2]!;
  }
  return prefixes;
}

/**
 * N-Triples or N-Quads as Turtle, sorted by subject then predicate.
 *
 * Graph names are dropped: a rule set infers into the default graph. Returns
 * null when the content does not parse, and the caller shows it as it came.
 */
export function nquadsAsTurtle(content: string, prefixes: Record<string, string>): string | null {
  let quads;
  try {
    quads = new N3Parser({ format: 'N-Quads' }).parse(content);
  } catch {
    return null;
  }
  quads.sort(
    (a, b) =>
      a.subject.value.localeCompare(b.subject.value) ||
      a.predicate.value.localeCompare(b.predicate.value) ||
      a.object.value.localeCompare(b.object.value),
  );
  const writer = new N3Writer({ prefixes, format: 'Turtle' });
  for (const quad of quads) writer.addQuad(DataFactory.quad(quad.subject, quad.predicate, quad.object));
  const written: { turtle: string | null } = { turtle: null };
  // n3's writer calls back synchronously once its input is all in memory.
  writer.end((error, result) => {
    written.turtle = error ? null : result ?? null;
  });
  return written.turtle;
}

/** One rule's part in a run: what it added and removed, over every iteration. */
export interface RuleRunRow {
  ruleVersionId: string;
  name: string;
  inserted: number;
  deleted: number;
}

/** The facts of a rule set run that the cell shows beside the graph. */
export interface RuleRunSummary {
  iterations: number;
  rules: RuleRunRow[];
}

interface IterationLike {
  rules?: Array<{
    ruleVersionId: string;
    ruleIri?: string | null;
    triplesInserted?: number | null;
    triplesDeleted?: number | null;
  }> | null;
}

/**
 * Sum each rule's inserts and deletes across iterations, in the order the
 * rules first ran.
 *
 * A rule is named by `ruleNames` (the server's rule names), then by its IRI,
 * then by its position.
 */
export function summarizeRuleRun(
  iterations: IterationLike[] | null | undefined,
  ruleNames: Record<string, string> | null | undefined,
): RuleRunSummary {
  const rows = new Map<string, RuleRunRow>();
  for (const iteration of iterations ?? []) {
    for (const rule of iteration.rules ?? []) {
      let row = rows.get(rule.ruleVersionId);
      if (!row) {
        const name = ruleNames?.[rule.ruleVersionId] || rule.ruleIri || `Rule ${rows.size + 1}`;
        row = { ruleVersionId: rule.ruleVersionId, name, inserted: 0, deleted: 0 };
        rows.set(rule.ruleVersionId, row);
      }
      row.inserted += rule.triplesInserted ?? 0;
      row.deleted += rule.triplesDeleted ?? 0;
    }
  }
  return { iterations: iterations?.length ?? 0, rules: [...rows.values()] };
}
