import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { nextVersionNumber } from './versionNumbering.js';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { RuleGrammarValidator } from './RuleGrammarValidator.js';
import { getFeatureFlags } from '../config/featureFlags.js';

type AnyRecord = Record<string, any>;

export interface CreateRuleVersionInput {
  ruleString: string;
  comment?: string | null;
  defaultBackend?: string | null;
  immutable?: boolean;
  allowInvalidSave?: boolean;
}

export interface AnnotateRuleVersionInput {
  comment?: string | null;
  immutable?: boolean;
}

/**
 * Creates a new immutable RuleVersion for the given Rule ID, automatically
 * assigning the next version number and updating the parent Rule's currentVersion.
 */
export async function createRuleVersion(ruleId: string, body: CreateRuleVersionInput): Promise<LdkitRuleVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const nextVersion = nextVersionNumber('RuleVersion', ruleId);

  const versionId = mintId('ruleVersion');
  const ruleString = body.ruleString ?? '';
  if (!ruleString.trim()) {
    throw new Error('RuleVersion requires a non-empty ruleString');
  }

  // Validate with all grammars
  const validator = new RuleGrammarValidator();
  const validationResult = validator.validateWithAllGrammars(ruleString);
  const flags = getFeatureFlags();
  const allowInvalid = flags.rulesAllowInvalidSave && body.allowInvalidSave === true;

  if (!validationResult.valid && !allowInvalid) {
    throw new Error(`Invalid rule syntax: ${validationResult.error}`);
  }

  const grammarValid = validationResult.valid;
  const normalizedInsert = validationResult.valid ? validationResult.normalized : undefined;

  const payload: AnyRecord = {
    $id: versionId,
    '@type': 'RuleVersion',
    isPartOf: ruleId,
    version: nextVersion,
    // Frozen on create (issue #192). A version is a snapshot: what it holds is
    // what the reference to it means, so it is never created in a state where
    // it could still change. `immutable` on the request body is ignored rather
    // than honoured — there is no such thing as a mutable version.
    immutable: true,
    ruleString,
    normalizedInsert,
    grammarType: validationResult.valid ? validationResult.primaryGrammar : null,
    grammarValid,
    validationError: validationResult.valid ? undefined : validationResult.error ?? 'Invalid rule syntax',
    grammarValidations: JSON.stringify(validationResult.validations),
    comment: body.comment ?? undefined,
    defaultBackend: body.defaultBackend ?? undefined,
  };

  const created = await cacheCoordinator.create('RuleVersion', toLdkit(payload));

  await cacheCoordinator.update('Rule', ruleId, { currentVersion: versionId });

  return created;
}

/**
 * Annotate an existing RuleVersion.
 *
 * A version is a snapshot (issue #192): its content is what was saved, and
 * every compatibility check that named the version stays true. What is left is
 * the annotation — the comment *about* the snapshot — plus the freeze
 * transition for versions stored before creation started freezing them.
 */
export async function annotateRuleVersion(
  versionId: string,
  body: AnnotateRuleVersionInput,
): Promise<LdkitRuleVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const current = cacheCoordinator.get(versionId) as LdkitRuleVersion | null;
  if (!current || current['@type'] !== 'RuleVersion') {
    throw new Error(`RuleVersion ${versionId} not found`);
  }

  const updates: AnyRecord = {};
  if (body.comment !== undefined) updates.comment = body.comment;
  // Only false → true. Unfreezing would undo the guarantee every reference to
  // the version relies on, and the route rejects it before we get here.
  if (body.immutable === true) updates.immutable = true;

  if (Object.keys(updates).length === 0) return current;

  const updated = await cacheCoordinator.update('RuleVersion', versionId, updates);
  if (!updated) {
    throw new Error(`Failed to update RuleVersion ${versionId}`);
  }

  return updated;
}
