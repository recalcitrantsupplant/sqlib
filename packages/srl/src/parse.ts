import { completeParseContext, copyParseContext } from '@traqula/rules-sparql-1-2';
import { srlParser } from './grammar.js';
import type { SrlDataBlock, SrlRule, SrlRuleSet, SrlTuple } from './ast.js';

const defaultContext = completeParseContext({});

export interface ParseOptions {
  /** Enable the rule-tuples extension (w3c/data-shapes#752). Off by default. */
  tuples?: boolean;
}

interface RawRule {
  nameTerm?: any;
  head: unknown;
  headTuples: SrlTuple[];
  body: SrlRule['body'];
  data?: boolean;
  headSpan: readonly [number, number];
  bodySpan: readonly [number, number];
  startOffset: number;
}
interface RawData {
  triples: unknown;
  span: readonly [number, number];
  startOffset: number;
}

// All BASE/PREFIX declarations anywhere in the document — they may be
// interleaved with rules, so we can't just take the text before the first rule.
const PROLOGUE_DECL = /^[ \t]*(PREFIX[ \t]+[^\s:]*:[ \t]*<[^>]*>|BASE[ \t]+<[^>]*>)/gim;

/** The verbatim BASE/PREFIX declarations of a document, one per line. */
export function extractPrologueText(text: string): string {
  return (text.match(PROLOGUE_DECL) ?? []).map((s) => s.trim()).join('\n');
}

// Base direction in a directional language tag (`@en--ltr`) must be exactly
// `ltr` or `rtl`, lowercase. The language tag itself is case-insensitive
// (`@EN-GB` is legal), and Traqula normalizes the direction to lowercase during
// parsing — so an invalid uppercase direction is undetectable from the AST and
// has to be rejected at the source level.
const LANG_DIR = /@[A-Za-z]+(?:-[A-Za-z0-9]+)*--([A-Za-z]+)/g;

/**
 * Parse an SRL document into a {@link SrlRuleSet}. Throws on syntax error.
 */
export function parseRuleSet(text: string, opts: ParseOptions = {}): SrlRuleSet {
  for (const m of text.matchAll(LANG_DIR)) {
    if (m[1] !== 'ltr' && m[1] !== 'rtl') {
      throw new Error(`SRL syntax error: invalid base direction '--${m[1]}' (expected '--ltr' or '--rtl')`);
    }
  }

  const ctx = copyParseContext(defaultContext);
  const ast = (srlParser as any).srlRuleSet(text, ctx) as {
    prologue: unknown;
    rules: RawRule[];
    dataBlocks: RawData[];
  };

  const rules: SrlRule[] = ast.rules.map((r) => ({
    name: r.nameTerm ? ruleName(r.nameTerm) : undefined,
    nameTerm: r.nameTerm,
    head: r.head,
    headTuples: r.headTuples ?? [],
    body: r.body,
    // Only written when present, so a rule without it keeps the property
    // absent rather than carrying a default nobody wrote.
    ...(r.data ? { data: true } : {}),
    headText: text.slice(r.headSpan[0], r.headSpan[1]).trim(),
    bodyText: text.slice(r.bodySpan[0], r.bodySpan[1]).trim(),
    startOffset: r.startOffset,
    // Both inner spans end *at* their closing brace, and the body's is the
    // later of the two — it is last in the one surface form the grammar has —
    // so the rule ends one past it.
    span: [r.startOffset, r.bodySpan[1] + 1] as const,
  }));

  const dataBlocks: SrlDataBlock[] = ast.dataBlocks.map((d) => {
    // Ground-triple constraint: variables are not allowed in a DATA block.
    // (The base `triplesBlock` grammar permits them, so we reject post-parse.)
    if (containsVariable(d.triples)) {
      throw new Error('SRL syntax error: variables are not allowed in a DATA block');
    }
    return {
      triples: d.triples,
      dataText: text.slice(d.span[0], d.span[1]).trim(),
      span: [d.startOffset, d.span[1] + 1] as const,
    };
  });

  // The tuple grammar rules are always registered (one parser instance), so
  // gate *acceptance* here: without `opts.tuples`, a document using TUPLE is a
  // syntax error rather than silently-ignored input.
  if (!opts.tuples) {
    const usesTuples = rules.some((r) => r.headTuples.length > 0 || bodyUsesTuples(r.body));
    if (usesTuples) {
      throw new Error('SRL syntax error: TUPLE requires the rule-tuples extension (parse with { tuples: true })');
    }
  }

  const prologueText = extractPrologueText(text);

  return { prologue: ast.prologue, prologueText, rules, dataBlocks };
}

/**
 * Render a rule-name term. A prefixed name keeps its prefix until `expandIris`
 * runs (which then rewrites both the term and this string), so that two rules
 * named `:a` and `other:a` are never conflated.
 */
export function ruleName(term: any): string {
  if (typeof term?.prefix === 'string') return `${term.prefix}:${String(term.value ?? '')}`;
  return String(term?.value ?? '');
}

function bodyUsesTuples(items: SrlRule['body']): boolean {
  return items.some((it) => it.kind === 'tuple' || (it.kind === 'not' && bodyUsesTuples(it.body)));
}

/** Deep search for a SPARQL variable term anywhere within an AST node. */
function containsVariable(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  if (n.type === 'term' && n.subType === 'variable') return true;
  for (const [key, value] of Object.entries(n)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      if (value.some(containsVariable)) return true;
    } else if (typeof value === 'object' && value !== null) {
      if (containsVariable(value)) return true;
    }
  }
  return false;
}
