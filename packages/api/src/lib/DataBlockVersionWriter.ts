import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { nextVersionNumber } from './versionNumbering.js';
import type { LdkitDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { RuleGrammarValidator } from './RuleGrammarValidator.js';
import { getFeatureFlags } from '../config/featureFlags.js';

type AnyRecord = Record<string, any>;

export interface CreateDataBlockVersionInput {
  dataString: string;
  comment?: string | null;
  defaultBackend?: string | null;
  immutable?: boolean;
  allowInvalidSave?: boolean;
}

export interface AnnotateDataBlockVersionInput {
  comment?: string | null;
  immutable?: boolean;
}

/**
 * Creates a new immutable DataBlockVersion for the given DataBlock ID, automatically
 * assigning the next version number and updating the parent DataBlock's currentVersion.
 */
export async function createDataBlockVersion(dataBlockId: string, body: CreateDataBlockVersionInput): Promise<LdkitDataBlockVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const nextVersion = nextVersionNumber('DataBlockVersion', dataBlockId);

  const versionId = mintId('dataBlockVersion');
  const dataString = body.dataString ?? '';
  if (!dataString.trim()) {
    throw new Error('DataBlockVersion requires a non-empty dataString');
  }

  // Validate with all grammars
  const validator = new RuleGrammarValidator();
  const validationResult = validator.validateWithAllGrammars(dataString);
  const flags = getFeatureFlags();
  const allowInvalid = flags.rulesAllowInvalidSave && body.allowInvalidSave === true;

  if (!validationResult.valid && !allowInvalid) {
    throw new Error(`Invalid data block syntax: ${validationResult.error}`);
  }

  const grammarValid = validationResult.valid;
  const normalizedInsertData = validationResult.valid ? validationResult.normalized : undefined;

  const payload: AnyRecord = {
    $id: versionId,
    '@type': 'DataBlockVersion',
    isPartOf: dataBlockId,
    version: nextVersion,
    // Frozen on create (issue #192). A version is a snapshot: what it holds is
    // what the reference to it means, so it is never created in a state where
    // it could still change. `immutable` on the request body is ignored rather
    // than honoured — there is no such thing as a mutable version.
    immutable: true,
    dataString,
    normalizedInsertData,
    grammarType: validationResult.valid ? validationResult.primaryGrammar : null,
    grammarValid,
    validationError: validationResult.valid ? undefined : validationResult.error ?? 'Invalid data block syntax',
    grammarValidations: JSON.stringify(validationResult.validations),
    comment: body.comment ?? undefined,
    defaultBackend: body.defaultBackend ?? undefined,
  };

  const created = await cacheCoordinator.create('DataBlockVersion', toLdkit(payload));

  const updated = await cacheCoordinator.update('DataBlock', dataBlockId, { currentVersion: versionId });
  if (!updated) {
    throw new Error(`Failed to set currentVersion on DataBlock ${dataBlockId}`);
  }

  return created;
}

/**
 * Annotate an existing DataBlockVersion.
 *
 * A version is a snapshot (issue #192): its content is what was saved, and
 * every compatibility check that named the version stays true. What is left is
 * the annotation — the comment *about* the snapshot — plus the freeze
 * transition for versions stored before creation started freezing them.
 */
export async function annotateDataBlockVersion(
  versionId: string,
  body: AnnotateDataBlockVersionInput,
): Promise<LdkitDataBlockVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const current = cacheCoordinator.get(versionId) as LdkitDataBlockVersion | null;
  if (!current || current['@type'] !== 'DataBlockVersion') {
    throw new Error(`DataBlockVersion ${versionId} not found`);
  }

  const updates: AnyRecord = {};
  if (body.comment !== undefined) updates.comment = body.comment;
  // Only false → true. Unfreezing would undo the guarantee every reference to
  // the version relies on, and the route rejects it before we get here.
  if (body.immutable === true) updates.immutable = true;

  if (Object.keys(updates).length === 0) return current;

  const updated = await cacheCoordinator.update('DataBlockVersion', versionId, updates);
  if (!updated) {
    throw new Error(`Failed to update DataBlockVersion ${versionId}`);
  }

  return updated;
}
