/*
 * The case-insensitive half of the SRL grammar's tokenizer.
 *
 * `srl.grammar` lexes every bare word as `Keyword` and hands it here; this maps
 * the six words that carry structure — and the two boolean literals — onto
 * their own terms, so the grammar can say "a rule starts with RULE" while
 * `datatype`, `rules` and `notExists` stay ordinary words.
 *
 * SPARQL keywords are case-insensitive and SRL inherits that, so the lookup is
 * on the lower-cased word: `RULE`, `Rule` and `rule` are one keyword.
 */
import type { Stack } from '@lezer/lr';
import { BaseKeyword, Boolean as BooleanTerm, DataKeyword, PrefixKeyword, RuleKeyword, TupleKeyword, WhereKeyword } from './parser.terms.generated';

const KEYWORDS: Record<string, number> = {
  prefix: PrefixKeyword,
  base: BaseKeyword,
  rule: RuleKeyword,
  where: WhereKeyword,
  data: DataKeyword,
  tuple: TupleKeyword,
  true: BooleanTerm,
  false: BooleanTerm,
};

/**
 * The term for a word, or -1 to leave it as a plain `Keyword`.
 *
 * Lezer also passes the parse stack, which a context-sensitive keyword would
 * need — `DATA` means the same thing wherever it appears, so this one does not.
 */
export function specializeKeyword(value: string, _stack: Stack): number {
  return KEYWORDS[value.toLowerCase()] ?? -1;
}
