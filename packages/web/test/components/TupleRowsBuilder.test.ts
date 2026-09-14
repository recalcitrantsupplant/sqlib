/**
 * Authoring a tuple set's rows by hand.
 *
 * The model here is SPARQL Results JSON taken apart — columns are `head.vars`,
 * rows are `results.bindings` — so the behaviour worth pinning is the places
 * where the two have to stay in step: renaming a column has to carry its values
 * with it, removing one has to take them away, and no two columns may share a
 * name, because a row is keyed by name and duplicates would be one binding
 * wearing two headers.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import TupleRowsBuilder from '@/components/tuple-sets/TupleRowsBuilder.vue';
import type { SparqlBinding } from '@/types/argument-sets';

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function mountBuilder(columns: string[] = [], rows: SparqlBinding[] = []) {
  return mount(TupleRowsBuilder, { props: { columns, rows } });
}

/** The last value emitted for an event, which is the state under test. */
function latest<T>(builder: ReturnType<typeof mountBuilder>, event: string): T {
  const emissions = builder.emitted(event);
  return (emissions?.at(-1) as [T])[0];
}

describe('TupleRowsBuilder — columns', () => {
  it('starts empty and says what a column is for', () => {
    const builder = mountBuilder();
    expect(builder.get('[data-testid="builder-empty"]').text()).toContain('one relation');
  });

  it('will not add a row before there is a column to put it in', () => {
    const builder = mountBuilder();
    const addRow = builder.get('[data-testid="builder-add-row"]');
    expect((addRow.element as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a column', async () => {
    const builder = mountBuilder();
    await builder.get('[data-testid="builder-add-column"]').trigger('click');
    expect(latest<string[]>(builder, 'update:columns')).toEqual(['column1']);
  });

  it('renames a column and carries its values across', async () => {
    const builder = mountBuilder(['city'], [{ city: { type: 'literal', value: 'Paris' } }]);
    await builder.get('[data-testid="builder-column-name"]').setValue('town');

    expect(latest<string[]>(builder, 'update:columns')).toEqual(['town']);
    // The value must follow the name, or renaming a column silently empties it.
    expect(latest<SparqlBinding[]>(builder, 'update:rows')).toEqual([
      { town: { type: 'literal', value: 'Paris' } },
    ]);
  });

  it('refuses to let two columns share a name', async () => {
    const builder = mountBuilder(['city', 'country'], []);
    await builder.findAll('[data-testid="builder-column-name"]')[1].setValue('city');

    // Numbered rather than rejected: a row is keyed by column name, so two
    // "city" columns would be one binding wearing two headers.
    expect(latest<string[]>(builder, 'update:columns')).toEqual(['city', 'city2']);
  });

  it('allows an empty name while typing, since clearing to retype is normal', async () => {
    const builder = mountBuilder(['city'], []);
    await builder.get('[data-testid="builder-column-name"]').setValue('');
    expect(latest<string[]>(builder, 'update:columns')).toEqual(['']);
  });

  it('removes a column and its values together', async () => {
    const builder = mountBuilder(
      ['city', 'population'],
      [{ city: { type: 'literal', value: 'Paris' }, population: { type: 'literal', value: '2161000' } }],
    );
    await builder.findAll('[data-testid="builder-remove-column"]')[1].trigger('click');

    expect(latest<string[]>(builder, 'update:columns')).toEqual(['city']);
    expect(latest<SparqlBinding[]>(builder, 'update:rows')).toEqual([
      { city: { type: 'literal', value: 'Paris' } },
    ]);
  });
});

describe('TupleRowsBuilder — rows', () => {
  it('adds a row seeded from each column default', async () => {
    const builder = mountBuilder(['city'], []);
    await builder.get('[data-testid="builder-add-row"]').trigger('click');

    // IRI is the default seed, matching the arguments panel's new-cell default.
    expect(latest<SparqlBinding[]>(builder, 'update:rows')).toEqual([
      { city: { type: 'uri', value: '' } },
    ]);
  });

  it('seeds new cells with the column default once it is chosen', async () => {
    const builder = mountBuilder(['population'], []);
    await builder.get('[data-testid="builder-column-kind"]')
      .setValue('http://www.w3.org/2001/XMLSchema#integer');
    await builder.get('[data-testid="builder-add-row"]').trigger('click');

    expect(latest<SparqlBinding[]>(builder, 'update:rows')).toEqual([
      { population: { type: 'literal', value: '', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
    ]);
  });

  it('duplicates a row without sharing its term objects', async () => {
    const rows: SparqlBinding[] = [{ city: { type: 'literal', value: 'Paris' } }];
    const builder = mountBuilder(['city'], rows);
    await builder.get('[title="Duplicate row"]').trigger('click');

    const next = latest<SparqlBinding[]>(builder, 'update:rows');
    expect(next).toHaveLength(2);
    // A shared object would make editing the copy edit the original too.
    expect(next[1].city).not.toBe(rows[0].city);
    expect(next[1].city).toEqual(rows[0].city);
  });

  it('removes a row', async () => {
    const builder = mountBuilder(['city'], [
      { city: { type: 'literal', value: 'Paris' } },
      { city: { type: 'literal', value: 'Lisbon' } },
    ]);
    await builder.findAll('[data-testid="builder-remove-row"]')[0].trigger('click');

    expect(latest<SparqlBinding[]>(builder, 'update:rows')).toEqual([
      { city: { type: 'literal', value: 'Lisbon' } },
    ]);
  });

  it('counts what is there', () => {
    const builder = mountBuilder(['city', 'population'], [{ city: { type: 'literal', value: 'Paris' } }]);
    expect(builder.text()).toContain('2 columns · 1 row');
  });
});
