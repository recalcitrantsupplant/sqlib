import type { SrlBodyItem, SrlDataBlock, SrlRule, SrlRuleSet } from './ast.js';
import { renderRuleName, serializeSparqlNode } from './generate.js';
import { renderTerm } from './tuples/compile.js';

/**
 * Pretty-print SRL from the AST: the author-facing counterpart to ./generate.ts.
 *
 * The generator there serializes a rule onto a single line, which is what
 * canonical identity wants (`canonicalRuleText` collapses whitespace anyway) and
 * what an editor emphatically does not. This module reuses the same Traqula
 * serialization for the embedded SPARQL fragments and lays the SRL structure out
 * over lines instead, so `POST /format` can give an SRL document the same
 * treatment it gives a SPARQL query.
 *
 * Formatting is AST-driven, so it normalizes prefix spelling of the prologue and
 * the layout of every block, but it never rewrites what a document *means*: the
 * result parses back to the same rules. It is idempotent — formatting formatted
 * output returns it unchanged.
 */

export interface FormatOptions {
  /** Indent unit for one nesting level. Default: two spaces. */
  indent?: string;
}

const DEFAULT_INDENT = '  ';

/** Re-indent serialized SPARQL, which arrives as its own unindented lines. */
function indentLines(text: string, unit: string, depth: number): string[] {
  const pad = unit.repeat(depth);
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `${pad}${line}`);
}

/** `HEADER { }` when there is nothing inside, else a braced block over lines. */
function braced(header: string, lines: string[], unit: string, depth: number): string {
  const pad = unit.repeat(depth);
  return lines.length === 0 ? `${pad}${header} { }` : `${pad}${header} {\n${lines.join('\n')}\n${pad}}`;
}

/** Lay out one rule body item, one line per triple, pattern or expression. */
function formatBodyItem(item: SrlBodyItem, unit: string, depth: number): string[] {
  const pad = unit.repeat(depth);
  switch (item.kind) {
    case 'bgp':
      return indentLines(serializeSparqlNode('triplesBlock', item.triples), unit, depth);
    case 'filter':
      return indentLines(serializeSparqlNode('filter', item.filter), unit, depth);
    case 'not': {
      const header = `NOT${item.data ? ' DATA' : ''}`;
      const inner = item.body.flatMap((nested) => formatBodyItem(nested, unit, depth + 1));
      return braced(header, inner, unit, depth).split('\n');
    }
    case 'set':
      return [`${pad}SET ( ?${item.variable} := ${serializeSparqlNode('expression', item.expr)} )`];
    case 'tuple':
      return [`${pad}TUPLE(${(item.tuple.terms as unknown[]).map(renderTerm).join(', ')})`];
  }
}

/** Head lines: the triple templates, then any tuple templates. */
function formatHeadLines(rule: SrlRule, unit: string, depth: number): string[] {
  const lines: string[] = [];
  const triples = (rule.head as { triples?: unknown[] } | undefined)?.triples;
  if (Array.isArray(triples) && triples.length > 0) {
    lines.push(...indentLines(serializeSparqlNode('triplesBlock', rule.head), unit, depth));
  }
  const pad = unit.repeat(depth);
  for (const tuple of rule.headTuples ?? []) {
    lines.push(`${pad}TUPLE(${(tuple.terms as unknown[]).map(renderTerm).join(', ')}) .`);
  }
  return lines;
}

/** Pretty-print one rule as `RULE [name] { … } WHERE [DATA] { … }` over lines. */
export function formatRule(rule: SrlRule, options: FormatOptions = {}): string {
  const unit = options.indent ?? DEFAULT_INDENT;
  const name = renderRuleName(rule);
  const head = braced(`RULE${name ? ` ${name}` : ''}`, formatHeadLines(rule, unit, 1), unit, 0);
  const body = braced(
    rule.data ? 'WHERE DATA' : 'WHERE',
    rule.body.flatMap((item) => formatBodyItem(item, unit, 1)),
    unit,
    0,
  );
  return `${head} ${body}`;
}

/** Pretty-print one `DATA { … }` block, one ground triple per line. */
export function formatDataBlock(block: SrlDataBlock, options: FormatOptions = {}): string {
  const unit = options.indent ?? DEFAULT_INDENT;
  const triples = (block.triples as { triples?: unknown[] } | undefined)?.triples;
  const lines =
    Array.isArray(triples) && triples.length > 0
      ? indentLines(serializeSparqlNode('triplesBlock', block.triples), unit, 1)
      : [];
  return braced('DATA', lines, unit, 0);
}

/** A parsed prologue entry: one `PREFIX` or `BASE` declaration. */
interface ContextDef {
  type?: unknown;
  subType?: unknown;
  key?: unknown;
  value?: { value?: unknown };
}

/**
 * Normalize the prologue: one declaration per line, from the parsed prologue
 * rather than the source slice, so spacing and comments between declarations do
 * not survive a format. Falls back to the verbatim slice if the prologue AST is
 * not the expected shape.
 */
function formatPrologue(ruleSet: SrlRuleSet): string {
  const prologue = (ruleSet as { prologue?: unknown }).prologue;
  if (!Array.isArray(prologue)) return (ruleSet.prologueText ?? '').trim();
  const lines: string[] = [];
  for (const def of prologue as ContextDef[]) {
    if (def?.type !== 'contextDef') return (ruleSet.prologueText ?? '').trim();
    const iri = String(def?.value?.value ?? '');
    if (def.subType === 'prefix') lines.push(`PREFIX ${String(def.key ?? '')}: <${iri}>`);
    else if (def.subType === 'base') lines.push(`BASE <${iri}>`);
    else return (ruleSet.prologueText ?? '').trim();
  }
  return lines.join('\n');
}

/**
 * Pretty-print a whole rule set: prologue, then the DATA blocks, then the rules,
 * one blank line between blocks and a trailing newline.
 */
export function formatRuleSet(ruleSet: SrlRuleSet, options: FormatOptions = {}): string {
  const blocks: string[] = [];
  for (const block of ruleSet.dataBlocks) blocks.push(formatDataBlock(block, options));
  for (const rule of ruleSet.rules) blocks.push(formatRule(rule, options));
  const prologue = formatPrologue(ruleSet);
  const body = blocks.join('\n\n');
  return prologue ? `${prologue}\n\n${body}\n` : `${body}\n`;
}
