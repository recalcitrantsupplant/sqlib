/**
 * Reading and writing the tags on one entity.
 *
 * Tags are stored on the entity (`sqlib:hasTag`), not on the Tag, so a change
 * is a PUT of the entity with a new `tags` array — there is no membership
 * endpoint to call and no join table to keep. That makes this a small map from
 * the sidebar's kind to the right update call, plus the list reload that keeps
 * the dots on every other row honest.
 *
 * Only five of the sidebar's seven kinds appear: a benchmark experiment has no
 * `isPartOf` and an ETL job's is undeclared, so neither can satisfy the one tag
 * invariant — a tag's library must equal the tagged entity's. They are absent
 * here rather than failing at the server: a tag control that offers itself and
 * then 400s is worse than one that is not offered.
 *
 * No `If-Match` is sent. The entity being retagged is usually the one *not*
 * open in the editor — a row in the list — so there is no cached token for it
 * that means anything, and a 412 on "add a label" would be a puzzle rather than
 * a protection. Tagging touches a field nothing else writes.
 */
import { computed } from 'vue';
import { useApiClient } from './useApiClient';
import { useQueriesStore } from './useQueriesStore';
import { useQueryGroupsStore } from './useQueryGroupsStore';
import { useRuleSetsStore } from './useRuleSetsStore';
import { useTestsStore } from './useTestsStore';
import { useDataGraphsStore } from './useDataGraphsStore';
import type { SectionItemType } from '../lib/sections';

/** The sidebar kinds that can carry tags. */
export const TAGGABLE_KINDS = ['query', 'queryGroup', 'ruleSet', 'test', 'dataGraph'] as const;

export type TaggableKind = (typeof TAGGABLE_KINDS)[number];

export function isTaggableKind(kind: string | null | undefined): kind is TaggableKind {
  return TAGGABLE_KINDS.includes(kind as TaggableKind);
}

/** `SectionItemType` is a superset; this narrows it without a cast at call sites. */
export function taggableKindFor(kind: SectionItemType | string | null | undefined): TaggableKind | null {
  return isTaggableKind(kind) ? kind : null;
}

type TaggedEntity = { id: string; tags?: string[] | null };

export function useEntityTags() {
  const apiClient = useApiClient();
  const queriesStore = useQueriesStore();
  const queryGroupsStore = useQueryGroupsStore();
  const ruleSetsStore = useRuleSetsStore();
  const testsStore = useTestsStore();
  const dataGraphsStore = useDataGraphsStore();

  const writers: Record<TaggableKind, {
    write: (id: string, tags: string[]) => Promise<unknown>;
    reload: () => Promise<unknown>;
    rows: () => TaggedEntity[];
  }> = {
    query: {
      write: (id, tags) => apiClient.updateQuery(id, { tags }),
      reload: () => queriesStore.loadQueries(),
      rows: () => queriesStore.queries.value as TaggedEntity[],
    },
    queryGroup: {
      write: (id, tags) => apiClient.updateQueryGroup(id, { tags }),
      reload: () => queryGroupsStore.loadQueryGroups(),
      rows: () => queryGroupsStore.queryGroups.value as TaggedEntity[],
    },
    ruleSet: {
      write: (id, tags) => apiClient.updateRuleSet(id, { tags }),
      reload: () => ruleSetsStore.fetchRuleSets(),
      rows: () => ruleSetsStore.ruleSets.value as TaggedEntity[],
    },
    test: {
      write: (id, tags) => apiClient.updateTest(id, { tags }),
      reload: () => testsStore.loadTests(),
      rows: () => testsStore.tests.value as TaggedEntity[],
    },
    dataGraph: {
      write: (id, tags) => apiClient.updateDataGraph(id, { tags }),
      reload: () => dataGraphsStore.loadDataGraphs(),
      rows: () => dataGraphsStore.dataGraphs.value as TaggedEntity[],
    },
  };

  /** What the store currently believes this entity carries. */
  function tagsOf(kind: TaggableKind, id: string): string[] {
    const row = writers[kind].rows().find((entity) => entity.id === id);
    return row?.tags ?? [];
  }

  async function setTags(kind: TaggableKind, id: string, tags: string[]): Promise<void> {
    await writers[kind].write(id, [...new Set(tags)]);
    await writers[kind].reload();
  }

  async function toggleTag(kind: TaggableKind, id: string, tagId: string): Promise<void> {
    const current = tagsOf(kind, id);
    const next = current.includes(tagId) ? current.filter((tag) => tag !== tagId) : [...current, tagId];
    await setTags(kind, id, next);
  }

  /**
   * How many entities carry each tag, across every taggable kind loaded.
   *
   * The picker shows it beside each name, and it is a count of the library
   * rather than of the section: a tag with four things under it reads as used
   * even when the section you are looking at holds none of them.
   */
  const countsByTag = computed(() => {
    const counts: Record<string, number> = {};
    for (const kind of TAGGABLE_KINDS) {
      for (const row of writers[kind].rows()) {
        for (const tag of row.tags ?? []) counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return counts;
  });

  /**
   * Reload every taggable list.
   *
   * One caller: deleting a tag, which unlabels server-side across all nine
   * types at once. Every list on the client is then claiming a dot for a tag
   * that no longer exists, and only a refetch fixes that.
   */
  async function reloadAll(): Promise<void> {
    await Promise.all(TAGGABLE_KINDS.map((kind) => writers[kind].reload().catch(() => undefined)));
  }

  return { tagsOf, setTags, toggleTag, countsByTag, reloadAll };
}
