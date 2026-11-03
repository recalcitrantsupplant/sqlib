/**
 * Who created an entity and who last changed it.
 *
 * Every entity schema that carries `dateCreated` and `dateModified` spreads
 * these two properties next to them. `CacheCoordinator.create` and `update`
 * stamp them from the signed-in caller (`auth/writeActor.ts`), the same place
 * that stamps the timestamps, so no route has to remember to.
 *
 * - `createdBy` is set once, on create, and never changes.
 * - `modifiedBy` is set on create and on every update, so it always names the
 *   author of the write that `dateModified` dates. A write inside a request
 *   that identifies nobody (`disabled` or `anonymous` mode, a system token)
 *   clears it rather than leave an earlier editor's name on a later change.
 *
 * Both are principal IRIs (`urn:sqlib:principal:user:…`), read-only to
 * clients: the generated create and update bodies leave them out, and the
 * coordinator overwrites whatever a request carries. Entities saved before
 * this existed, or while auth was disabled, have neither.
 */
import { dct, sqlib } from './namespaces.js';

export const AUTHORSHIP_PROPERTIES = {
  createdBy: {
    '@id': dct.creator,
    '@type': sqlib.IRI,
    '@optional': true,
    '@readOnly': true,
  },
  modifiedBy: {
    '@id': sqlib.modifiedBy,
    '@type': sqlib.IRI,
    '@optional': true,
    '@readOnly': true,
  },
} as const;

/** The authorship fields, as they appear on a persisted entity. */
export interface Authorship {
  createdBy?: string | null;
  modifiedBy?: string | null;
}
