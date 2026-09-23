/**
 * One place that knows which store holds which saved kind.
 *
 * `sections.ts` says what a section lists — `savedKinds`, in list order — and
 * says nothing about where those entities come from, because a table of data
 * cannot hold a store. The two switches that closed that gap lived inside
 * `pages/index.vue`, which was fine while the sidebar was the only reader.
 *
 * The splash is the second reader: it counts the library rather than listing
 * it, and derives its activity log from the same records. A second copy of the
 * switch would have been nine cases that agree until someone adds a tenth to
 * one of them, so the switch moved out here and both read it.
 *
 * What this deliberately does not do is filter. `entitiesOfKind` returns every
 * saved entity of a kind, whatever library it is in; scoping is the caller's,
 * because `libraryScoped` is a property of the section and Bench is not one.
 */
import { useQueriesStore } from './useQueriesStore';
import { useQueryGroupsStore } from './useQueryGroupsStore';
import { useRuleSetsStore } from './useRuleSetsStore';
import { useBenchmarksStore } from './useBenchmarksStore';
import { useEtlJobsStore } from './useEtlJobsStore';
import { useTestsStore } from './useTestsStore';
import { useDataGraphsStore } from './useDataGraphsStore';
import { useTupleSetsStore } from './useTupleSetsStore';
import { useArgumentSetsStore } from './useArgumentSetsStore';
import type { SectionItemType } from '../lib/sections';

/**
 * The fields every saved kind carries, as the readers of this module need
 * them.
 *
 * Narrower than any one entity type and wider than their intersection: the
 * dates and the version number are optional because a few kinds genuinely lack
 * them, and `isPartOf` is a string on query groups and an array everywhere
 * else — the shape `isInLibrary` already has to cope with.
 */
export interface KindEntity {
  id: string;
  name: string;
  description?: string | null;
  isPartOf?: string | string[] | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  tags?: string[] | null;
}

export function useEntityKinds() {
  const queriesStore = useQueriesStore();
  const queryGroupsStore = useQueryGroupsStore();
  const ruleSetsStore = useRuleSetsStore();
  const benchmarksStore = useBenchmarksStore();
  const etlJobsStore = useEtlJobsStore();
  const testsStore = useTestsStore();
  const dataGraphsStore = useDataGraphsStore();
  const tupleSetsStore = useTupleSetsStore();
  const argumentSetsStore = useArgumentSetsStore();

  /** Every saved entity of one kind, whatever library it is in. */
  function entitiesOfKind(type: SectionItemType): KindEntity[] {
    switch (type) {
      case 'query': return queriesStore.queries.value;
      case 'queryGroup': return queryGroupsStore.queryGroups.value;
      case 'ruleSet': return ruleSetsStore.ruleSets.value;
      case 'benchmark': return benchmarksStore.experiments.value;
      // An ETL job names its libraries in `libraryIds`; every other kind calls
      // the same fact `isPartOf`, and the readers here should not have to know.
      case 'etlJob': return etlJobsStore.etlJobs.value.map((job) => ({ ...job, isPartOf: job.libraryIds }));
      case 'test': return testsStore.tests.value;
      case 'dataGraph': return dataGraphsStore.dataGraphs.value;
      case 'tupleSet': return tupleSetsStore.tupleSets.value;
      case 'argumentSet': return argumentSetsStore.argumentSets.value as unknown as KindEntity[];
      default: return [];
    }
  }

  /** Load whatever a kind lists. The artifact tree used to do this. */
  function loadKind(type: SectionItemType, options: { library?: string | null } = {}): Promise<unknown> {
    switch (type) {
      case 'query': return queriesStore.loadQueries();
      case 'queryGroup': return queryGroupsStore.loadQueryGroups();
      case 'ruleSet': return ruleSetsStore.fetchRuleSets();
      case 'benchmark': return benchmarksStore.loadExperiments();
      case 'etlJob': return etlJobsStore.loadEtlJobs();
      case 'test': return testsStore.loadTests();
      case 'dataGraph': return dataGraphsStore.loadDataGraphs();
      case 'tupleSet': return tupleSetsStore.loadTupleSets();
      // Library-scoped by construction: an argument set outside a library is
      // addressable by no screen, so an unscoped listing has nothing to show.
      case 'argumentSet': return argumentSetsStore.loadArgumentSets({ library: options.library ?? null });
      default: return Promise.resolve();
    }
  }

  return { entitiesOfKind, loadKind };
}

/** `isPartOf` is an array on most entities and a bare string on query groups. */
export function isInLibrary(entity: { isPartOf?: string | string[] | null }, libraryId: string): boolean {
  const value = entity.isPartOf;
  return Array.isArray(value) ? value.includes(libraryId) : value === libraryId;
}
