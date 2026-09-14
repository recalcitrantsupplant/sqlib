/**
 * The three questions you can ask an SRL document without running it.
 *
 * Does it parse; is it well-formed; does it stratify. They are what the W3C
 * rules suite's `syntax/`, `wellformed/` and `stratification/` categories
 * assert, and they are also what the rules work area shows a live author in its
 * gutter and inspector — the same three checks, asked of the same text.
 *
 * Deliberately *not* execution. A rule set that parses may still be
 * unimplementable by our executor, and a rule set the executor handles may
 * still be badly stratified. Conflating the two is what makes a red test
 * uninformative, so the check is named in the expectation and answered here.
 *
 * The analyses come from `packages/srl` rather than being reimplemented, so
 * this module cannot drift from the parser's own conformance harness.
 */

import { checkWellFormed, parseRuleSet, stratify } from '@sparql-query-lib/srl';

export const SRL_CHECKS = ['syntax', 'wellformed', 'stratification'] as const;

export type SrlCheck = (typeof SRL_CHECKS)[number];

export function isSrlCheck(value: unknown): value is SrlCheck {
  return typeof value === 'string' && (SRL_CHECKS as readonly string[]).includes(value);
}

export interface SrlCheckVerdict {
  check: SrlCheck;
  /** Did the check accept the document? */
  accepted: boolean;
  /**
   * Why not, when it did not. One line, from the analysis itself rather than
   * written here, so the reason a test gives matches the reason the editor
   * shows for the same document.
   */
  reason: string;
}

/**
 * Run one check over a document.
 *
 * Never throws: a document that does not parse is a *result* — "rejected,
 * because …" — and for a negative syntax test it is the expected one. Turning
 * it into an exception would make the suite's whole negative half unrunnable.
 */
export function runSrlCheck(document: string, check: SrlCheck): SrlCheckVerdict {
  // No special case for empty. An SRL document with no rules is legal — the
  // suite has three positive syntax tests that are exactly that, one of them a
  // zero-byte file — so "is this empty" is the parser's call, not a guard's.
  const text = document ?? '';

  // `tuples: false`: TUPLE(…) is our extension. Parsing with it on would accept
  // documents that conformant SRL rejects, which is the one thing a
  // conformance check must not do.
  let ruleSet: ReturnType<typeof parseRuleSet>;
  try {
    ruleSet = parseRuleSet(text, { tuples: false });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { check, accepted: false, reason };
  }

  if (check === 'syntax') {
    return { check, accepted: true, reason: '' };
  }

  if (check === 'wellformed') {
    const issues = checkWellFormed(ruleSet);
    return issues.length === 0
      ? { check, accepted: true, reason: '' }
      : {
        check,
        accepted: false,
        reason: issues
          .map(issue => `[${issue.category}] rule ${issue.ruleIndex + 1}: ${issue.message}`)
          .join('; '),
      };
  }

  // `issues` here are already sentences ("Non-stratifiable cycle involving: …").
  const report = stratify(ruleSet.rules.map((ast, index) => ({ id: `r${index}`, ast })));
  return report.issues.length === 0
    ? { check, accepted: true, reason: '' }
    : { check, accepted: false, reason: report.issues.join('; ') };
}
