/**
 * Adding a library's rule sets to an export bundle.
 *
 * A rule set travels as the SRL document `GET /rule-sets/:id/srl` returns for
 * its current version, not as compiled SPARQL: whatever runs it needs `srl` to
 * layer the rules anyway, and the document is what a person can read and diff.
 * The document is parsed here before it is written, so a bundle never carries
 * one its reader would refuse.
 *
 * A rule set that cannot be carried whole — no current version, a data block
 * with no `DATA` form, a document that does not parse — is skipped with its
 * reason. Carrying it without the data block would run different rules.
 */

import { expandIris, parseRuleSet } from '@sparql-query-lib/srl';
import {
  hashTemplateText,
  type ExportBundle,
  type ExportedRuleSet,
} from '@sparql-query-lib/runtime';
import type { PersistedRuleSet } from '../../persistence/schemas/RuleSetSchema.js';
import type { PersistedRuleSetVersion } from '../../persistence/schemas/RuleSetVersionSchema.js';
import { buildRuleSetDocument, type RuleSetDocumentRepos } from '../ruleSetDocument.js';
import { ruleTuplesAllowed } from '../ruleTuples.js';
import { ruleAggregatesAllowed } from '../ruleAggregates.js';
import type { EntityRepositories } from '../EntityRepositories.js';
import type { SkippedQuery } from './collectLibraryQueries.js';
import { reserveKey } from './queryBundle.js';

/** The entity reads this module needs, so a script can supply them too. */
export interface LibraryRuleSetSource extends RuleSetDocumentRepos {
  listRuleSets(): PersistedRuleSet[];
  getRuleSetVersion(id: string): PersistedRuleSetVersion | null;
}

/** The source over a set of entity repositories: a request's, or a script's. */
export function ruleSetSource(
  repos: Pick<EntityRepositories, 'RuleSet' | 'RuleSetVersion' | 'RuleVersion' | 'DataBlockVersion'>,
): LibraryRuleSetSource {
  return {
    listRuleSets: () => repos.RuleSet.list() as PersistedRuleSet[],
    getRuleSetVersion: (id) => repos.RuleSetVersion.get(id) as PersistedRuleSetVersion | null,
    RuleVersion: repos.RuleVersion,
    DataBlockVersion: repos.DataBlockVersion,
  };
}

export interface AttachRuleSetsOptions {
  /** Tag IRIs to filter by. Empty means every rule set in the library. */
  tags?: readonly string[];
  match?: 'any' | 'all';
}

function matchesTags(ruleSet: PersistedRuleSet, tags: readonly string[], match: 'any' | 'all'): boolean {
  if (tags.length === 0) return true;
  const carried = ruleSet.tags ?? [];
  return match === 'all'
    ? tags.every((tag) => carried.includes(tag))
    : tags.some((tag) => carried.includes(tag));
}

class RuleSetExportError extends Error {}

async function exportRuleSet(ruleSet: PersistedRuleSet, source: LibraryRuleSetSource): Promise<ExportedRuleSet> {
  if (!ruleSet.currentVersion) throw new RuleSetExportError('The rule set has no current version.');
  const version = source.getRuleSetVersion(ruleSet.currentVersion);
  if (!version) throw new RuleSetExportError(`Its current version ${ruleSet.currentVersion} could not be found.`);

  const document = buildRuleSetDocument(source, version);
  if (document.warnings.length > 0) throw new RuleSetExportError(document.warnings.join(' '));
  if (document.ruleCount === 0 && document.dataBlockCount === 0) {
    throw new RuleSetExportError('Its current version has no rules and no data.');
  }

  // With the extension withheld the server would not run the document as
  // extended SRL, so neither does the bundle.
  const tuplesEnabled = ruleTuplesAllowed() && version.tuplesEnabled === true;
  try {
    expandIris(parseRuleSet(document.srl, { tuples: tuplesEnabled, aggregates: ruleAggregatesAllowed() }));
  } catch (error) {
    throw new RuleSetExportError(`Its SRL document does not parse: ${(error as Error).message}`);
  }
  const tupleSeeds = tuplesEnabled ? (version.tupleSeeds ?? '').trim() : '';

  return {
    srl: document.srl,
    textHash: await hashTemplateText(document.srl),
    ruleCount: document.ruleCount,
    dataBlockCount: document.dataBlockCount,
    ...(tuplesEnabled ? { tuplesEnabled } : {}),
    ...(tupleSeeds ? { tupleSeeds } : {}),
    name: ruleSet.name,
    ...(ruleSet.description ? { description: ruleSet.description } : {}),
    ...(ruleSet.tags && ruleSet.tags.length > 0 ? { tags: [...ruleSet.tags] } : {}),
    sourceRuleSet: ruleSet.$id,
    sourceVersion: version.$id,
  };
}

/**
 * Add a library's rule sets to a bundle. Mutates and returns it, as
 * `attachGroupsToBundle` does.
 */
export async function attachRuleSetsToBundle(
  bundle: ExportBundle,
  source: LibraryRuleSetSource,
  libraryId: string,
  options: AttachRuleSetsOptions = {},
): Promise<{ bundle: ExportBundle; skipped: SkippedQuery[] }> {
  const tags = options.tags ?? [];
  const match = options.match ?? 'any';
  const ruleSets = source
    .listRuleSets()
    .filter((ruleSet) => ruleSet.isPartOf?.includes(libraryId))
    .filter((ruleSet) => matchesTags(ruleSet, tags, match))
    // Sorted so an unchanged library re-exports byte for byte.
    .sort((a, b) => (a.name ?? a.$id).localeCompare(b.name ?? b.$id));

  const exported: Record<string, ExportedRuleSet> = {};
  const keys = new Set<string>();
  const skipped: SkippedQuery[] = [];
  for (const ruleSet of ruleSets) {
    const name = ruleSet.name ?? ruleSet.$id;
    try {
      exported[reserveKey(name, keys)] = await exportRuleSet(ruleSet, source);
    } catch (error) {
      if (error instanceof RuleSetExportError) {
        skipped.push({ id: ruleSet.$id, name, reason: error.message });
        continue;
      }
      throw error;
    }
  }
  if (Object.keys(exported).length > 0) bundle.ruleSets = exported;
  return { bundle, skipped };
}
