/**
 * Which work area shows each kind of record, and what it tells the page.
 *
 * The page drew its main pane as a chain of ten `v-else-if` branches, one per
 * work area, each wiring the same few things by hand — the record's id under a
 * prop of its own name, the scratch id, a key, a save handler and a delete
 * handler — and forty-one `handle*Saved` / `handle*Deleted` functions behind
 * them, most of them identical bar a noun. One row per kind here replaces both:
 * the page picks the row for what is selected, and the per-kind events land on
 * the same three page handlers.
 *
 * Lives beside the page rather than in `lib/sections.ts` because it imports the
 * work areas themselves, and `lib/` stays free of components; `sections.ts`
 * still says which kinds a section lists and which scratch section it owns.
 */
import type { Component } from 'vue';
import type { FeatureFlagKey } from '@sparql-query-lib/types';
import type { DraftSection } from '../../composables/useCallableDrafts';
import type { SectionItemType } from '../../lib/sections';
import QueryWorkArea from '../QueryWorkArea.vue';
import QueryGroupWorkArea from '../QueryGroupWorkArea.vue';
import RuleSetWorkArea from '../RuleSetWorkArea.vue';
import EtlPlayground from '../EtlPlayground.vue';
import BenchmarkWorkArea from '../BenchmarkWorkArea.vue';
import DataGraphWorkArea from '../DataGraphWorkArea.vue';
import TupleSetWorkArea from '../TupleSetWorkArea.vue';
import ArgumentSetWorkArea from '../ArgumentSetWorkArea.vue';
import TestWorkArea from '../TestWorkArea.vue';

type Handler = (...args: never[]) => unknown;

/** What the page lends a work area: its state, and where events go. */
export interface WorkAreaContext {
  /** A scratch record, or a saved one, was saved: it is now this saved record. */
  onSaved: (kind: SectionItemType, id: string) => void;
  /** The open record was deleted. */
  onDeleted: (kind: SectionItemType, id: string | null) => void;
  /** The open record could not be read. */
  onLoadFailed: (kind: SectionItemType) => void;
  /** Kind-specific props and listeners, below. */
  extra: Partial<Record<SectionItemType, { props?: Record<string, unknown>; on?: Record<string, Handler> }>>;
}

export interface WorkAreaEntry {
  component: Component;
  feature: FeatureFlagKey;
  /** The scratch section whose unsaved records this work area also shows. */
  draftSection: DraftSection;
  /** The prop the saved record's id is passed under. */
  idProp: string;
  /**
   * The pane's key for a saved record: the kind, never the id. A key that
   * carries the id rebuilds the work area on every row click — its defaults,
   * its mount, its list fetches — where a constant one swaps the record in
   * place (`test/recordPaneKeys.test.ts`).
   */
  savedKey: string;
  /** The event that says the open record was deleted, where there is one. */
  deletedEvent?: string;
  /** The event that says the open record could not be read, where there is one. */
  loadFailedEvent?: string;
}

export const WORK_AREAS: Record<SectionItemType, WorkAreaEntry> = {
  query: {
    component: QueryWorkArea, feature: 'queries', draftSection: 'query', idProp: 'queryId', savedKey: 'query',
    deletedEvent: 'query-deleted', loadFailedEvent: 'query-load-failed',
  },
  queryGroup: {
    component: QueryGroupWorkArea, feature: 'queryGroups', draftSection: 'group', idProp: 'queryGroupId', savedKey: 'query-group',
    deletedEvent: 'query-group-deleted',
  },
  ruleSet: {
    component: RuleSetWorkArea, feature: 'rulesSuite', draftSection: 'rule', idProp: 'ruleSetId', savedKey: 'rule-set',
    deletedEvent: 'ruleset-deleted', loadFailedEvent: 'ruleset-load-failed',
  },
  etlJob: {
    component: EtlPlayground, feature: 'etl', draftSection: 'etl', idProp: 'etlJobId', savedKey: 'etl-job',
  },
  benchmark: {
    component: BenchmarkWorkArea, feature: 'benchmarks', draftSection: 'bench', idProp: 'experimentId', savedKey: 'benchmark',
  },
  dataGraph: {
    component: DataGraphWorkArea, feature: 'dataGraphs', draftSection: 'dataGraph', idProp: 'dataGraphId', savedKey: 'data-graph',
    deletedEvent: 'data-graph-deleted',
  },
  tupleSet: {
    component: TupleSetWorkArea, feature: 'tupleSets', draftSection: 'tupleSet', idProp: 'tupleSetId', savedKey: 'tuple-set',
    deletedEvent: 'tuple-set-deleted',
  },
  argumentSet: {
    component: ArgumentSetWorkArea, feature: 'argumentSets', draftSection: 'argumentSet', idProp: 'argumentSetId', savedKey: 'argument-set',
    deletedEvent: 'argument-set-deleted',
  },
  test: {
    component: TestWorkArea, feature: 'tests', draftSection: 'test', idProp: 'testId', savedKey: 'test',
    deletedEvent: 'test-deleted',
  },
};

/** The kind whose work area shows a scratch record of this section. */
export function kindForDraftSection(section: DraftSection | null): SectionItemType | null {
  if (!section) return null;
  const match = Object.entries(WORK_AREAS).find(([, entry]) => entry.draftSection === section);
  return (match?.[0] as SectionItemType | undefined) ?? null;
}

/** The pane's key: constant per kind for a saved record, the id for a scratch one. */
export function paneKey(kind: SectionItemType, scratchId: string | null): string {
  return scratchId ? `scratch-${scratchId}` : WORK_AREAS[kind].savedKey;
}

export interface WorkAreaPane {
  kind: SectionItemType;
  component: Component;
  key: string;
  props: Record<string, unknown>;
  on: Record<string, Handler>;
}

/**
 * The pane for what is open: a saved record of `kind`, or a scratch record.
 * Null when nothing is open.
 */
export function workAreaPane(
  open: { kind: SectionItemType; savedId: string | null; scratchId: string | null } | null,
  context: WorkAreaContext,
): WorkAreaPane | null {
  if (!open) return null;
  const { kind, savedId, scratchId } = open;
  const entry = WORK_AREAS[kind];
  const extra = context.extra[kind] ?? {};
  const on: Record<string, Handler> = {
    'scratch-saved': ((payload: { id: string }) => context.onSaved(kind, payload.id)) as Handler,
    ...(entry.deletedEvent
      ? { [entry.deletedEvent]: ((id?: unknown) => context.onDeleted(kind, typeof id === 'string' ? id : null)) as Handler }
      : {}),
    ...(entry.loadFailedEvent ? { [entry.loadFailedEvent]: (() => context.onLoadFailed(kind)) as Handler } : {}),
    ...(extra.on ?? {}),
  };
  return {
    kind,
    component: entry.component,
    key: paneKey(kind, scratchId),
    props: {
      [entry.idProp]: scratchId ? null : savedId,
      // EtlPlayground and the others take the scratch id under one name.
      scratchId,
      ...(extra.props ?? {}),
    },
    on,
  };
}
