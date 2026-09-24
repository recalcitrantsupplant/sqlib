/**
 * Whole-document conversion between full IRIs and prefixed names.
 *
 * The two toolbar buttons above an editor run the text through here: one
 * rewrites `<http://schema.org/name>` down to `schema:name`, the other pushes
 * every prefixed name back out to its full IRI. Text in, text out, and
 * everything not understood is left exactly as written.
 *
 * WHY THE EDITOR'S OWN GRAMMAR. The terms to rewrite have to be told apart
 * from the text that merely looks like them, and every case is one the Lezer
 * grammars already decide for syntax highlighting:
 *
 *   FILTER(STRSTARTS(?s, "<http://example.org/>"))   -- String, a leaf token
 *   # see <http://example.org/spec> for why           -- Comment, a leaf token
 *   PREFIX ex: <http://example.org/>                  -- under PrefixDecl
 *   ?s ?p _:b0                                        -- Blank_node_label
 *
 * A hand-written scanner has to re-derive all four, plus PN_LOCAL's Unicode
 * character classes, from the grammar — and `curie.ts` says exactly where that
 * ends: "hand-writing a Unicode character class from a grammar is exactly
 * where a silent mistake lives". Walking the tree the editor already builds
 * means one answer to what an IRI is, maintained by the grammar's authors.
 *
 * Lezer's error recovery is what makes this usable on a document being typed.
 * A query with an unclosed brace still yields correct term nodes outside the
 * broken region; terms inside it are missed rather than mangled, and pressing
 * the button again after the syntax is fixed converts them.
 *
 * WHY IT TAKES A PARSER RATHER THAN FINDING ONE. Only a grammar that actually
 * describes the document may be used. SRL was long highlighted with the SPARQL
 * grammar, which is close enough to colour but not to rewrite: SPARQL has no
 * `:=`, so it reads the ':' of SRL's assignment operator as a prefix label, and
 * expanding it would turn `?km := xsd:integer` into `?km <http://example/>= …`.
 * Approximate highlighting is a good trade; an approximate rewrite corrupts
 * documents. So the caller passes the grammar for the language it is actually
 * holding, and a language with no grammar of its own gets no buttons — see
 * `prefixGrammarFor`.
 *
 * SRL now has one (`@kurrawongai/codemirror-lang-srl`, issue #157), it lexes
 * `:=` as a single token, and the three published grammars share one node
 * vocabulary — so this walk reads an SRL document as it reads a query. The
 * round-trip corpus in `test/lib/prefixRewrite.test.ts` covers it: rule heads
 * and bodies, DATA and NOT DATA blocks, `TUPLE( … )` terms, and the assignment
 * that was the original hazard. The rules editor has the buttons.
 *
 * WHY THE DOCUMENT'S OWN DECLARATIONS WIN. A query that declares
 * `PREFIX foaf: <http://example.org/local/>` means that, whatever the prefix
 * manager thinks `foaf` is. Expansion reads the document's PREFIX block first
 * and only falls back to the manager for prefixes the document never declared;
 * contraction refuses to emit a prefix the document has already bound to a
 * different namespace, because `foaf:name` would then denote something other
 * than the IRI it replaced. Both rules exist so a conversion cannot change the
 * meaning of a query — the one thing a button that rewrites your whole
 * document must never do.
 *
 * WHAT EXPANSION SWEEPS. Once every prefixed name is a full IRI, the PREFIX
 * declarations above them name nothing, and leaving them is the untidy half of
 * a conversion. So expansion removes a declaration when two things hold: the
 * document no longer uses that prefix, AND the prefix manager holds the same
 * binding. The second condition is what keeps the round trip lossless —
 * contracting again re-declares it from the manager — and it is also what
 * protects a mapping the app could not reproduce: a document that declares a
 * prefix the manager has never seen keeps its declaration, because deleting it
 * would throw away something only the author knew.
 *
 * WHAT CONTRACTION WILL NOT DO. It abbreviates against the prefix manager's
 * mappings and nothing else. An IRI whose namespace has no registered prefix
 * stays a full IRI; no `ns1:`, `ns2:` names are invented for it the way RDF
 * serialisers do. An invented prefix is a name nobody chose, and a document
 * full of them is harder to read than the IRIs it replaced.
 */

