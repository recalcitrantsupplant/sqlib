import type { SrlDataBlock, SrlRule, SrlRuleSet } from './ast.js';
import { generateDataBlock, generateRule } from './generate.js';

/**
 * Document ⇄ individual-rule conversion for ruleset-as-text authoring.
 *
 * Operates purely on ASTs/documents — no entity or persistence types — so it
 * stays upstreamable with the rest of the package. Mapping these onto
 * Rule/RuleVersion entities is the api's job.
 *
 * Storage model (plan §7): a rule's canonical form uses **fully expanded IRIs**
 * and carries no prologue; prefixes are presentation owned by the ruleset. Call
 * `expandIris` before `splitRuleSet` so identity is computed on canonical terms.
 */

export interface SrlRuleDocument {
  /** Author-supplied name from `RULE <iri>`, when present. */
  name?: string;
  /** The rule's own text, without any prologue. */
  text: string;
  /**
   * Identity for re-import matching: the explicit IRI when the rule has one,
   * else `hash:<sha256>` over the canonical rule text.
   */
  identity: string;
  /** True when `identity` came from an explicit `RULE <iri>` name. */
  named: boolean;
  /** Stable, deterministic label for rules lacking an explicit name. */
  suggestedLabel: string;
  /** Position in the source document (0-based). */
  index: number;
}

/**
 * One `DATA { … }` block, decomposed the same way a rule is.
 *
 * A data block has no name in the language, so identity is always a content
 * hash: two documents declaring the same ground triples reuse the same stored
 * block, and editing one mints a new one (the old is detached, never deleted —
 * same rule as for rules).
 */
export interface SrlDataBlockDocument {
  /** The block's own text (`DATA { … }`), without any prologue. */
  text: string;
  /** Identity for re-import matching: `hash:<content hash>`. */
  identity: string;
  /** Stable, deterministic label (`data-1`, `data-2`, …). */
  suggestedLabel: string;
  /** Position among the document's data blocks (0-based). */
  index: number;
}

/**
 * Canonical text of a single rule — prologue-free and generated **from the AST**
 * (never from source slices), so formatting and prefix spelling cannot affect it.
 * Run `expandIris` first for prefix-independent identity.
 */
export function canonicalRuleText(rule: SrlRule): string {
  return generateRule(rule).replace(/\s+/g, ' ').trim();
}

/** Canonical text of a single `DATA { … }` block. See {@link canonicalRuleText}. */
export function canonicalDataBlockText(block: SrlDataBlock): string {
  return generateDataBlock(block).replace(/\s+/g, ' ').trim();
}

/**
 * Stable content hash (cyrb53) — deliberately dependency-free rather than
 * `node:crypto`, so the package stays environment-agnostic (browser-usable and
 * upstreamable). This is an identity key for matching rules on re-import, not a
 * security primitive.
 */
function contentHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
}

/**
 * Split a parsed ruleset document into one self-contained document per rule.
 *
 * Naming: an explicit `RULE <iri>` wins; otherwise a **deterministic** label is
 * derived from the head predicate (when available) plus the rule's ordinal, so
 * re-importing an unchanged document never churns names. Never uses timestamps
 * or random ids.
 */
export function splitRuleSet(ruleSet: SrlRuleSet): SrlRuleDocument[] {
  return ruleSet.rules.map((rule, index) => {
    const text = canonicalRuleText(rule);
    const named = Boolean(rule.name);
    return {
      name: rule.name,
      text,
      identity: named ? rule.name! : `hash:${contentHash(text)}`,
      named,
      suggestedLabel: named ? localName(rule.name!) : deterministicLabel(rule, index),
      index,
    };
  });
}

/**
 * Split a parsed ruleset document's `DATA` blocks into one document each.
 *
 * The rule counterpart of {@link splitRuleSet}. Both must be called to
 * decompose a document without loss: a ruleset is prologue + DATA + rules, and
 * mapping only the rules silently drops the data (which is exactly the export
 * bug this pair exists to close).
 */
export function splitDataBlocks(ruleSet: SrlRuleSet): SrlDataBlockDocument[] {
  return ruleSet.dataBlocks.map((block, index) => {
    const text = canonicalDataBlockText(block);
    return {
      text,
      identity: `hash:${contentHash(text)}`,
      suggestedLabel: `data-${index + 1}`,
      index,
    };
  });
}

