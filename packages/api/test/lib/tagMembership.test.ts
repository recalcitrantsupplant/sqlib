/**
 * The tag invariant, tested where it lives rather than once per route.
 *
 * Seven route files call `analyseTags`, and what they each need to get right is
 * the plumbing — passing the *incoming* containment, spreading `tags` only when
 * it was supplied. The rule itself is one function, so it is checked once here
 * and the route tests cover the plumbing.
 */

import { describe, it, expect, vi } from 'vitest';

const coordinatorGet = vi.fn();

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: coordinatorGet }),
  getEntityRepositories: () => ({}),
}));

const { analyseTags, normalizeTags, TAGGABLE_TYPES } = await import('../../src/lib/tagMembership.js');

const LIB_A = 'urn:sqlib:library:a';
const LIB_B = 'urn:sqlib:library:b';
const TAG_A = 'urn:sqlib:tag:in-a';
const TAG_B = 'urn:sqlib:tag:in-b';
const GROUP = 'urn:sqlib:group:g1';

const WORLD: Record<string, Record<string, unknown>> = {
  [LIB_A]: { $id: LIB_A, '@type': 'Library' },
  [LIB_B]: { $id: LIB_B, '@type': 'Library' },
  [TAG_A]: { $id: TAG_A, '@type': 'Tag', name: 'geo', isPartOf: LIB_A },
  [TAG_B]: { $id: TAG_B, '@type': 'Tag', name: 'geo', isPartOf: LIB_B },
  [GROUP]: { $id: GROUP, '@type': 'QueryGroup', isPartOf: LIB_A },
};

const lookup = (iri: string) => WORLD[iri] ?? null;

// `resolveOwningLibrary` reaches the cache directly to follow a query-group hop.
coordinatorGet.mockImplementation(lookup);

describe('normalizeTags', () => {
  it('distinguishes absent from empty', () => {
    expect(normalizeTags(undefined)).toBeUndefined();
    expect(normalizeTags(null)).toBeUndefined();
    expect(normalizeTags([])).toEqual([]);
  });

  it('accepts a bare string and dedupes, preserving order', () => {
    expect(normalizeTags(TAG_A)).toEqual([TAG_A]);
    expect(normalizeTags([TAG_B, TAG_A, TAG_B])).toEqual([TAG_B, TAG_A]);
  });
});

describe('analyseTags', () => {
  it('passes a tag from the entity\'s own library', () => {
    const result = analyseTags('Query', [TAG_A], [LIB_A], lookup);
    expect(result).toEqual({ ok: true, tags: [TAG_A] });
  });

  it('rejects a tag belonging to another library', () => {
    const result = analyseTags('Query', [TAG_B], [LIB_A], lookup);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('different library');
  });

  it('rejects a tag that does not exist', () => {
    const result = analyseTags('Query', ['urn:sqlib:tag:ghost'], [LIB_A], lookup);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('does not exist');
  });

  it('rejects an IRI that resolves to something other than a tag', () => {
    const result = analyseTags('Query', [LIB_A], [LIB_A], lookup);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('expected Tag');
  });

  it('leaves tags alone when the body did not mention them', () => {
    expect(analyseTags('Query', undefined, [LIB_A], lookup)).toEqual({ ok: true, tags: undefined });
  });

  it('treats an empty array as a clear, not as absent', () => {
    expect(analyseTags('Query', [], [LIB_A], lookup)).toEqual({ ok: true, tags: [] });
  });

  it('resolves the library through a query-group parent', () => {
    // A query whose only listed parent is a group still lives in the group's
    // library, so a tag from that library applies.
    const result = analyseTags('Query', [TAG_A], [GROUP], lookup);
    expect(result).toEqual({ ok: true, tags: [TAG_A] });
  });

  it('handles a scalar isPartOf, as QueryGroup declares it', () => {
    expect(analyseTags('QueryGroup', [TAG_A], LIB_A, lookup)).toEqual({ ok: true, tags: [TAG_A] });
  });

  it('refuses to tag an entity that resolves to no library', () => {
    const result = analyseTags('Query', [TAG_A], [], lookup);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('belongs to no library');
  });

  it('names every taggable type, and only types that declare a tags reference', () => {
    // A type listed here without a `tags` property on its schema throws in
    // `analyseReferences`, so this doubles as the check that the list and the
    // schemas agree.
    for (const type of TAGGABLE_TYPES) {
      expect(() => analyseTags(type, [TAG_A], [LIB_A], lookup)).not.toThrow();
    }
    expect(TAGGABLE_TYPES).toContain('Query');
    // ArgumentSet joined once it gained `isPartOf` (2026-08-18-tuple-sets §7.1).
    // These two are still out: EtlJob's `isPartOf` declares no `@references`
    // and BenchmarkExperiment has none at all, so neither offers a library to
    // check the invariant against.
    expect(TAGGABLE_TYPES).not.toContain('EtlJob');
    expect(TAGGABLE_TYPES).not.toContain('BenchmarkExperiment');
  });
});
