/**
 * The library Activity tab's rows: grouped by day, newest first, with the
 * words each row shows. Pure, so the grouping is tested without a page.
 */
import type { LibraryActivityItem } from '@/composables/useApiClient';
import { formatDayMonth } from '@/lib/time';

export const ACTIVITY_VERBS: Record<LibraryActivityItem['kind'], string> = {
  created: 'created',
  edited: 'edited',
  saved: 'saved',
  moved: 'moved',
  deleted: 'deleted',
};

/** The noun shown after an entity's name. */
export const ENTITY_KIND_LABELS: Record<string, string> = {
  Query: 'query',
  QueryGroup: 'group',
  RuleSet: 'rule set',
  Rule: 'rule',
  DataBlock: 'data block',
  DataGraph: 'data graph',
  TupleSet: 'tuple set',
  ArgumentSet: 'argument set',
  Test: 'test',
  EtlJob: 'ETL job',
  Notebook: 'notebook',
  BenchmarkExperiment: 'benchmark',
  Tag: 'tag',
  Environment: 'environment',
};

export interface ActivityDay {
  key: string;
  label: string;
  items: LibraryActivityItem[];
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Group items, already newest first, by local day: "Today", "Yesterday", then the date. */
export function groupByDay(items: readonly LibraryActivityItem[], now: Date = new Date()): ActivityDay[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days: ActivityDay[] = [];
  for (const item of items) {
    const date = new Date(item.at);
    const key = dayKey(date);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      const label = key === today ? 'Today' : key === yesterday ? 'Yesterday' : formatDayMonth(item.at, now);
      day = { key, label, items: [] };
      days.push(day);
    }
    day.items.push(item);
  }
  return days;
}

/** The time at the end of a row: hours and minutes. */
export function timeOfDay(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