function localName(iri: string): string {
  const match = /[^/#:]+$/.exec(iri);
  return match ? match[0] : iri;
}

/** e.g. `rule-3-childOf` — stable for a given document. */
function deterministicLabel(rule: SrlRule, index: number): string {
  const predicate = firstHeadPredicate(rule);
  const suffix = predicate ? `-${localName(predicate)}` : '';
  return `rule-${index + 1}${suffix}`;
}

function firstHeadPredicate(rule: SrlRule): string | undefined {
  const triples = (rule.head as any)?.triples;
  const term = Array.isArray(triples) ? triples[0]?.predicate : undefined;
  if (term?.type === 'term' && term?.subType === 'namedNode') return String(term.value ?? '');
  return undefined;
}

/**
 * Render a set of rule documents back into one SRL document.
 *
 * The prologue is supplied by the caller (it belongs to the ruleset, per §7).
 * Because rules are stored with expanded IRIs there is exactly one prefix map in
 * play, so no prologue reconciliation or prefix-collision rewriting is needed.
 *
 * Rules are stored expanded, so the prologue's prefixes are also *applied* here —
 * abbreviating `<http://example.org/q>` back to `:q`. Without that the emitted
 * prologue would be decorative: declared but never used in the rule text.
 *
 * `DATA` blocks are emitted **before** the rules. Their position relative to the
 * rules is not semantically meaningful — data is seeded before evaluation
 * wherever it is written — but a synthesized document cannot know where the
 * author had them, so data-first is the stable convention.
 */
export function mergeRuleSet(
  docs: Array<Pick<SrlRuleDocument, 'text'>>,
  prologueText = '',
  dataBlocks: Array<Pick<SrlDataBlockDocument, 'text'>> = [],
): string {
  const prologue = prologueText.trim();
  const abbreviate = prefixAbbreviator(prologue);
  const body = [...dataBlocks, ...docs]
    .map((d) => abbreviate(d.text.trim()))
    .filter(Boolean)
    .join('\n\n');
  return prologue ? `${prologue}\n\n${body}\n` : `${body}\n`;
}

/**
 * Rewrite `<full-iri>` to `prefix:local` throughout a text, for each PREFIX in
 * the given prologue.
 *
 * The presentation half of the canonical-storage rule: content is stored with
 * expanded IRIs, and abbreviated back for display against whichever prologue
 * the caller supplies. Used for rule text by {@link mergeRuleSet}, and exposed
 * for the parts of a ruleset stored outside a document — tuple seed rows.
 */
export function abbreviateIris(text: string, prologueText = ''): string {
  return prefixAbbreviator(prologueText.trim())(text);
}

/**
 * Build a function that rewrites `<full-iri>` to `prefix:local` for each PREFIX
 * declared in the prologue.
 *
 * Longest namespace first, so nested namespaces abbreviate against the most
 * specific match. Only abbreviates when the remaining local part is a legal
 * PN_LOCAL-ish token — otherwise the full IRI is left alone rather than emitting
 * something unparseable.
 */
function prefixAbbreviator(prologue: string): (text: string) => string {
  const prefixes: Array<[prefix: string, namespace: string]> = [];
  for (const line of prologue.split('\n')) {
    const m = /^\s*PREFIX\s+([^\s:]*):\s*<([^>]*)>/i.exec(line);
    if (m) prefixes.push([m[1], m[2]]);
  }
  if (prefixes.length === 0) return (text) => text;
  prefixes.sort((a, b) => b[1].length - a[1].length);

  return (text) =>
    text.replace(/<([^>\s]+)>/g, (full, iri: string) => {
      for (const [prefix, namespace] of prefixes) {
        if (!namespace || !iri.startsWith(namespace)) continue;
        const local = iri.slice(namespace.length);
        if (/^[A-Za-z_][\w.\-]*$/.test(local)) return `${prefix}:${local}`;
      }
      return full;
    });
}

/** A document part that can be reconciled: anything with identity and text. */
export type ReconcilableDocument = { identity: string; text: string };

/** Outcome of reconciling a re-imported document against the stored parts. */
export interface ReconcileResult<T, D extends ReconcilableDocument = SrlRuleDocument> {
  /** Parts in the document that match nothing stored — create these. */
  created: D[];
  /** Document parts matched to a stored one — update if the text differs. */
  updated: Array<{ doc: D; existing: T; changed: boolean }>;
  /** Stored parts absent from the document — detach, never delete (§7). */
  detached: T[];
}

/**
 * Reconcile a re-imported document against the currently stored parts.
 *
 * Matching is by explicit IRI where present, else by canonical content hash — so
 * a prefix-only edit is a no-op (the canonical text uses expanded IRIs) and
 * re-importing an unchanged document reports no changes at all.
 *
 * Generic over the document part so the same machinery reconciles rules
 * ({@link SrlRuleDocument}) and data blocks ({@link SrlDataBlockDocument}); the
 * matching rule is identical, only the identity source differs.
 */
export function reconcileRuleSet<T, D extends ReconcilableDocument = SrlRuleDocument>(
  docs: D[],
  existing: T[],
  identityOf: (item: T) => string,
  textOf: (item: T) => string,
): ReconcileResult<T, D> {
  const byIdentity = new Map<string, T>();
  for (const item of existing) byIdentity.set(identityOf(item), item);

  const created: D[] = [];
  const updated: ReconcileResult<T, D>['updated'] = [];
  const matched = new Set<T>();

  for (const doc of docs) {
    const hit = byIdentity.get(doc.identity);
    if (!hit) {
      created.push(doc);
      continue;
    }
    matched.add(hit);
    updated.push({ doc, existing: hit, changed: textOf(hit).trim() !== doc.text.trim() });
  }

  return { created, updated, detached: existing.filter((item) => !matched.has(item)) };
}
