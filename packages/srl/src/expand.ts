import type { SrlRuleSet } from './ast.js';
import { ruleName } from './parse.js';

/**
 * Expand prefixed names to full IRIs throughout a rule set's structured AST,
 * using the document prologue's PREFIX/BASE declarations.
 *
 * Per plan §7, expanded IRIs are the canonical form: stratification and
 * identity must compare full IRIs so that rules using different prefix spellings
 * for the same term are matched. This mutates the parsed AST in place (the parse
 * result is not shared) and returns it for convenience.
 *
 * Only the structured `head`/`body` term nodes are affected; the verbatim
 * `headText`/`bodyText`/`prologueText` source slices are left untouched.
 */
export function expandIris(ruleSet: SrlRuleSet): SrlRuleSet {
  const prefixes = prefixMap(ruleSet.prologue);
  for (const rule of ruleSet.rules) {
    // Expand the rule's own name too, so `:a` and `other:a` stay distinct and a
    // named rule's identity is a full IRI.
    if (rule.nameTerm) {
      expandNode(rule.nameTerm, prefixes);
      rule.name = ruleName(rule.nameTerm);
    }
    expandNode(rule.head, prefixes);
    // Head tuple templates must be expanded too: a write spelled `:rel` and a
    // read spelled with the full IRI would otherwise never match, silently
    // breaking tuple dataflow. (Body tuples are reached via the body items.)
    for (const tuple of rule.headTuples ?? []) expandNode(tuple, prefixes);
    for (const item of rule.body) expandNode(item, prefixes);
  }
  for (const block of ruleSet.dataBlocks) expandNode(block.triples, prefixes);
  return ruleSet;
}

/**
 * Expand prefixed names in arbitrary AST nodes against a parsed prologue.
 *
 * The same machinery {@link expandIris} runs over a ruleset, exposed for AST
 * fragments that are not a ruleset — tuple seed rows, chiefly. Mutates in place.
 */
export function expandTerms(nodes: unknown, prologue: unknown): void {
  expandNode(nodes, prefixMap(prologue));
}

function prefixMap(prologue: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(prologue)) return map;
  for (const def of prologue) {
    if (def?.type === 'contextDef' && def?.subType === 'prefix') {
      map.set(String(def.key ?? ''), String(def.value?.value ?? ''));
    }
  }
  return map;
}

function expandNode(node: unknown, prefixes: Map<string, string>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, any>;

  if (n.type === 'term' && n.subType === 'namedNode' && typeof n.prefix === 'string') {
    const namespace = prefixes.get(n.prefix);
    if (namespace !== undefined) {
      n.value = `${namespace}${String(n.value ?? '')}`;
      delete n.prefix;
    }
    return;
  }

  for (const [key, value] of Object.entries(n)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const v of value) expandNode(v, prefixes);
    } else if (value && typeof value === 'object') {
      expandNode(value, prefixes);
    }
  }
}
