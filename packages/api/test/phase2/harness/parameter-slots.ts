/**
 * Detects surviving parameter slots in a SPARQL string, for the P7 total-rewrite
 * invariant (docs §1.1, §2.3).
 *
 * The invariant is *not* "no UNDEF reaches the endpoint". §1.1 reserves one
 * specific shape as parameter-slot syntax - a VALUES group of exactly one row in
 * which every term is UNDEF - and leaves partial-UNDEF rows legal author data.
 * An edge mapping that binds only some of a target's variables produces exactly
 * such a partial row, legitimately.
 *
 * So the check has to be the same predicate `SparqlQueryParser.isParameterSlot`
 * applies, read off the serialized query rather than the parse tree: an
 * unresolved slot is a slot that survived argument application, and shipping one
 * silently runs the query unconstrained.
 *
 * Deliberately a scanner rather than a parser: importing the parser to check the
 * parser's output would defeat the point. It assumes no literal in the corpus
 * contains a brace or parenthesis, which holds for the Phase 2 fixture.
 */

const VALUES_CLAUSE = /VALUES\s*(\((?<vars>[^)]*)\)|\?(?<var>[A-Za-z_][\w]*))\s*\{(?<block>[^}]*)\}/g;

export interface SurvivingSlot {
  /** The clause as it appeared in the dispatched query. */
  clause: string;
  /** Variable names the clause declares. */
  vars: string[];
}

/** Every all-UNDEF single-row VALUES group left in the query. */
export function findSurvivingParameterSlots(query: string): SurvivingSlot[] {
  const found: SurvivingSlot[] = [];

  for (const match of query.matchAll(VALUES_CLAUSE)) {
    const groups = match.groups!;
    const block = groups.block ?? '';

    if (groups.var) {
      // Single-variable form: rows are bare terms, one per row.
      const terms = block.trim().split(/\s+/).filter(Boolean);
      if (terms.length === 1 && terms[0] === 'UNDEF') {
        found.push({ clause: match[0], vars: [groups.var] });
      }
      continue;
    }

    // Multi-variable form: each row is its own parenthesised group.
    const rows = [...block.matchAll(/\(([^)]*)\)/g)];
    if (rows.length !== 1) continue;
    const terms = rows[0][1].trim().split(/\s+/).filter(Boolean);
    if (terms.length > 0 && terms.every(term => term === 'UNDEF')) {
      found.push({
        clause: match[0],
        vars: (groups.vars ?? '').trim().split(/\s+/).filter(Boolean).map(v => v.replace(/^\?/, '')),
      });
    }
  }

  return found;
}
