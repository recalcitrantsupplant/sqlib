/**
 * What number the next version of an entity gets.
 *
 * Four writers computed this independently — rules, data blocks, data graphs
 * and tests — and two of them did it by sorting the whole list and taking the
 * last element, which both mutates the array it was handed and costs a sort to
 * find a maximum. One definition, and the writers say what they mean.
 *
 * Deliberately *not* extended to "create the version and point the parent at
 * it". That second half looks equally shared and is not: three writers treat a
 * failed `currentVersion` update as fatal and `RuleVersionWriter` ignores it,
 * and folding them together would change one of those without saying so. The
 * inconsistency is real and worth resolving; it is a behaviour decision, not a
 * refactor, so it stays visible at the four call sites until someone makes it.
 */

import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import type { EntityTypeName } from '../persistence/entityTypeNames.js';

interface VersionLike {
  isPartOf?: string;
  version?: number;
}

/**
 * The next version number for `parentId`, starting at 1.
 *
 * Numbers are read from what is stored rather than counted, so deleting v2 of
 * three versions still yields 4 rather than reissuing 3 — a reused version
 * number would make an id that used to mean one thing quietly mean another.
 */
export function nextVersionNumber(versionType: EntityTypeName, parentId: string): number {
  const existing = (getCacheCoordinator().list(versionType) as VersionLike[])
    .filter(version => version.isPartOf === parentId);

  if (existing.length === 0) return 1;

  return existing.reduce((highest, version) => Math.max(highest, Number(version.version) || 0), 0) + 1;
}
