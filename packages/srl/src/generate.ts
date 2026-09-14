import { sparql12GeneratorBuilder } from '@traqula/generator-sparql-1-2';
import { completeGeneratorContext } from '@traqula/rules-sparql-1-2';
import type { SrlBodyItem, SrlDataBlock, SrlRule, SrlRuleSet } from './ast.js';
import { renderTerm } from './tuples/compile.js';

/**
 * Serialize SRL back to text **from the AST**, not from source slices.
 *
 * This is what makes canonical identity work: after `expandIris`, generating
 * from the AST yields the same text regardless of how the author spelled their
 * prefixes, so a prefix-only edit is provably not a content change (plan §7).
 */

const generator: any = sparql12GeneratorBuilder.build();
const generatorContext: any = completeGeneratorContext({});

function serialize(rule: string, ast: unknown): string {
  return generator[rule](ast, { ...generatorContext, origSource: '' }).trim();
}

/** Serialize one rule body item to SRL syntax. */
function generateBodyItem(item: SrlBodyItem): string {
  switch (item.kind) {
    case 'bgp':
      return serialize('triplesBlock', item.triples);
    case 'filter':
      return serialize('filter', item.filter);
    case 'not':
      return `NOT ${item.data ? 'DATA ' : ''}{ ${item.body.map(generateBodyItem).filter(Boolean).join(' ')} }`;
    case 'set':
      return `SET ( ?${item.variable} := ${serialize('expression', item.expr)} )`;
    case 'tuple':
      return `TUPLE(${(item.tuple.terms as any[]).map(renderTerm).join(', ')})`;
  }
}

/** Serialize a rule head (triple templates plus any tuple templates). */
export function generateHead(rule: SrlRule): string {
  const parts: string[] = [];
  const triples = (rule.head as any)?.triples;
  if (Array.isArray(triples) && triples.length > 0) parts.push(serialize('triplesBlock', rule.head));
  for (const tuple of rule.headTuples ?? []) {
    parts.push(`TUPLE(${(tuple.terms as any[]).map(renderTerm).join(', ')})`);
  }
  return parts.join(' . ');
}

/** Serialize a rule body. */
export function generateBody(rule: SrlRule): string {
  return rule.body.map(generateBodyItem).filter(Boolean).join(' ');
}

/** Serialize one rule as `RULE [<name>] { head } WHERE [DATA] { body }`. */
export function generateRule(rule: SrlRule): string {
  const name = rule.name ? ` <${rule.name}>` : '';
  const where = rule.data ? 'WHERE DATA' : 'WHERE';
  return `RULE${name} { ${generateHead(rule)} } ${where} { ${generateBody(rule)} }`;
}

/**
 * Serialize one data block as `DATA { triples }`, from the AST.
 *
 * Same rationale as {@link generateRule}: generating from the AST (rather than
 * slicing source) is what makes a data block's canonical text — and therefore
 * its identity — independent of how the author spelled their prefixes.
 */
export function generateDataBlock(block: SrlDataBlock): string {
  const triples = (block.triples as { triples?: unknown[] } | undefined)?.triples;
  if (!Array.isArray(triples) || triples.length === 0) return 'DATA { }';
  return `DATA { ${serialize('triplesBlock', block.triples)} }`;
}

/** Serialize a whole rule set, prologue first. */
export function generateRuleSet(ruleSet: SrlRuleSet, prologueText = ruleSet.prologueText): string {
  const prologue = (prologueText ?? '').trim();
  const blocks: string[] = [];
  for (const block of ruleSet.dataBlocks) blocks.push(generateDataBlock(block));
  for (const rule of ruleSet.rules) blocks.push(generateRule(rule));
  const body = blocks.join('\n\n');
  return prologue ? `${prologue}\n\n${body}\n` : `${body}\n`;
}
