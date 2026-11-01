/**
 * Writes notebook versions: the document, checked and frozen.
 *
 * The server stores the document and does not run it. It checks only what it
 * needs to serve the document back to the web app: that it is JSON, that it
 * says it is a `sqlib-notebook/1` document, and that it is under the size cap.
 * What the cells mean is the web app's business (`lib/notebookFormat.ts`
 * there), as it is when the same document is imported from a file.
 */
import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { allocateVersion, setCurrentVersion } from './versionNumbering.js';
import { toPersisted } from '../persistence/utils/id-adapter.js';
import { ValidationError } from './validationError.js';
import type { PersistedNotebookVersion } from '../persistence/schemas/NotebookVersionSchema.js';

export const NOTEBOOK_FORMAT = 'sqlib-notebook/1';

/** One version's cap. A notebook is prose and references, not data. */
export const MAX_NOTEBOOK_VERSION_BYTES = Number.parseInt(
  process.env.NOTEBOOK_MAX_VERSION_BYTES ?? '1048576',
  10,
);

export interface CreateNotebookVersionInput {
  contentString: string;
  comment?: string | null;
}

/**
 * The document as it is stored: parsed, checked and written back compact.
 *
 * Throws a `ValidationError`, which the routes answer with 400.
 */
export function normaliseNotebookContent(contentString: string): { contentString: string; byteSize: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contentString);
  } catch (cause) {
    throw new ValidationError(`contentString is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('contentString must be a JSON object');
  }
  const document = parsed as Record<string, unknown>;
  if (document.format !== NOTEBOOK_FORMAT) {
    throw new ValidationError(`contentString must be a ${NOTEBOOK_FORMAT} document (its "format" is ${JSON.stringify(document.format ?? null)})`);
  }
  if (!Array.isArray(document.cells)) {
    throw new ValidationError('contentString must carry a "cells" array');
  }
  const compact = JSON.stringify(document);
  const byteSize = Buffer.byteLength(compact, 'utf8');
  if (byteSize > MAX_NOTEBOOK_VERSION_BYTES) {
    throw new ValidationError(`The notebook is ${byteSize} bytes; a version may be at most ${MAX_NOTEBOOK_VERSION_BYTES}.`);
  }
  return { contentString: compact, byteSize };
}

/** Create the next version and point the notebook at it, under the parent's version lock. */
export async function createNotebookVersion(
  notebookId: string,
  body: CreateNotebookVersionInput,
): Promise<PersistedNotebookVersion> {
  const content = normaliseNotebookContent(body.contentString);
  return allocateVersion('NotebookVersion', notebookId, async (nextVersion) => {
    const versionId = mintId('notebookVersion');
    const created = await getCacheCoordinator().create('NotebookVersion', toPersisted({
      $id: versionId,
      '@type': 'NotebookVersion',
      isPartOf: notebookId,
      version: nextVersion,
      immutable: true,
      contentString: content.contentString,
      byteSize: content.byteSize,
      comment: body.comment ?? undefined,
    }));
    await setCurrentVersion('Notebook', notebookId, versionId);
    return created as PersistedNotebookVersion;
  });
}

/** Set a version's comment, the one thing about a saved version that may change. */
export async function annotateNotebookVersion(
  versionId: string,
  body: { comment?: string | null },
): Promise<PersistedNotebookVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const current = cacheCoordinator.get(versionId) as PersistedNotebookVersion | null;
  if (!current || current['@type'] !== 'NotebookVersion') {
    throw new Error(`NotebookVersion ${versionId} not found`);
  }
  if (body.comment === undefined) return current;
  const updated = await cacheCoordinator.update('NotebookVersion', versionId, { comment: body.comment });
  if (!updated) throw new Error(`Failed to update NotebookVersion ${versionId}`);
  return updated as PersistedNotebookVersion;
}
