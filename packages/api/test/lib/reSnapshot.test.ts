/**
 * The unchanged-re-snapshot rule (issue #211's version churn, and #153's sink
 * by the same rule).
 *
 * The two sinks that use it are covered end to end in
 * `routes/tuple-sets.from-etl.test.ts` and `routes/data-graphs.from-query.test.ts`.
 * What is pinned here is the rule's own edges: which spellings of "absent"
 * count as equal, and every way a comparison must fail closed.
 */

import { describe, it, expect, vi } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const { entities } = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => entities.get(id) ?? null }),
});

const { currentVersionOfParent, isUnchangedReSnapshot } = await import('../../src/lib/reSnapshot.js');

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

const SET_ID = 'urn:sqlib:tuple-set:s1';
const VERSION_ID = 'urn:sqlib:tuple-set-version:v1';

function version(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $id: VERSION_ID,
    '@type': 'TupleSetVersion',
    isPartOf: SET_ID,
    version: 1,
    sourceResultHash: HASH,
    sourceEtlJobVersion: 'urn:sqlib:etl-job-version:v1',
    sourceColumnMappingVersion: 'urn:sqlib:etl-column-mapping-version:m1',
    ...overrides,
  };
}

const SOURCE = {
  sourceEtlJobVersion: 'urn:sqlib:etl-job-version:v1',
  sourceColumnMappingVersion: 'urn:sqlib:etl-column-mapping-version:m1',
};

describe('isUnchangedReSnapshot', () => {
  it('matches when the hash and every source field agree', () => {
    expect(isUnchangedReSnapshot(version(), HASH, SOURCE)).toBe(true);
  });

  it('does not match a different hash — the content changed', () => {
    expect(isUnchangedReSnapshot(version(), OTHER_HASH, SOURCE)).toBe(false);
  });

  it('does not match identical content from a different source', () => {
    // The same bytes making a different claim. A pin that named the older
    // version would attribute the rows to a job that did not produce them.
    expect(
      isUnchangedReSnapshot(version(), HASH, {
        ...SOURCE,
        sourceEtlJobVersion: 'urn:sqlib:etl-job-version:v2',
      }),
    ).toBe(false);
  });

  it('never matches a version with no recorded hash, even against no hash', () => {
    // Absence must not read as agreement: "I cannot tell" cuts a version.
    expect(isUnchangedReSnapshot(version({ sourceResultHash: undefined }), HASH, SOURCE)).toBe(false);
    expect(isUnchangedReSnapshot(version({ sourceResultHash: null }), HASH, SOURCE)).toBe(false);
    expect(isUnchangedReSnapshot(version({ sourceResultHash: '' }), '', SOURCE)).toBe(false);
  });

  it('never matches when there is no current version at all', () => {
    expect(isUnchangedReSnapshot(null, HASH, SOURCE)).toBe(false);
  });

  it('treats null, undefined and empty string as one "absent" on both sides', () => {
    // What lets an optional source — `sourceArgumentSetVersion` — compare equal
    // whether the writer stored it as absent or the caller passed it as null.
    const optional = { sourceArgumentSetVersion: null };
    for (const stored of [undefined, null, '']) {
      expect(
        isUnchangedReSnapshot(version({ sourceArgumentSetVersion: stored }), HASH, {
          ...SOURCE,
          ...optional,
        }),
      ).toBe(true);
    }

    expect(
      isUnchangedReSnapshot(version({ sourceArgumentSetVersion: 'urn:sqlib:argument-set-version:a1' }), HASH, {
        ...SOURCE,
        ...optional,
      }),
    ).toBe(false);
  });
});

describe('currentVersionOfParent', () => {
  it('returns the current version when the pointer resolves to one of this parent', () => {
    entities.clear();
    entities.set(SET_ID, { $id: SET_ID, '@type': 'TupleSet', currentVersion: VERSION_ID });
    entities.set(VERSION_ID, version());

    expect(currentVersionOfParent(SET_ID, 'TupleSetVersion')).toMatchObject({ $id: VERSION_ID });
  });

  it('returns null for a parent with no current version — the first snapshot has nothing to compare', () => {
    entities.clear();
    entities.set(SET_ID, { $id: SET_ID, '@type': 'TupleSet' });

    expect(currentVersionOfParent(SET_ID, 'TupleSetVersion')).toBeNull();
  });

  it('returns null when the pointer does not resolve', () => {
    entities.clear();
    entities.set(SET_ID, { $id: SET_ID, '@type': 'TupleSet', currentVersion: VERSION_ID });

    expect(currentVersionOfParent(SET_ID, 'TupleSetVersion')).toBeNull();
  });

  it('returns null when the pointer resolves to the wrong type or another parent', () => {
    // A corrupt pointer reads as "no comparable version", which cuts one —
    // never as a match against something that is not this parent's snapshot.
    entities.clear();
    entities.set(SET_ID, { $id: SET_ID, '@type': 'TupleSet', currentVersion: VERSION_ID });

    entities.set(VERSION_ID, version({ '@type': 'DataGraphVersion' }));
    expect(currentVersionOfParent(SET_ID, 'TupleSetVersion')).toBeNull();

    entities.set(VERSION_ID, version({ isPartOf: 'urn:sqlib:tuple-set:other' }));
    expect(currentVersionOfParent(SET_ID, 'TupleSetVersion')).toBeNull();
  });

  it('returns null when the parent itself is missing', () => {
    entities.clear();
    expect(currentVersionOfParent(SET_ID, 'TupleSetVersion')).toBeNull();
  });
});