import type { LRLanguage } from '@codemirror/language';
import { shrink, expand, type PrefixPair } from '@/lib/curie';

/**
 * The grammar a rewrite runs against.
 *
 * Reached through `LRLanguage` rather than by importing `@lezer/lr` directly:
 * `@codemirror/language` is a dependency this package declares, and the lezer
 * parser only arrives underneath it.
 */
export type PrefixGrammar = LRLanguage['parser'];

export interface RewriteResult {
  /** The rewritten document. Identical to the input when `converted` is 0. */
  text: string;
  /** How many terms were rewritten. */
  converted: number;
  /**
   * Terms that matched a prefix the document binds to a different namespace,
   * and were left as full IRIs rather than given a meaning they do not have.
   */
  skippedShadowed: number;
  /** Declarations added to the top of the document, in the order added. */
  added: PrefixPair[];
  /** Declarations removed as no longer naming anything, in document order. */
  removed: PrefixPair[];
}

/*
 * Prologue nodes, whose contents are the declaration itself rather than terms
 * to rewrite. Every dialect is covered: Turtle spells them PrefixID (`@prefix`)
 * and Base (`@base`), plus SparqlPrefix/SparqlBase for the keyword forms it
 * also accepts; SPARQL and SRL spell them PrefixDecl and BaseDecl.
 *
 * Listed exactly rather than matched on /prefix/i, which would also catch
 * `PrefixedName` — the parent of every prefixed name in the document, and so
 * would exempt the very terms this exists to find.
 *
 * `test/lib/grammarContract.test.ts` holds the grammars to these names. They
 * are the whole interface between this walk and the packages, and a rename
 * upstream would not throw — it would quietly find no terms and convert
 * nothing, which is the one failure a user cannot tell from "no IRIs here".
 */
const DECLARATION_NODES = new Set([
  'PrefixDecl',
  'BaseDecl',
  'PrefixID',
  'Base',
  'SparqlPrefix',
  'SparqlBase',
]);

/** One spelling across all six languages since the grammars were unified. */
const IRI_NODES = new Set(['IRIRef']);

/**
 * A prefixed name: `foaf:name` (PNameLN) or the bare `foaf:` / `:` form
 * (PNameNS), both of which denote an IRI and both of which expand.
 */
const PREFIXED_NAME_NODES = new Set(['PNameLN', 'PNameNS']);

/** The declaration nodes that bind the base IRI rather than a prefix. */
const BASE_NODES = new Set(['BaseDecl', 'Base', 'SparqlBase']);

interface Term {
  kind: 'iri' | 'prefixedName';
  /** For an IRI, the text without its angle brackets. */
  value: string;
  from: number;
  /** Exclusive. */
  to: number;
}

/** One PREFIX/@prefix declaration, and where it sits so it can be removed. */
interface Declaration {
  prefix: string;
  namespace: string;
  from: number;
  /** Exclusive. Covers the whole directive, Turtle's trailing '.' included. */
  to: number;
}

interface Scanned {
  /** The document's own declarations, prefix -> namespace. */
  declared: Map<string, string>;
  /** The same declarations with their ranges, in document order. */
  declarations: Declaration[];
  /** Every term outside the prologue, in document order. */
  terms: Term[];
}

/**
 * One walk of the syntax tree, yielding the document's declarations and the
 * terms a rewrite may touch.
 *
 * Comments and string literals need no handling: both grammars emit them as
 * leaf tokens, so a walk never descends into one and an IRI written inside
 * either is simply never seen. Blank node labels are their own node type
 * (`BlankNodeLabel`) and are not prefixed names, so `_:b0` is excluded by
 * the grammar rather than by a rule here.
 */
