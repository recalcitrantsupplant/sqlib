import { LexerBuilder } from '@traqula/core';
import { lex as l11 } from '@traqula/rules-sparql-1-1';
import { lex as l12 } from '@traqula/rules-sparql-1-2';
import { assignOp, dataKeyword, notKeyword, ruleKeyword, setKeyword } from './tokens.js';
import { tupleKeyword } from './tuples/grammar.js';

/**
 * The SRL lexer: the SPARQL 1.2 lexer extended with SRL tokens.
 *
 *  - keyword tokens appended after the base vocabulary (base multi-word
 *    keywords like NOT IN / NOT EXISTS keep priority — see tokens.ts);
 *  - `:=` inserted before `PNameNs` so `:` is not lexed as an empty prefix.
 */
export const srlLexerBuilder = LexerBuilder.create(l12.sparql12LexerBuilder)
  .add(ruleKeyword, setKeyword, dataKeyword, notKeyword, tupleKeyword)
  .addBefore(l11.terminals.pNameNs as any, assignOp);

export const srlTokenVocabulary: readonly unknown[] = srlLexerBuilder.tokenVocabulary as readonly unknown[];
