import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';
import { useDataTable, type DataTableColumnDef } from '@/composables/useDataTable';

type Row = { name: string; kind: string };

const rows: Row[] = [
  { name: 'delta', kind: 'uri' },
  { name: 'alpha', kind: 'literal' },
  { name: 'charlie', kind: 'uri' },
  { name: 'bravo', kind: 'literal' },
];

const columns: DataTableColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'kind', header: 'Kind' },
];

const names = (table: ReturnType<typeof useDataTable<Row, unknown>>['table']) =>
  table.getRowModel().rows.map((row) => row.getValue('name'));

describe('useDataTable', () => {
  it('renders the rows in source order by default', () => {
    const { table } = useDataTable(columns, rows);
    expect(names(table)).toEqual(['delta', 'alpha', 'charlie', 'bravo']);
  });

  it('sorts a column both ways', async () => {
    const { table } = useDataTable(columns, rows);
    const column = table.getColumn('name')!;

    expect(column.getCanSort()).toBe(true);

    column.toggleSorting(false);
    await nextTick();
    expect(names(table)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);

    column.toggleSorting(true);
    await nextTick();
    expect(names(table)).toEqual(['delta', 'charlie', 'bravo', 'alpha']);
  });

  it('narrows rows with the global filter', async () => {
    const { table, globalFilter } = useDataTable(columns, rows);

    globalFilter.value = 'lit';
    await nextTick();

    expect(names(table)).toEqual(['alpha', 'bravo']);
  });

  it('narrows rows with a column filter', async () => {
    const { table } = useDataTable(columns, rows);

    table.getColumn('kind')!.setFilterValue('uri');
    await nextTick();

    expect(names(table)).toEqual(['delta', 'charlie']);
  });

  // The `auto` filter/sort resolvers look their function up by name, so an
  // unregistered name degrades quietly: filtering stops narrowing anything and
  // sorting drops to a raw comparison. Both cases below fail that way.
  it('matches a column filter on a substring, case-insensitively', async () => {
    const { table } = useDataTable(columns, rows);

    table.getColumn('name')!.setFilterValue('AV');
    await nextTick();

    expect(names(table)).toEqual(['bravo']);
  });

  it('sorts text without regard to case', async () => {
    const mixedCase: Row[] = [
      { name: 'Banana', kind: 'literal' },
      { name: 'apple', kind: 'literal' },
      { name: 'Cherry', kind: 'literal' },
    ];
    const { table } = useDataTable(columns, mixedCase);

    table.getColumn('name')!.toggleSorting(false);
    await nextTick();

    expect(names(table)).toEqual(['apple', 'Banana', 'Cherry']);
  });

  it('counts facet values for a column, most frequent first', () => {
    const { getColumnFacets } = useDataTable(columns, rows);
    expect(getColumnFacets('kind')).toEqual([
      ['uri', 2],
      ['literal', 2],
    ]);
  });

  /*
   * The bug in #125: clicking a facet narrowed by substring, so picking `uri`
   * also kept `uri-ref` rows. The two filter entry points share one column
   * filter, and only the shape of the value tells them apart — an array from a
   * facet click is exact, a string from the filter box is a substring search.
   */
  it('matches a clicked facet value exactly, not as a substring', async () => {
    const overlapping: Row[] = [
      { name: 'delta', kind: 'uri' },
      { name: 'alpha', kind: 'uri-ref' },
      { name: 'charlie', kind: 'uri' },
      { name: 'bravo', kind: 'literal' },
    ]
    const { table, applyFacetFilter } = useDataTable(columns, overlapping);

    applyFacetFilter('kind', 'uri');
    await nextTick();

    expect(names(table)).toEqual(['delta', 'charlie']);
  });

  it('still matches the typed column filter on a substring after a facet click', async () => {
    const overlapping: Row[] = [
      { name: 'delta', kind: 'uri' },
      { name: 'alpha', kind: 'uri-ref' },
    ]
    const { table, applyFacetFilter } = useDataTable(columns, overlapping);

    applyFacetFilter('kind', 'uri');
    await nextTick();
    expect(names(table)).toEqual(['delta']);

    // Typing replaces the array with a string, which is the substring search.
    table.getColumn('kind')!.setFilterValue('uri');
    await nextTick();
    expect(names(table)).toEqual(['delta', 'alpha']);
  });

  it('toggles a facet filter on and back off', async () => {
    const { table, applyFacetFilter, isFilterActive } = useDataTable(columns, rows);

    applyFacetFilter('kind', 'uri');
    await nextTick();
    expect(isFilterActive('kind', 'uri')).toBe(true);
    expect(names(table)).toEqual(['delta', 'charlie']);

    applyFacetFilter('kind', 'uri');
    await nextTick();
    expect(isFilterActive('kind', 'uri')).toBe(false);
    expect(names(table)).toEqual(['delta', 'alpha', 'charlie', 'bravo']);
  });

  it('leaves every row on one page unless pagination is enabled', () => {
    const { table } = useDataTable(columns, rows, { initialPageSize: 2 });
    expect(names(table)).toEqual(['delta', 'alpha', 'charlie', 'bravo']);
  });

  it('pages through the rows when pagination is enabled', async () => {
    const { table } = useDataTable(columns, rows, {
      enablePagination: true,
      initialPageSize: 2,
    });

    expect(table.getPageCount()).toBe(2);
    expect(names(table)).toEqual(['delta', 'alpha']);

    table.nextPage();
    await nextTick();
    expect(names(table)).toEqual(['charlie', 'bravo']);
  });

  it('prepends a row-number column when asked', () => {
    const { table, columnCount } = useDataTable(columns, rows, {
      enableRowNumbers: true,
    });

    expect(columnCount.value).toBe(3);

    const [first] = table.getHeaderGroups()[0]!.headers;
    expect(first!.column.id).toBe('row-number');
    expect(first!.column.columnDef.meta?.cellClassName).toBe('row-number-cell');
  });
});
