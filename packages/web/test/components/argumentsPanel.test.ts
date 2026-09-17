import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TupleBindingEditor from '@/components/query-work-area/TupleBindingEditor.vue';
import ArgumentScalarsPanel from '@/components/query-work-area/ArgumentScalarsPanel.vue';
import ArgumentSetFooter from '@/components/query-work-area/ArgumentSetFooter.vue';
import RunBar from '@/components/shared/RunBar.vue';
import type { ArgumentTupleBinding } from '@/types/argument-sets';

function clause(variables: string[], rows: number): ArgumentTupleBinding {
  return {
    tupleSignature: variables.join('|'),
    variables,
    rows: Array.from({ length: rows }, (_, index) => ({
      values: Object.fromEntries(
        variables.map((name) => [name, { type: 'uri' as const, value: `v${index}` }]),
      ),
    })),
  };
}

describe('TupleBindingEditor', () => {
  it('stacks rows by default, one block each', () => {
    const w = mount(TupleBindingEditor, {
      props: { variables: ['postcode', 'state'], modelValue: clause(['postcode', 'state'], 2) },
    });
    expect(w.findAll('.row-block')).toHaveLength(2);
    expect(w.find('.row-table').exists()).toBe(false);
    expect(w.text()).toContain('2 rows');
  });

  it('shows the source line when one was located, and nothing when not', () => {
    const props = { variables: ['city'], modelValue: clause(['city'], 1) };
    expect(mount(TupleBindingEditor, { props: { ...props, line: 7 } }).find('.clause-line').text()).toBe('L7');
    expect(mount(TupleBindingEditor, { props }).find('.clause-line').exists()).toBe(false);
  });

  it('offers all three views at any arity, and starts stacked', async () => {
    const wide = ['state', 'postcode', 'suburb', 'lat', 'lon'];
    const w = mount(TupleBindingEditor, {
      props: { variables: wide, modelValue: clause(wide, 1) },
    });
    const buttons = w.findAll('.view-button');
    expect(buttons.map((button) => button.text())).toEqual(['Rows', 'Grid', 'Inline']);
    expect(buttons.every((button) => button.attributes('disabled') === undefined)).toBe(true);
    expect(w.findAll('.row-block')).toHaveLength(1);

    // The grid is the view that survives five variables: it scrolls sideways
    // rather than refusing, which is what the old table did at four.
    await buttons[1].trigger('click');
    expect(w.find('[data-testid="argument-grid"]').exists()).toBe(true);
    expect(w.findAll('[data-testid="argument-grid-cell"]')).toHaveLength(wide.length);

    await buttons[2].trigger('click');
    expect(w.find('[data-testid="argument-clause-view"]').exists()).toBe(true);
    expect(w.findAll('[data-testid="argument-clause-token"]')).toHaveLength(wide.length);
  });

  /**
   * The grid shipped laying out as a CSS grid rather than a table, because the
   * table wore `class="grid"` and Tailwind ships `.grid { display: grid }`.
   * thead and tbody became blocks and sized their columns apart, which is what
   * a misaligned header looks like. Scoped styles do not protect against this —
   * the utility has equal specificity and wins on source order.
   */
  it('does not name its table after a Tailwind display utility', async () => {
    const w = mount(TupleBindingEditor, {
      props: { variables: ['city'], modelValue: clause(['city'], 1) },
    });
    await w.findAll('.view-button')[1].trigger('click');
    const classes = w.find('[data-testid="argument-grid"]').classes();
    for (const utility of ['grid', 'flex', 'block', 'table', 'contents', 'hidden', 'inline']) {
      expect(classes, `"${utility}" is a Tailwind display utility`).not.toContain(utility);
    }
  });

  it('writes a cell typed in the grid back to the clause', async () => {
    const w = mount(TupleBindingEditor, {
      props: { variables: ['city'], modelValue: clause(['city'], 1) },
    });
    await w.findAll('.view-button')[1].trigger('click');
    const cell = w.find('[data-testid="argument-grid-cell"]');
    await cell.setValue('ex:Sydney');
    const written = w.emitted('update:modelValue')?.at(-1)?.[0] as ArgumentTupleBinding;
    expect(written.rows[0].values.city.value).toBe('ex:Sydney');
  });

  it('reads a pasted block into rows, inferring what each cell is', async () => {
    const variables = ['city', 'population'];
    const w = mount(TupleBindingEditor, {
      props: { variables, modelValue: clause(variables, 1) },
    });
    await w.findAll('.view-button')[1].trigger('click');
    await w.find('[data-testid="argument-grid-cell"]').trigger('paste', {
      clipboardData: {
        getData: () => 'http://example.org/sydney\t5300000\nhttp://example.org/perth\t2100000',
      },
    });
    const written = w.emitted('update:modelValue')?.at(-1)?.[0] as ArgumentTupleBinding;
    expect(written.rows).toHaveLength(2);
    expect(written.rows[0].values.city).toEqual({ type: 'uri', value: 'http://example.org/sydney' });
    expect(written.rows[1].values.population).toEqual({
      type: 'literal',
      value: '2100000',
      datatype: 'http://www.w3.org/2001/XMLSchema#integer',
    });
  });

  it('shows the clause view as SPARQL, UNDEF included', async () => {
    const binding = clause(['postcode', 'state'], 1);
    binding.rows[0].values.postcode = { type: 'literal', value: '2000' };
    binding.rows[0].values.state = { type: 'literal', value: '' };
    const w = mount(TupleBindingEditor, {
      props: { variables: ['postcode', 'state'], modelValue: binding },
    });
    await w.findAll('.view-button')[2].trigger('click');
    const tokens = w.findAll('[data-testid="argument-clause-token"]');
    expect(tokens.map((token) => token.text())).toEqual(['"2000"', 'UNDEF']);
    expect(w.text()).toContain('VALUES');
  });

  it('duplicates a row next to its original and renumbers on delete', async () => {
    const w = mount(TupleBindingEditor, {
      props: { variables: ['city'], modelValue: clause(['city'], 2) },
    });
    await w.findAll('.row-block')[0].findAll('.btn-row')[0].trigger('click');
    const duplicated = w.emitted('update:modelValue')?.at(-1)?.[0] as ArgumentTupleBinding;
    expect(duplicated.rows.map((row) => row.values.city.value)).toEqual(['v0', 'v0', 'v1']);
    expect(duplicated.rows.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it('says an empty clause is left open rather than matching nothing', () => {
    const w = mount(TupleBindingEditor, {
      props: { variables: ['city'], modelValue: clause(['city'], 0) },
    });
    expect(w.text()).toContain('left open');
  });

  it('summarises a row with a dash where a cell binds UNDEF', () => {
    const binding = clause(['postcode', 'state'], 1);
    binding.rows[0].values.state = { type: 'literal', value: '' };
    const w = mount(TupleBindingEditor, {
      props: { variables: ['postcode', 'state'], modelValue: binding },
    });
    expect(w.find('.row-block-summary').text()).toBe('v0 · —');
  });
});

describe('ArgumentScalarsPanel', () => {
  // "None supplied" is not the useful half: the reason is usually that the
  // query never declared one, so the empty state teaches the spelling.
  it('says how to parameterise a LIMIT when the query declares none', () => {
    const w = mount(ArgumentScalarsPanel, {
      props: { limitParameters: [], offsetParameters: [], modelValue: [] },
    });
    expect(w.text()).toContain('No parameterised LIMIT or OFFSET clauses supplied');
    expect(w.text()).toContain('LIMIT 0001');
  });

  it('rows are driven by the query, defaulting values the set has not filled', () => {
    const w = mount(ArgumentScalarsPanel, {
      props: {
        limitParameters: ['pageSize'],
        offsetParameters: ['start'],
        modelValue: [{ parameterKind: 'limit', parameterName: 'pageSize', numericValue: 20 }],
      },
    });
    const values = w.findAll('.col-value input').map((input) => (input.element as HTMLInputElement).value);
    expect(values).toEqual(['20', '0']);
  });

  it('ignores a stored value for a parameter the query no longer declares', () => {
    const w = mount(ArgumentScalarsPanel, {
      props: {
        limitParameters: [],
        offsetParameters: [],
        modelValue: [{ parameterKind: 'limit', parameterName: 'gone', numericValue: 5 }],
      },
    });
    expect(w.findAll('tbody tr')).toHaveLength(0);
  });
});

describe('ArgumentSetFooter', () => {
  it('shows nothing when there is nothing unsaved', () => {
    const w = mount(ArgumentSetFooter, {
      props: { dirty: false, scratch: false, nextVersion: 3, canSave: true },
    });
    expect(w.find('.footer').exists()).toBe(false);
  });

  it('collapses to Discard and Save vN when there is', () => {
    const w = mount(ArgumentSetFooter, {
      props: { dirty: true, scratch: true, nextVersion: 1, canSave: true },
    });
    expect(w.findAll('button')).toHaveLength(2);
    expect(w.text()).toContain('Save v1');
    expect(w.text()).toContain('lives in this browser');
  });

  it('will not save an unnamed set', () => {
    const w = mount(ArgumentSetFooter, {
      props: { dirty: true, scratch: true, nextVersion: 1, canSave: false },
    });
    expect(w.find('.btn-save').attributes('disabled')).toBeDefined();
  });
});

/**
 * The run button's label, which names what the click will execute.
 *
 * "Run draft" is only true while the editor holds unsaved edits: with none,
 * the run goes to the saved version, and a draft label promises a thing
 * that is not there. It moved to the run bar with the rest of the sentence —
 * the footer under the editor is a status strip now — so the label is a prop
 * the work area computes and this is the bar drawing it.
 */
describe('RunBar run label', () => {
  const label = (runLabel: string, running = false) =>
    mount(RunBar, { props: { runLabel, running } }).find('[data-testid="run-bar-run"]').text();

  it('draws the label the work area computed', () => {
    expect(label('Run draft')).toContain('Run draft');
    expect(label('Run')).not.toContain('draft');
  });

  it('says Running… while the run is in flight, whatever the label was', () => {
    expect(label('Run draft', true)).toContain('Running');
  });
});

/**
 * Renaming a clause's variables.
 *
 * Off by default: on a query the clause is the query text's, and the panel
 * reads it out of the SPARQL. On the argument-set screen the names are typed,
 * and before this there was no way to correct one.
 */
describe('TupleBindingEditor renaming', () => {
  it('offers no rename or remove control unless the caller asks for them', () => {
    const w = mount(TupleBindingEditor, {
      props: { variables: ['city'], modelValue: clause(['city'], 1) },
    });
    expect(w.find('[data-testid="argument-clause-rename-open"]').exists()).toBe(false);
    expect(w.find('[data-testid="argument-clause-remove"]').exists()).toBe(false);
  });

  it('emits the typed names, bare and in order', async () => {
    const w = mount(TupleBindingEditor, {
      props: { variables: ['city'], modelValue: clause(['city'], 1), renamable: true },
    });

    await w.get('[data-testid="argument-clause-rename-open"]').trigger('click');
    await w.get('[data-testid="argument-clause-rename-input"]').setValue('?cityName state');
    await w.get('[data-testid="argument-clause-rename"]').trigger('submit');

    expect(w.emitted('rename')?.at(-1)?.[0]).toEqual(['cityName', 'state']);
  });

  it('says nothing when the names come back unchanged', async () => {
    const w = mount(TupleBindingEditor, {
      props: { variables: ['city'], modelValue: clause(['city'], 1), renamable: true },
    });

    await w.get('[data-testid="argument-clause-rename-open"]').trigger('click');
    await w.get('[data-testid="argument-clause-rename"]').trigger('submit');

    expect(w.emitted('rename')).toBeUndefined();
    expect(w.find('[data-testid="argument-clause-rename-input"]').exists()).toBe(false);
  });

  it('removes on request', async () => {
    const w = mount(TupleBindingEditor, {
      props: { variables: ['city'], modelValue: clause(['city'], 1), removable: true },
    });
    await w.get('[data-testid="argument-clause-remove"]').trigger('click');
    expect(w.emitted('remove')).toHaveLength(1);
  });
});