function scan(text: string, parser: PrefixGrammar): Scanned {
  const declared = new Map<string, string>();
  const declarations: Declaration[] = [];
  const terms: Term[] = [];

  /*
   * Depth rather than a flag: declarations do not nest, but tracking depth
   * means `leave` cannot get out of step with `enter` if a grammar ever wraps
   * one in another.
   */
  let declarationDepth = 0;
  let pendingPrefix: string | null = null;
  let declarationRange: { from: number; to: number } | null = null;

  parser.parse(text).iterate({
    enter(node) {
      if (DECLARATION_NODES.has(node.name)) {
        declarationDepth += 1;
        pendingPrefix = null;
        // Remember where it starts and ends; BASE never becomes a candidate for
        // removal, so only the prefix forms are tracked.
        declarationRange = BASE_NODES.has(node.name)
          ? null
          : { from: node.from, to: node.to };
        return true;
      }

      const slice = () => text.slice(node.from, node.to);

      if (declarationDepth > 0) {
        // Inside a declaration: read it, never rewrite it. The label comes
        // first and the namespace second, which is what pairs them.
        if (node.name === 'PNameNS') {
          pendingPrefix = slice().slice(0, -1);
        } else if (IRI_NODES.has(node.name) && pendingPrefix !== null) {
          // A later declaration of the same prefix wins, as it does for a
          // SPARQL processor.
          const namespace = slice().slice(1, -1);
          declared.set(pendingPrefix, namespace);
          if (declarationRange !== null) {
            declarations.push({ prefix: pendingPrefix, namespace, ...declarationRange });
          }
          pendingPrefix = null;
        }
        return true;
      }

      if (IRI_NODES.has(node.name)) {
        terms.push({ kind: 'iri', value: slice().slice(1, -1), from: node.from, to: node.to });
      } else if (PREFIXED_NAME_NODES.has(node.name)) {
        terms.push({ kind: 'prefixedName', value: slice(), from: node.from, to: node.to });
      }
      return true;
    },
    leave(node) {
      if (DECLARATION_NODES.has(node.name)) declarationDepth -= 1;
    },
  });

  return { declared, declarations, terms };
}

/** The document's own PREFIX/BASE declarations, prefix -> namespace. */
export function readDeclaredPrefixes(text: string, parser: PrefixGrammar): Map<string, string> {
  return scan(text, parser).declared;
}

/**
 * Full IRIs down to prefixed names, adding the declarations the result needs.
 *
 * `pairs` must be sorted by descending namespace length — the longest match is
 * the most specific reading, and `shrink` relies on the caller having sorted.
 */
export function toPrefixedNames(
  text: string,
  pairs: readonly PrefixPair[],
  parser: PrefixGrammar,
): RewriteResult {
  const { declared, terms } = scan(text, parser);
  const added = new Map<string, string>();
  let out = '';
  let cursor = 0;
  let converted = 0;
  let skippedShadowed = 0;

  for (const term of terms) {
    if (term.kind !== 'iri') continue;

    const result = shrink(term.value, pairs);
    if (!result) continue;

    /*
     * Refuse a prefix this document has already bound elsewhere. Emitting it
     * would silently repoint the term at the document's namespace, which is
     * the one failure mode worse than leaving the IRI long.
     */
    const boundTo = declared.get(result.prefix) ?? added.get(result.prefix);
    if (boundTo !== undefined && boundTo !== result.namespace) {
      skippedShadowed += 1;
      continue;
    }

    if (boundTo === undefined) added.set(result.prefix, result.namespace);

    out += text.slice(cursor, term.from) + result.curie;
    cursor = term.to;
    converted += 1;
  }

  out += text.slice(cursor);

  const declarations = [...added]
    .filter(([prefix]) => !declared.has(prefix))
    .map(([prefix, namespace]) => ({ prefix, namespace }));

  return {
    text: declarations.length > 0 ? insertDeclarations(out, declarations) : out,
    converted,
    skippedShadowed,
    added: declarations,
    removed: [],
  };
}

/** What `addDeclarations` did, for the message that reports it. */
export interface DeclarationsAdded {
  text: string;
  added: PrefixPair[];
  /** Left alone: the document already binds that prefix. */
  skipped: PrefixPair[];
}

/**
 * Declare prefixes the document has not declared, without touching its terms.
 *
 * This is the Prefix Manager's "Add to editor": the prefixes go into the
 * prologue so the editor's completions and the reader both have them, and
 * nothing below the prologue changes.
 *
 * A prefix the document already binds is skipped whatever it is bound to —
 * rebinding it would silently repoint every name written with it, which is the
 * failure `toPrefixedNames` refuses for the same reason.
 */
