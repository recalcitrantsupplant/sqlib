/**
 * Rule / data validator, backed by the SRL (SPARQL-RL) package.
 *
 * Replaces the previous vendored-sparqljs multi-grammar validator. Accepts, in
 * priority order:
 *   1. SRL rule syntax (`RULE { … } WHERE [DATA] { … }`) — compiled to a SPARQL
 *      UPDATE via the SRL compiler. (The `IF … THEN` form was removed from the
 *      language upstream, so it is now a syntax error like any other.)
 *   2. SRL `DATA { … }` blocks — emitted as `INSERT DATA { … }`.
 *   3. Raw SPARQL UPDATE (`INSERT … WHERE`, `INSERT DATA { … }`, …) — accepted
 *      as-is (already normalized). This preserves the previous lenient
 *      behaviour where callers may supply plain SPARQL.
 */
import { Parser as SparqlParser } from '@traqula/parser-sparql-1-2';
import { compileRule, parseRuleSet } from '@sparql-query-lib/srl';

import { ruleTuplesAllowed } from './ruleTuples.js';
export type GrammarType = 'srl' | 'sparql';

export interface GrammarValidationResult {
  grammar: GrammarType;
  valid: boolean;
  normalized?: string;
  error?: string;
  /**
   * The input uses the rule-tuples extension, so it is valid but has **no**
   * directly executable normalization — see {@link RuleGrammarValidator.trySrl}.
   */
  usesTuples?: boolean;
}

export interface MultiGrammarValidationResult {
  validations: GrammarValidationResult[];
  valid: boolean;
  normalized?: string;
  error?: string;
  primaryGrammar?: GrammarType;
  /** See {@link GrammarValidationResult.usesTuples}. */
  usesTuples?: boolean;
}

const sparqlParser = new SparqlParser();

export class RuleGrammarValidator {
  /** Validate a rule or data string, producing a normalized SPARQL UPDATE. */
  validateWithAllGrammars(input: string): MultiGrammarValidationResult {
    const trimmed = (input ?? '').trim();
    if (!trimmed) {
      return { validations: [], valid: false, error: 'Empty input' };
    }

    const srl = this.trySrl(trimmed);
    if (srl.valid) {
      return {
        validations: [srl],
        valid: true,
        normalized: srl.normalized,
        primaryGrammar: 'srl',
        usesTuples: srl.usesTuples,
      };
    }

    const sparql = this.trySparql(trimmed);
    if (sparql.valid) {
      return { validations: [srl, sparql], valid: true, normalized: sparql.normalized, primaryGrammar: 'sparql' };
    }

    return {
      validations: [srl, sparql],
      valid: false,
      error: `Not valid SHACL Rules (SRL) or SPARQL: ${srl.error ?? ''}`.trim(),
    };
  }

  /** Format a rule or data string. Currently a validating passthrough. */
  formatRuleOrData(input: string): { formatted: string; grammar: GrammarType } {
    const result = this.validateWithAllGrammars(input);
    if (!result.valid) {
      throw new Error(result.error ?? 'Invalid SHACL rule or data syntax');
    }
    return { formatted: input.trim(), grammar: result.primaryGrammar ?? 'srl' };
  }

  /**
   * Parse as SRL, with the rule-tuples extension enabled when this deployment
   * offers it.
   *
   * The extension has to be on here or a `TUPLE( … )` rule cannot be saved at
   * all: every write path (`RuleVersionWriter`, `POST /rules/:id/versions`, the
   * SRL import route) gates on this validator, while the stratifier, executor
   * and `/rule-sets/:id/srl` routes parse the same way. With the `ruleTuples`
   * feature flag off the extension is not on offer, so a `TUPLE( … )` is a
   * syntax error here and the rule does not save — which is the point. See
   * ./ruleTuples.ts.
   *
   * A tuple rule is valid but deliberately carries **no** `normalized` program.
   * Its compiled form holds reserved `VALUES` slots that only
   * `RuleSetExecutor`'s tuple path can fill (from the ephemeral `TupleStore`,
   * as VALUES rows). Storing it as `normalizedInsert` would let a
   * non-tuple-aware caller run a rule whose tuple reads are simply absent —
   * silently unconstrained, and wrong. That the slots are now spelled as
   * reserved `VALUES` rows rather than bare comments makes the gate *more*
   * necessary, not less: the program looks the more runnable for it while
   * meaning exactly as little. Leaving it unset makes the executor recompile
   * from `ruleString`, which is the only correct route.
   */
  private trySrl(input: string): GrammarValidationResult {
    try {
      const rs = parseRuleSet(input, { tuples: ruleTuplesAllowed() });
      const parts: string[] = [];
      let usesTuples = false;
      for (const rule of rs.rules) {
        const compiled = compileRule(rule, rs.prologueText);
        if (compiled.tupleReads.length > 0 || compiled.tupleWrites.length > 0) usesTuples = true;
        parts.push(compiled.program);
      }
      for (const block of rs.dataBlocks) {
        const prologue = rs.prologueText ? `${rs.prologueText}\n` : '';
        parts.push(`${prologue}INSERT DATA { ${block.dataText} }`);
      }
      if (parts.length === 0) {
        return { grammar: 'srl', valid: false, error: 'No SRL rules or data blocks found' };
      }
      if (usesTuples) {
        return { grammar: 'srl', valid: true, usesTuples: true };
      }
      return { grammar: 'srl', valid: true, normalized: parts.join(';\n') };
    } catch (error) {
      return { grammar: 'srl', valid: false, error: error instanceof Error ? error.message : 'SRL parse failed' };
    }
  }

  private trySparql(input: string): GrammarValidationResult {
    try {
      sparqlParser.parse(input);
      return { grammar: 'sparql', valid: true, normalized: input };
    } catch (error) {
      return { grammar: 'sparql', valid: false, error: error instanceof Error ? error.message : 'SPARQL parse failed' };
    }
  }
}
