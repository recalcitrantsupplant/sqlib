/**
 * What the group tells the route, and why it changed.
 *
 * The group used to emit the selected version's number unconditionally, so
 * saving v3 left `?version=3` in the URL and every bookmark taken from the
 * address bar silently pinned itself to whatever was current at the time. The
 * query editor's convention — a number only while a *non-current* version is
 * shown — is now both screens', stated once in `entityLifecycle`.
 *
 * Making the group follow it needed something it did not have: a notion of
 * which version is current, as opposed to which is selected. It tracked only
 * the latter, which is why the comparison could not be made.
 */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';

import { useQueryGroupVersions } from '@/composables/useQueryGroupVersions';
import { routeVersionForSelection } from '@/lib/entityLifecycle';

function versionRecord(id: string, version: number) {
  return {
    id,
    version,
    dateCreated: '2026-08-01T00:00:00.000Z',
    dateModified: '2026-08-01T00:00:00.000Z',
  };
}

const V1 = 'urn:sqlib:groupVersion:1';
const V2 = 'urn:sqlib:groupVersion:2';

function setup() {
  const graphState = { nodes: [], edges: [], entities: {} };

  const versions = useQueryGroupVersions({
    graph: {
      applyGraphState: vi.fn(),
      initialGraphState: graphState,
      currentGraphState: ref(graphState),
    },
    io: { resetDrafts: vi.fn(), populateFromExpanded: vi.fn() },
    queryGroupsStore: {
      loadQueryGroupVersions: vi.fn(async () => [versionRecord(V1, 1), versionRecord(V2, 2)]),
    },
    queriesStore: {
      queries: ref([]),
      loadQueries: vi.fn(async () => {}),
      getQueryNamesByVersionIds: vi.fn(() => ({})),
    },
    apiClient: {
      getQueryGroupVersion: vi.fn(async (_groupId: string, version: number) => ({
        data: {
          queryGroupVersion: {
            id: version === 1 ? V1 : V2,
            version,
            comment: null,
          },
          queryVersions: [],
        },
        etag: `"etag-${version}"`,
      })),
    },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  } as never);

  return versions;
}

describe('useQueryGroupVersions', () => {
  it('tracks which version is current, separately from which is selected', async () => {
    const versions = setup();
    await versions.loadVersionList('urn:sqlib:group:1', [versionRecord(V1, 1), versionRecord(V2, 2)]);

    versions.setCurrentVersion(V2);
    await versions.loadVersionById('urn:sqlib:group:1', V1);

    // Browsing an older version must not move what "current" means — the whole
    // reason the group could not apply the convention before.
    expect(versions.currentVersionId.value).toBe(V2);
    expect(versions.selectedVersionId.value).toBe(V1);
  });

  it('the route rule says: number for an older version, nothing for the current one', async () => {
    const versions = setup();
    await versions.loadVersionList('urn:sqlib:group:1', [versionRecord(V1, 1), versionRecord(V2, 2)]);
    versions.setCurrentVersion(V2);

    const numberOf = (id: string | null) =>
      id ? versions.versionMetadata.value[id]?.versionNumber ?? null : null;

    // Showing v1 while v2 is current: the URL pins deliberately.
    expect(routeVersionForSelection(numberOf(V1), numberOf(V2))).toBe(1);
    // Showing the current version: no parameter, so a copied link follows the
    // group instead of freezing the reader at v2.
    expect(routeVersionForSelection(numberOf(V2), numberOf(V2))).toBeNull();
  });

  it('reset forgets the current version too', async () => {
    const versions = setup();
    await versions.loadVersionList('urn:sqlib:group:1', [versionRecord(V1, 1), versionRecord(V2, 2)]);
    versions.setCurrentVersion(V2);

    versions.reset();

    // A stale current version would survive into the next group opened and
    // make its route decisions on the wrong entity's behalf.
    expect(versions.currentVersionId.value).toBeNull();
    expect(versions.selectedVersionId.value).toBeNull();
  });
});
