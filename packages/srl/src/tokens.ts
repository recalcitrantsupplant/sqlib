import { createToken } from '@traqula/core';

/**
 * SRL-specific tokens layered on top of the SPARQL 1.2 lexer.
 *
 * `WHERE` is reused from the base SPARQL lexer — not redefined here.
 *
 * Ordering (Chevrotain matches the first vocabulary token whose pattern matches
 * at the current position — first-in-order, NOT longest):
 *  - `NOT` is appended AFTER the base vocabulary, so the longer base keywords
 *    `NOT IN` / `NOT EXISTS` still win where they apply; a bare `NOT {` falls to
 *    this token. (see lexer.ts)
 *  - `:=` must be placed BEFORE the `:`-bearing prefixed-name terminal, else `:`
 *    is lexed as an empty prefix and `=` separately. (see lexer.ts)
 */
export const ruleKeyword = createToken({ name: 'SrlRule', pattern: /rule/i, label: 'RULE' });
export const setKeyword = createToken({ name: 'SrlSet', pattern: /set/i, label: 'SET' });
export const dataKeyword = createToken({ name: 'SrlData', pattern: /data/i, label: 'DATA' });
export const notKeyword = createToken({ name: 'SrlNot', pattern: /not/i, label: 'NOT' });
export const assignOp = createToken({ name: 'SrlAssign', pattern: /:=/, label: ':=' });
