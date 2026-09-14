/**
 * Saving, and what the rest of the app is told about it.
 *
 * A version becoming the one on screen happens two ways — the user picks it,
 * or a save mints it — and both have to tell the route. Written apart, they
 * drifted: the save path set the local refs and told nobody, so the editor
 * showed vN+1 while the URL still said vN and a reload went back.
 */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';

import { useQueryVersions } from '@/composables/useQueryVersions';
import { savedWith, routeVersionFor } from '@/lib/entityLifecycle';
import type { QueryTypeValue } from '@sparql-query-lib/types';

function setup() {
  const emitted: Array<number | null> = [];
  const apiClient = {
    listQueryVersions: vi.fn(async () => [
      { id: 'urn:sqlib:queryVersion:1', version: 1, dateModified: '2026-08-01T00:00:00.000Z' },
    ]),
    getQueryVersion: vi.fn(async (_queryId: string, versionNumber: number) => ({
      data: {
        queryVersion: {
          id: `urn:sqlib:queryVersion:${versionNumber}`,
          version: versionNumber,
          queryString: `SELECT ${versionNumber}`,
          comment: null,
        },
      },
      etag: `"etag-${versionNumber}"`,
    })),
  };

  const versions = useQueryVersions({
    apiClient,
    toast: { success: vi.fn(), error: vi.fn() },
    queryId: ref('urn:sqlib:query:1'),
    queryCode: ref(''),
    versionComment: ref(''),
    queryType: ref<QueryTypeValue | null>(null),
    queryConcurrency: ref<string | null>(null),
    emitVersionNumber: (version) => emitted.push(version),
  });

  return { versions, emitted, apiClient };
}

describe('useQueryVersions', () => {
  it('§7.1 — a saved version becomes the shown version, and the route is told', async () => {
    const { versions, emitted } = setup();

    await versions.loadVersionsForQuery('urn:sqlib:query:1', 'urn:sqlib:queryVersion:1');
    emitted.length = 0;

    versions.adoptNewVersion({
      id: 'urn:sqlib:queryVersion:2',
      version: 2,
      dateModified: '2026-08-20T00:00:00.000Z',
    });

    expect(versions.currentVersion.value).toBe('urn:sqlib:queryVersion:2');
    expect(versions.selectedVersion.value).toBe('urn:sqlib:queryVersion:2');
    expect(versions.selectedVersionNumber.value).toBe(2);
    expect(versions.currentVersionNumberForDisplay.value).toBe(2);

    // The route is told exactly once, and told `null`: the shown version is now
    // the current one, so a `?version=` that pointed at the old one is cleared
    // rather than left to send a reload back to v1.
    expect(emitted).toEqual([null]);
  });

  it('the new version joins the options list once, newest first', () => {
    const { versions } = setup();

    versions.adoptNewVersion({ id: 'urn:sqlib:queryVersion:1', version: 1, dateModified: null });
    versions.adoptNewVersion({ id: 'urn:sqlib:queryVersion:2', version: 2, dateModified: null });
    // A refresh that re-reports the same version must not duplicate the row.
    versions.adoptNewVersion({ id: 'urn:sqlib:queryVersion:2', version: 2, dateModified: null });

    expect(versions.versionOptions.value.map((option) => option.label)).toEqual(['2', '1']);
  });

  it('viewing an older version tells the route its number, not null', async () => {
    const { versions, emitted } = setup();

    await versions.loadVersionsForQuery('urn:sqlib:query:1', 'urn:sqlib:queryVersion:2');
    versions.adoptNewVersion({ id: 'urn:sqlib:queryVersion:2', version: 2, dateModified: null });
    emitted.length = 0;

    // Selecting a version that is not the current one is the other half of the
    // convention, and the reason `adoptNewVersion` emits null rather than 2.
    versions.selectedVersion.value = 'urn:sqlib:queryVersion:1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(emitted).toEqual([1]);
  });

  /**
   * The bridge that stops the model becoming decorative.
   *
   * `entityLifecycle.ts` states the route convention once; this checks the
   * composable that actually emits agrees with it, in both directions. Without
   * this the specification and the implementation could drift apart in exactly
   * the way the two emit sites drifted before it existed.
   */
  it('agrees with the lifecycle model about what the route should carry', async () => {
    const { versions, emitted } = setup();

    await versions.loadVersionsForQuery('urn:sqlib:query:1', 'urn:sqlib:queryVersion:2');
    versions.adoptNewVersion({ id: 'urn:sqlib:queryVersion:2', version: 2, dateModified: null });

    // Showing the current version: the model says no route version, and the
    // composable emitted exactly that when it adopted v2.
    expect(routeVersionFor(savedWith(['SELECT 1', 'SELECT 2']))).toBeNull();
    expect(emitted.at(-1)).toBeNull();

    emitted.length = 0;
    versions.selectedVersion.value = 'urn:sqlib:queryVersion:1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Showing an older one: the model says the number, and so does the emit.
    const viewingOlder = {
      ...savedWith(['SELECT 1', 'SELECT 2']),
      selectedVersion: 1,
    };
    expect(routeVersionFor(viewingOlder)).toBe(1);
    expect(emitted.at(-1)).toBe(1);
  });
});
