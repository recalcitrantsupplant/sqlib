/**
 * What the landing screen knows about the active library: how much of each
 * thing there is, and what changed most recently.
 *
 * One pass over the library, two readings. The counts and the activity log are
 * derived from the same lists rather than from two sources, because they are
 * the same records asked two questions — "how many queries" and "which query
 * moved last" — and two sources would answer them differently the moment one
 * of them was stale.
 *
 * Where the numbers come from: the section lists the rail already loads, from
 * the stores in `useEntityKinds`, filtered to the active library where the
 * section is library-scoped. There is no counts endpoint, and a count fetched
 * separately from the list it counts is a second thing to keep honest.
 *
 * Where the activity comes from: `dateCreated` and `dateModified`, which every
 * entity carries, plus `currentVersionNumber` where the kind is versioned. So
 * the log is durable — it says the same thing to a tab opened tomorrow, unlike
 * the live change feed, which only carries what happened while a tab was
 * watching.
 *
 * What it therefore cannot show is a deletion: a deleted entity leaves no
 * record to sort. The log says so in its own words rather than pretending the
 * list is complete.
 */
import { computed, ref, watch, type Ref } from 'vue';
import type { FeatureFlagKey } from '@sparql-query-lib/types';
import { LIST_SECTIONS, SECTION_DEFINITIONS, type ListSection, type SectionItemType } from '../lib/sections';
import { RAIL_ENTRIES } from '../lib/railEntries';
import type { RailSection } from '../lib/railSections';
import { isInLibrary, useEntityKinds, type KindEntity } from './useEntityKinds';
import { useBackendsStore } from './useBackendsStore';
import { useFeatureFlags } from './useFeatureFlags';

/** How many of one rail section's thing the library holds. */
export type SectionCounts = Partial<Record<RailSection, number>>;

export interface ActivityEntry {
  id: string;
  /** The entity's name, as it is listed. */
  name: string;
  /** Created, or updated since. The only two verbs a list of live records can support. */
  verb: 'created' | 'updated';
  /** The section it belongs to, for the kind label and the way in. */
  section: ListSection;
  /** The version it now stands at, where the kind is versioned. */
  version: number | null;
  /** ISO time of the change this row reports. */
  at: string;
}

/** How many rows the log draws. Enough to show a session's work, not a history. */
const ACTIVITY_LIMIT = 8;

/**
 * The flags that have to be on for a section to be counted at all.
 *
 * Two of them, because two tables name a flag for the same section and they do
 * not always agree — the rail's ETL entry is behind `playgroundEtl` and the
 * section table's is behind `etl`. Counting what the rail draws as off would
 * put a number under a dimmed card, so both have to say yes.
 *
 * Not a display nicety either: `useApiClient` throws on a call into a disabled
 * area before it reaches the network, so asking anyway would turn every
 * disabled section into a console error on the screen the app opens on.
 */
function featuresOf(section: ListSection): FeatureFlagKey[] {
  const rail = RAIL_ENTRIES.find((entry) => entry.section === section);
  const flags = [SECTION_DEFINITIONS[section].feature];
  if (rail?.feature && !flags.includes(rail.feature)) flags.push(rail.feature);
  return flags;
}

function versionOf(entity: KindEntity): number | null {
  return typeof entity.currentVersionNumber === 'number' ? entity.currentVersionNumber : null;
}

/**
 * Created or updated, from the two dates alone.
 *
 * The server stamps both on creation, so equality means "nothing has happened
 * to it since". A missing `dateModified` falls back to `dateCreated`, which is
 * the same claim with less precision.
 */
function activityFor(entity: KindEntity, section: ListSection): ActivityEntry | null {
  const created = entity.dateCreated ?? null;
  const modified = entity.dateModified ?? created;
  if (!modified) return null;
  return {
    id: entity.id,
    name: entity.name,
    verb: created && modified !== created ? 'updated' : 'created',
    section,
    version: versionOf(entity),
    at: modified,
  };
}

export function useLibraryInventory(libraryId: Ref<string | null>) {
  const { entitiesOfKind, loadKind } = useEntityKinds();
  const backendsStore = useBackendsStore();
  const { isEnabled } = useFeatureFlags();

  const loading = ref(false);

  /** The sections this deployment has, in the order `sections.ts` declares them. */
  const countedSections = computed(() =>
    LIST_SECTIONS.filter((section) => featuresOf(section).every((flag) => isEnabled(flag))),
  );

  function kindsOf(section: ListSection): SectionItemType[] {
    return SECTION_DEFINITIONS[section].savedKinds.map((kind) => kind.type);
  }

  /** One section's entities, scoped to the library where the section is scoped. */
  function entitiesIn(section: ListSection): KindEntity[] {
    const definition = SECTION_DEFINITIONS[section];
    const library = libraryId.value;
    if (definition.libraryScoped && !library) return [];
    return kindsOf(section).flatMap((kind) =>
      entitiesOfKind(kind).filter(
        (entity) => !definition.libraryScoped || isInLibrary(entity, library as string),
      ),
    );
  }

  const counts = computed<SectionCounts>(() => {
    const result: SectionCounts = {};
    for (const section of countedSections.value) {
      result[section] = entitiesIn(section).length;
    }
    if (isEnabled('backends')) {
      result.backends = backendsStore.backends.value.length;
    }
    return result;
  });

  /**
   * Everything the library holds, as one number.
   *
   * Backends are left out on purpose: they are account-level — libraries point
   * at them — so counting them here would make the line under the wordmark
   * answer a different question for a deployment with three libraries than for
   * one with a single library.
   */
  const totalItems = computed(() =>
    countedSections.value.reduce((total, section) => total + (counts.value[section] ?? 0), 0),
  );

  const activity = computed<ActivityEntry[]>(() =>
    countedSections.value
      .flatMap((section) =>
        entitiesIn(section)
          .map((entity) => activityFor(entity, section))
          .filter((entry): entry is ActivityEntry => entry !== null),
      )
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, ACTIVITY_LIMIT),
  );

  /**
   * One request per kind, in parallel, and a failed kind counts as none.
   *
   * A section the server refuses — a flag the client thinks is on and the
   * deployment does not serve — must not take the whole screen down with it:
   * the landing screen's job is to draw what it can name.
   */
  async function load(): Promise<void> {
    loading.value = true;
    try {
      const work: Array<Promise<unknown>> = [];
      for (const section of countedSections.value) {
        for (const kind of kindsOf(section)) {
          work.push(loadKind(kind, { library: libraryId.value }).catch(() => undefined));
        }
      }
      if (isEnabled('backends')) {
        work.push(backendsStore.loadBackends().catch(() => undefined));
      }
      await Promise.all(work);
    } finally {
      loading.value = false;
    }
  }

  // The lists are unscoped apart from argument sets, but the scoping of what is
  // *shown* follows the picker, and argument sets are fetched per library — so
  // a switch reloads rather than refilters.
  watch(libraryId, () => { void load(); });

  return { counts, totalItems, activity, loading, load };
}
