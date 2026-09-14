/**
 * Checking a write's `tags` against the model's one tag invariant.
 *
 * **A tag may only be applied inside the library it belongs to.** That is the
 * whole rule, and it is what stops a tag from becoming a back door across the
 * authz boundary the library draws: without it, tagging an entity with a tag
 * from another library would expose that library's vocabulary to anyone who can
 * read this one.
 *
 * Unlike `entityReferences.analyseReferences`, this returns a phrased error
 * rather than raw findings. The reason that module returns findings is that its
 * callers word the same failure differently ("must be part of exactly one
 * library" vs "must belong to..."); here every caller says the same thing about
 * the same rule, so a second copy of the wording in seven route files would be
 * the thing worth avoiding, not the thing worth preserving.
 */

import { analyseReferences, describeWrongType, type EntityLookup } from './entityReferences.js';
import type { EntityType } from './EntityRegistry.js';
import { resolveOwningLibrary } from '../auth/enforce.js';

/**
 * The entity types that carry `tags`.
 *
 * Named once because two things consume it: the write checks below, and the
 * unlabelling sweep `DELETE /tags/:id` performs. A type added to the list
 * without a `tags` property on its schema fails in `analyseReferences`, which
 * requires the `@references` declaration to exist.
 *
 * `EtlJob` and `BenchmarkExperiment` are deliberately absent: the first has an
 * `isPartOf` with no `@references` declaration, the second no containment link
 * at all, so there is no library to judge the invariant against. (`ArgumentSet`
 * was in that list until it gained `isPartOf`.)
 */
export const TAGGABLE_TYPES = [
  'Query',
  'QueryGroup',
  'Rule',
  'RuleSet',
  'DataBlock',
  'DataGraph',
  'Test',
  'ArgumentSet',
  'TupleSet',
] as const satisfies readonly EntityType[];

export type TaggableType = (typeof TAGGABLE_TYPES)[number];

/**
 * `tags` is `undefined` when the body did not mention them, which a caller must
 * keep distinct from `[]`: on an update the first means "leave them alone" and
 * the second means "clear them". Hence the spread at every call site rather
 * than an unconditional assignment.
 */
export type TagAnalysis =
  | { ok: true; tags: string[] | undefined }
  | { ok: false; error: string };

/** `null`/absent means "not supplied", which is not the same as `[]` ("clear them"). */
export function normalizeTags(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const iri = String(value);
    if (!iri || seen.has(iri)) continue;
    seen.add(iri);
    tags.push(iri);
  }
  return tags;
}

/**
 * Resolve and check the tags a create/update body carries.
 *
 * `isPartOf` is the entity's containment as the write leaves it — the caller
 * passes the incoming value when the write changes it, so moving an entity and
 * retagging it in one request is judged against the destination library rather
 * than the one it is leaving.
 */
export function analyseTags(
  type: EntityType,
  rawTags: unknown,
  isPartOf: readonly string[] | string | null | undefined,
  lookup: EntityLookup,
): TagAnalysis {
  const tags = normalizeTags(rawTags);
  if (tags === undefined || tags.length === 0) return { ok: true, tags };

  const findings = analyseReferences(type, 'tags', tags, lookup);
  if (findings.missing.length > 0) {
    return { ok: false, error: `Referenced tag ${findings.missing[0]} does not exist` };
  }
  if (findings.wrongType.length > 0) {
    return { ok: false, error: describeWrongType(findings.wrongType[0]) };
  }

  const library = resolveOwningLibrary({ '@type': undefined, isPartOf });
  if (!library) {
    return { ok: false, error: 'Cannot apply tags to an entity that belongs to no library' };
  }

  for (const tag of tags) {
    const entity = lookup(tag) as { isPartOf?: unknown } | null | undefined;
    const tagLibrary = typeof entity?.isPartOf === 'string' ? entity.isPartOf : null;
    if (tagLibrary !== library) {
      return {
        ok: false,
        error: `Tag ${tag} belongs to a different library than the entity being tagged`,
      };
    }
  }

  return { ok: true, tags };
}

/**
 * The tags a new entity should start with, copied from the thing it is about.
 *
 * A test is created *from* a query, a query group or a rule set, and the tags
 * on that subject are almost always the ones the test wants: tag a rule set
 * `w3c` and every test written against it should answer to `POST /tests/run`
 * with `w3c` without anyone retagging it by hand. This is what makes a tag a
 * suite rather than a label you have to maintain in two places.
 *
 * It is a **copy, not a link**. Tags are an array on each entity, so there is
 * nothing to follow: retagging the subject later leaves existing tests alone,
 * and a test may be retagged freely afterwards without fighting its subject.
 * Seeding is a starting value, and the create body can always override it.
 *
 * Tags outside the new entity's library are dropped rather than refused. The
 * subject may live in another library than the one the entity is being created
 * in — the "make a test from this" buttons fall back to the active library
 * when the subject names none — and §4.5's invariant would then reject the
 * whole write. A convenience that can 400 on tags nobody asked for is worse
 * than one that quietly copies only what it may.
 */
export function inheritableTags(
  source: unknown,
  isPartOf: readonly string[] | string | null | undefined,
  lookup: EntityLookup,
): string[] {
  const carried = normalizeTags((source as { tags?: unknown } | null | undefined)?.tags);
  if (!carried || carried.length === 0) return [];

  const library = resolveOwningLibrary({ '@type': undefined, isPartOf });
  if (!library) return [];

  return carried.filter(tag => {
    const entity = lookup(tag) as { '@type'?: string; isPartOf?: unknown } | null | undefined;
    if (!entity || entity['@type'] !== 'Tag') return false;
    return typeof entity.isPartOf === 'string' && entity.isPartOf === library;
  });
}
