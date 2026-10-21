/**
 * A stored rule set version as one SRL document.
 *
 * The document is what `GET /rule-sets/:id/srl` returns and what an export
 * bundle carries: the rules' text, then each data block as a `DATA { … }`
 * block. Kept out of the route so the bundle export builds the same document
 * from the same entities.
 */

import {
  canonicalDataBlockText,
  expandIris,
  extractPrologueText,
  mergeRuleSet,
  parseRuleSet,
} from '@sparql-query-lib/srl';
import type { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import type { LdkitDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import { ruleAggregatesAllowed } from './ruleAggregates.js';

/** The entity reads a document needs. */
export interface RuleSetDocumentRepos {
  RuleVersion: { get: (id: string) => unknown };
  DataBlockVersion: { get: (id: string) => unknown };
}

export interface RuleSetDocument {
  srl: string;
  ruleCount: number;
  dataBlockCount: number;
  /** Data blocks left out because they have no `DATA` form. */
  warnings: string[];
}

function normalizeIdList(value: unknown): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [String(value)];
}

/**
 * Render a stored data block as an SRL `DATA { … }` block, or null when it is
 * not expressible as one.
 *
 * Two shapes reach this: blocks written through the SRL document path (already
 * `DATA { … }`) and blocks authored in the standalone data-block editor, which
 * are ordinarily `INSERT DATA { … }` SPARQL. Anything else — an arbitrary
 * update, say — has no `DATA` form and is reported as omitted rather than
 * mangled into one.
 */
export function toDataBlockText(dataString?: string | null): string | null {
  const raw = (dataString ?? '').trim();
  if (!raw) return null;

  // IRIs are expanded before canonicalizing, exactly as on the rule path: the
  // canonical form is prefix-independent, so a block spelled `:a` and one
  // spelled with the full IRI are the same block and match on re-import.
  const canonicalize = (document: string): string | null => {
    try {
      const parsed = expandIris(parseRuleSet(document, { tuples: true, aggregates: ruleAggregatesAllowed() }));
      if (parsed.rules.length > 0 || parsed.dataBlocks.length === 0) return null;
      return parsed.dataBlocks.map((b) => canonicalDataBlockText(b)).join('\n\n');
    } catch {
      return null;
    }
  };

  const asSrl = canonicalize(raw);
  if (asSrl) return asSrl;

  // The standalone data-block editor stores SPARQL, ordinarily
  // `[prologue] INSERT DATA { … }`. Rewrite that into the SRL form; anything
  // else (an arbitrary update, say) has no DATA form and is left alone.
  const prologue = extractPrologueText(raw);
  const withoutPrologue = raw
    .split('\n')
    .filter((line) => !/^[ \t]*(PREFIX|BASE)\b/i.test(line))
    .join('\n')
    .trim();
  const insertData = /^INSERT\s+DATA\s*\{([\s\S]*)\}\s*;?\s*$/i.exec(withoutPrologue);
  if (!insertData) return null;
  const inner = insertData[1].trim();
  return canonicalize(`${prologue ? `${prologue}\n` : ''}DATA { ${inner} }`);
}

/** DataBlockVersion IDs referenced by a rule set version, resolved to entities. */
export function loadDataBlockVersions(
  repos: { DataBlockVersion: { get: (id: string) => unknown } },
  version: LdkitRuleSetVersion,
): LdkitDataBlockVersion[] {
  const out: LdkitDataBlockVersion[] = [];
  for (const dataBlockVersionId of normalizeIdList(version.hasDataBlock)) {
    const found = repos.DataBlockVersion.get(dataBlockVersionId) as LdkitDataBlockVersion | undefined;
    if (found) out.push(found);
  }
  return out;
}

/** RuleVersion IDs referenced by a rule set version, resolved to entities. */
export function loadRuleVersions(
  repos: { RuleVersion: { get: (id: string) => unknown } },
  version: LdkitRuleSetVersion,
): LdkitRuleVersion[] {
  const out: LdkitRuleVersion[] = [];
  for (const ruleVersionId of normalizeIdList(version.hasRule)) {
    const found = repos.RuleVersion.get(ruleVersionId) as LdkitRuleVersion | undefined;
    if (found) out.push(found);
  }
  return out;
}

/**
 * Build the SRL document for a rule set version.
 *
 * `prologue` is presentation only: rules are stored with IRIs written out in
 * full, and the prologue abbreviates them for a reader.
 */
export function buildRuleSetDocument(
  repos: RuleSetDocumentRepos,
  version: LdkitRuleSetVersion,
  prologue = '',
): RuleSetDocument {
  const ruleVersions = loadRuleVersions(repos, version);
  const warnings: string[] = [];
  const dataDocs: Array<{ text: string }> = [];
  for (const dbv of loadDataBlockVersions(repos, version)) {
    const text = toDataBlockText(dbv.dataString);
    if (text) dataDocs.push({ text });
    // Never fabricate SRL for content that is not ground triples — say what
    // was left out instead, or the round-trip silently rewrites the ruleset.
    else warnings.push(`Data block ${dbv.$id} is not expressible as an SRL DATA block and was omitted from the document.`);
  }

  const srl = mergeRuleSet(
    ruleVersions.map((rv) => ({ text: rv.ruleString ?? '' })),
    prologue,
    dataDocs,
  );
  return { srl, ruleCount: ruleVersions.length, dataBlockCount: dataDocs.length, warnings };
}
