/**
 * One run cell.
 *
 * The parts worth pinning are the ones that make a notebook cell different from
 * the library page's: the value name it binds, the stat chip beside it, the
 * staleness mark when an upstream value moved under it, and the slot source
 * control — the thing that turns two independent queries into a chain.
 *
 * Assertions go through `data-testid` and rendered text rather than styling
 * classes, for the reason the library page's own spec gives: a class assertion
 * passes just as happily on a page whose stylesheet never loaded.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineArgsElement } from '@sparql-query-lib/runtime/args-element';
import NotebookRunCell from '@/components/notebook/NotebookRunCell.vue';
import { rowsValue } from '@/lib/notebookValues';
import type { QueryCell } from '@/lib/notebookFormat';

defineArgsElement();

const CELL: QueryCell = { kind: 'query', id: 'c1', query: 'urn:q:people', out: 'candidates' };

const TARGET = {
  id: 'urn:q:people',
  kind: 'query' as const,
  name: 'unlinked-assets',
  description: 'Assets with no link',
  resultKind: 'BINDINGS' as const,
  slots: [['asset']],
  limitParameters: [],
  offsetParameters: [],
  version: 3,
};

const IDLE = { status: 'idle' as const, error: null, durationMs: null, ranAt: null, stale: false };

function value() {
  const bindings = [{ asset: { type: 'uri', value: 'urn:a' } }];
  return rowsValue(
    { name: 'candidates', cellId: 'c1', durationMs: 12 },
    { head: { vars: ['asset'] }, results: { bindings } },
    JSON.stringify({ head: { vars: ['asset'] }, results: { bindings } }),
  );
}

function render(props: Record<string, unknown> = {}) {
  return mount(NotebookRunCell, {
    props: {
      cell: CELL,
      index: 2,
      target: TARGET,
      state: IDLE,
      value: null,
      valueOptions: [],
      ...props,
    },
    global: {
      stubs: { NuxtLink: { props: ['to'], template: '<a><slot /></a>' } },
    },
  });
}

describe('the value a cell binds', () => {
  it('shows the name as an editable field and emits a rename', async () => {
    const wrapper = render();
    const input = wrapper.get('[data-testid="notebook-out-c1"]');
    expect((input.element as HTMLInputElement).value).toBe('candidates');

    await input.setValue('assets');
    await input.trigger('change');

    expect(wrapper.emitted('rename')?.[0]).toEqual(['assets']);
  });

  it('shows the stats beside it once it has run', () => {
    const wrapper = render({ value: value() });
    expect(wrapper.get('[data-testid="notebook-stats-c1"]').text()).toMatch(/1 row · 1 col · \d+ B/);
  });

  it('offers Save only for a value there is an entity to save it as', () => {
    expect(render({ value: value() }).find('[data-testid="notebook-save-c1"]').exists()).toBe(true);
    expect(render().find('[data-testid="notebook-save-c1"]').exists()).toBe(false);
  });
});

describe('staleness', () => {
  it('marks the cell and offers Re-run rather than re-running on its own', () => {
    const wrapper = render({
      value: value(),
      state: { ...IDLE, status: 'ok', stale: true, durationMs: 40 },
    });

    expect(wrapper.get('[data-testid="notebook-stale-c1"]').text()).toBe('stale');
    expect(wrapper.get('[data-testid="notebook-run-c1"]').text()).toContain('Re-run');
    expect(wrapper.get('[data-testid="notebook-status-c1"]').text()).toContain('older input');
  });
});

describe('wiring a slot', () => {
  it('lists the values bound above the cell, rows only', async () => {
    const wrapper = render({
      valueOptions: [
        { name: 'candidates', type: 'rows', summary: '1,204 rows · 4 cols · 88 KB' },
        { name: 'neighbourhood', type: 'graph', summary: '18,332 triples · 2.1 MB' },
      ],
    });

    const options = wrapper.get('[data-testid="notebook-slot-source-c1-0"]').findAll('option');
    expect(options.map((option) => option.text())).toEqual(['Typed values', '@candidates']);
  });

  it('emits the slot source when one is chosen', async () => {
    const wrapper = render({
      valueOptions: [{ name: 'candidates', type: 'rows', summary: '1 row' }],
    });

    await wrapper.get('[data-testid="notebook-slot-source-c1-0"]').setValue('@candidates');

    expect(wrapper.emitted('update')?.[0]).toEqual([
      { slots: [{ from: 'value', ref: 'candidates', whenEmpty: 'skip' }] },
    ]);
  });

  it('shows what a wired slot carries, and that it travels by value', () => {
    const wrapper = render({
      cell: { ...CELL, slots: [{ from: 'value', ref: 'candidates' }] },
      valueOptions: [{ name: 'candidates', type: 'rows', summary: '1,204 rows · 4 cols · 88 KB' }],
    });

    expect(wrapper.text()).toContain('1,204 rows · 4 cols · 88 KB · by value');
  });
});

describe('a cell whose target is gone', () => {
  it('says so and refuses to offer a run', () => {
    const wrapper = render({ target: null });
    expect(wrapper.get('[data-testid="notebook-missing-c1"]').text()).toContain('no longer holds');
    expect(wrapper.get('[data-testid="notebook-run-c1"]').attributes('disabled')).toBeDefined();
  });
});