export function addDeclarations(
  text: string,
  pairs: readonly PrefixPair[],
  parser: PrefixGrammar,
): DeclarationsAdded {
  const declared = readDeclaredPrefixes(text, parser);

  const added: PrefixPair[] = [];
  const skipped: PrefixPair[] = [];
  for (const pair of pairs) {
    if (declared.has(pair.prefix) || added.some((a) => a.prefix === pair.prefix)) skipped.push(pair);
    else added.push(pair);
  }

  return {
    text: added.length > 0 ? insertDeclarations(text, added) : text,
    added,
    skipped,
  };
}

/**
 * Prefixed names back out to full IRIs.
 *
 * The document's own declarations are consulted before `namespaceFor`, so a
 * query that rebinds a well-known prefix expands to what it actually means
 * rather than to what the prefix manager would have chosen.
 */
export function toFullIris(
  text: string,
  namespaceFor: (prefix: string) => string | undefined,
  parser: PrefixGrammar,
): RewriteResult {
  const { declared, declarations, terms } = scan(text, parser);

  interface Edit { from: number; to: number; insert: string }
  const edits: Edit[] = [];

  /*
   * Prefixes still standing after the pass — a name whose prefix is neither
   * declared here nor known to the manager cannot expand, so its declaration,
   * if it has one, is still doing work.
   */
  const stillUsed = new Set<string>();

  for (const term of terms) {
    if (term.kind !== 'prefixedName') continue;

    const iri = expand(term.value, (prefix) => declared.get(prefix) ?? namespaceFor(prefix));
    if (iri === null) {
      stillUsed.add(term.value.slice(0, term.value.indexOf(':')));
      continue;
    }

    edits.push({ from: term.from, to: term.to, insert: `<${iri}>` });
  }

  const converted = edits.length;
  const removed: PrefixPair[] = [];

  /*
   * Sweep only alongside a conversion. Pressing Expand on a document that had
   * nothing to expand should not quietly delete its prologue.
   */
  if (converted > 0) {
    for (const declaration of declarations) {
      if (stillUsed.has(declaration.prefix)) continue;
      // Removable only if contracting could put it back. Where the manager
      // disagrees, or has never heard of this prefix, the declaration is the
      // only record of the binding and stays.
      if (namespaceFor(declaration.prefix) !== declaration.namespace) continue;

      edits.push({ ...wholeLineIfAlone(text, declaration), insert: '' });
      removed.push({ prefix: declaration.prefix, namespace: declaration.namespace });
    }
  }

  edits.sort((a, b) => a.from - b.from);

  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    out += text.slice(cursor, edit.from) + edit.insert;
    cursor = edit.to;
  }

  return { text: out + text.slice(cursor), converted, skippedShadowed: 0, added: [], removed };
}

/**
 * A declaration's range, widened to its whole line when it has the line to
 * itself — otherwise removing it would leave the indentation and the newline
 * behind as a blank gap where a PREFIX used to be.
 */
function wholeLineIfAlone(text: string, range: { from: number; to: number }) {
  let start = range.from;
  while (start > 0 && text[start - 1] !== '\n' && /\s/.test(text[start - 1]!)) start -= 1;

  let end = range.to;
  while (end < text.length && text[end] !== '\n' && /\s/.test(text[end]!)) end += 1;

  const startsTheLine = start === 0 || text[start - 1] === '\n';
  const endsTheLine = end === text.length || text[end] === '\n';
  if (!startsTheLine || !endsTheLine) return { from: range.from, to: range.to };

  return { from: start, to: end < text.length ? end + 1 : end };
}

/**
 * New PREFIX lines, below the ones already there.
 *
 * Below rather than above so a document's own declarations stay where their
 * author put them, and the added block reads as an addition rather than as a
 * reordering of what was written.
 */
function insertDeclarations(text: string, declarations: readonly PrefixPair[]): string {
  const block = declarations
    .map(({ prefix, namespace }) => `PREFIX ${prefix}: <${namespace}>`)
    .join('\n');

  const lines = text.split('\n');
  let lastDeclaration = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(?:PREFIX|BASE)\b/i.test(lines[i]!) || /^\s*@(?:prefix|base)\b/i.test(lines[i]!)) {
      lastDeclaration = i;
    }
  }

  if (lastDeclaration === -1) {
    // One newline, not two. Expansion sweeps declarations and contraction puts
    // them back, so a blank line added here is a blank line the round trip
    // inserts into a document that never had one.
    return `${block}\n${text}`;
  }

  lines.splice(lastDeclaration + 1, 0, block);
  return lines.join('\n');
}
