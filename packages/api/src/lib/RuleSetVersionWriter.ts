import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import type { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { RuleStratifier } from './RuleStratifier.js';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import type { LdkitDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import { getFeatureFlags } from '../config/featureFlags.js';
import { ruleTuplesRefusal, hasSeedText } from './ruleTuples.js';

type AnyRecord = Record<string, any>;

export interface CreateRuleSetVersionInput {
  comment?: string | null;
  hasRule?: string[] | null;
  hasDataBlock?: string[] | null;
  immutable?: boolean;
  /** SRL tuple-seed document: the ruleset's initial named tuples. */
  tupleSeeds?: string | null;
  /** Whether this version opts into the rule-tuples extension. */
  tuplesEnabled?: boolean | null;
  /**
   * Attach rules and data blocks the grammar rejected, the way
   * `CreateRuleVersionInput.allowInvalidSave` lets one be written in the first
   * place.
   *
   * Both halves are needed or neither works: the rule writer would store an
   * invalid rule that no rule set could then reference, which is a rule you can
   * save and never see again. Gated by `rulesAllowInvalidSave` for the same
   * reason the rule writer is — an invalid rule set cannot execute, so this is
   * a deliberate "keep my broken draft", not a default.
   */
  allowInvalidSave?: boolean;
}

/**
 * Creates a new immutable RuleSetVersion for the given RuleSet ID, automatically
 * assigning the next version number and updating the parent RuleSet's currentVersion.
 *
 * IMPORTANT: hasRule and hasDataBlock must contain Version IDs (RuleVersion/DataBlockVersion),
 * not parent entity IDs (Rule/DataBlock). This ensures immutable execution.
 */
export async function createRuleSetVersion(ruleSetId: string, body: CreateRuleSetVersionInput): Promise<LdkitRuleSetVersion> {
  const cacheCoordinator = getCacheCoordinator();
  // Validate that provided IDs are version entities
  const ruleIds = Array.isArray(body.hasRule) ? body.hasRule : [];
  const dataBlockIds = Array.isArray(body.hasDataBlock) ? body.hasDataBlock : [];

  const ruleVersions: LdkitRuleVersion[] = [];
  const dataBlockVersions: LdkitDataBlockVersion[] = [];
  for (const id of ruleIds) {
    const entity = cacheCoordinator.get(id) as AnyRecord | null;
    if (!entity) {
      throw new Error(`RuleVersion ${id} not found in cache`);
    }
    if ((entity['@type'] as string) !== 'RuleVersion') {
      throw new Error(`Invalid entity type for ${id}: expected RuleVersion, got ${entity['@type']}. RuleSets must reference RuleVersions, not Rules.`);
    }
    ruleVersions.push(entity as LdkitRuleVersion);
  }
  const flags = getFeatureFlags();
  const allowInvalid = flags.rulesAllowInvalidSave && body.allowInvalidSave === true;

  const invalidRuleVersions = ruleVersions.filter(rv => rv.grammarValid === false);
  if (invalidRuleVersions.length > 0 && !allowInvalid) {
    const ids = invalidRuleVersions.map(rv => rv.$id).join(', ');
    throw new Error(`Cannot add invalid RuleVersions to RuleSet: ${ids}`);
  }

  for (const id of dataBlockIds) {
    const entity = cacheCoordinator.get(id) as AnyRecord | null;
    if (!entity) {
      throw new Error(`DataBlockVersion ${id} not found in cache`);
    }
    if ((entity['@type'] as string) !== 'DataBlockVersion') {
      throw new Error(`Invalid entity type for ${id}: expected DataBlockVersion, got ${entity['@type']}. RuleSets must reference DataBlockVersions, not DataBlocks.`);
    }
    dataBlockVersions.push(entity as LdkitDataBlockVersion);
  }
  const invalidDataBlockVersions = dataBlockVersions.filter(db => db.grammarValid === false);
  if (invalidDataBlockVersions.length > 0 && !allowInvalid) {
    const ids = invalidDataBlockVersions.map(db => db.$id).join(', ');
    throw new Error(`Cannot add invalid DataBlockVersions to RuleSet: ${ids}`);
  }
  const existing = (cacheCoordinator.list('RuleSetVersion') as LdkitRuleSetVersion[])
    .filter(v => v.isPartOf === ruleSetId);
  const nextVersion = existing.length > 0
    ? (existing.sort((a, b) => Number(a.version) - Number(b.version))[existing.length - 1].version as number) + 1
    : 1;

  const versionId = mintId('ruleSetVersion');

  const payload: AnyRecord = {
    $id: versionId,
    '@type': 'RuleSetVersion',
    isPartOf: ruleSetId,
    version: nextVersion,
    // Frozen on create (issue #192). A version is a snapshot: what it holds is
    // what the reference to it means, so it is never created in a state where
    // it could still change. `immutable` on the request body is ignored rather
    // than honoured — there is no such thing as a mutable version.
    immutable: true,
    comment: body.comment ?? undefined,
    hasRule: body.hasRule ?? [],
    hasDataBlock: body.hasDataBlock ?? [],
  };

  /*
   * The deployment gate, refused here as well as at the routes: a version is
   * the thing that would outlive the request, so a build without the extension
   * must not be able to store one that claims it. See ./ruleTuples.ts.
   */
  const tupleRefusal = ruleTuplesRefusal(body.tuplesEnabled === true || hasSeedText(body.tupleSeeds));
  if (tupleRefusal) {
    throw new Error(tupleRefusal);
  }

  // Only written when set, so a ruleset that never touches the extension keeps
  // the properties absent rather than storing a default nobody chose.
  if (body.tupleSeeds != null && body.tupleSeeds.trim()) payload.tupleSeeds = body.tupleSeeds.trim();
  if (body.tuplesEnabled != null) payload.tuplesEnabled = body.tuplesEnabled;

  // No stratification for a version that holds a rule the grammar rejected:
  // stratifying needs an AST, and a partial report over the rules that did
  // parse would describe a rule set nobody wrote. Absent says "unknown", which
  // is the truth; the invalid rule itself is what the editor shows in red.
  if (ruleVersions.length > 0 && ruleVersions.every(rv => rv.grammarValid !== false)) {
    const stratifier = new RuleStratifier();
    const report = stratifier.analyzeRuleVersions(ruleVersions);
    payload.stratificationReport = JSON.stringify(report);
  }

  const created = await cacheCoordinator.create('RuleSetVersion', toLdkit(payload));

  await cacheCoordinator.update('RuleSet', ruleSetId, { currentVersion: versionId });

  return created;
}
