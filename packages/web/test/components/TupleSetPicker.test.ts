/**
 * Filling one VALUES clause from a tuple set elsewhere in the library.
 *
 * Two things have to hold or the picker is worse than nothing: a set that
 * cannot fill the clause must not be clickable, and the rows that land must be
 * narrowed to the clause's own variables — a stray column binds to nothing, and
 * a missing one has to read as UNDEF rather than as the empty literal.
 *
 * The third is the choice itself (issue #209): attaching a reference and
 * copying rows are different things and the picker has to offer both, because
 * only a reference tracks a v2 and only a copy can be edited afterwards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TupleSetPicker from '@/components/query-work-area/TupleSetPicker.vue';

const store = vi.hoisted(() => ({
  tupleSets: [] as Array<Record<string, unknown>>,
  loadTupleSets: vi.fn(),
  loadCurrentVersions: vi.fn(),
}));

vi.mock('@/composables/useTupleSetsStore', () => ({
  useTupleSetsStore: () => ({
    tupleSets: { get value() { return store.tupleSets; } },
    loading: { value: false },
    error: { value: null },
    ...store,
  }),
}));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: 'urn:sqlib:library:lib1' } }),
}));

function srj(vars: string[], bindings: Array<Record<string, { type: string; value: string }>>) {
  return JSON.stringify({ head: { vars }, results: { bindings } });
}

function candidate(
  name: string,
  columns: string[],
  bindings: Array<Record<string, { type: string; value: string }>> = [],
) {
  return {
    set: { id: `urn:sqlib:tupleSet:${name}`, name, isPartOf: ['urn:sqlib:library:lib1'] },
    version: {
      id: `urn:sqlib:tupleSetVersion:${name}`,
      version: 1,
      tupleColumns: columns,
      rowCount: bindings.length,
      contentString: srj(columns, bindings),
    },
  };
}

async function open(variables: string[], props: Record<string, unknown> = {}) {
  const picker = mount(TupleSetPicker, { props: { variables, ...props } });
  await picker.get('[data-testid="tuple-set-picker-open"]').trigger('click');
  await flushPromises();
  return picker;
}

/**
 * Copy is a conversion, and the conversion asks which variable each column
 * fills before it hands anything over — the labels on a tuple set are not
 * identifiers, so the pre-fill is a guess. These specs take the pre-fill as
 * offered unless they are about editing it.
 */
async function copyRows(picker: Awaited<ReturnType<typeof open>>) {
  await picker.get('[data-testid="tuple-set-picker-copy"]').trigger('click');
  await picker.get('[data-testid="tuple-set-conversion-confirm"]').trigger('click');
}

beforeEach(() => {
  vi.clearAllMocks();
  store.tupleSets = [];
  store.loadTupleSets.mockResolvedValue(undefined);
  store.loadCurrentVersions.mockResolvedValue([]);
});

describe('TupleSetPicker — what it offers', () => {
  it('scopes the listing to the active library', async () => {
    await open(['city']);
    expect(store.loadTupleSets).toHaveBeenCalledWith({ library: 'urn:sqlib:library:lib1' });
  });

  it('says so plainly when the library holds none', async () => {
    const picker = await open(['city']);
    expect(picker.get('[data-testid="tuple-set-picker-panel"]').text())
      .toContain('No tuple sets here yet');
  });

  it('disables a set that cannot fill the clause', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('countries', ['country']),
    ]);
    const picker = await open(['city']);

    const choice = picker.get('[data-testid="tuple-set-picker-choice"]');
    expect(choice.text()).toContain('no column names in common');
    // Attach is off: a reference stores no mapping, so the names have to match
    // as they stand. Copy stays on, because copying is a conversion and the
    // conversion is where a label becomes the variable it fills.
    expect((picker.get('[data-testid="tuple-set-picker-attach"]').element as HTMLButtonElement).disabled)
      .toBe(true);
    expect((picker.get('[data-testid="tuple-set-picker-copy"]').element as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('sorts the best match to the top', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('wrong', ['country']),
      candidate('extra', ['city', 'population']),
      candidate('exact', ['city']),
    ]);
    const picker = await open(['city']);

    const names = picker.findAll('[data-testid="tuple-set-picker-choice"]')
      .map((choice) => choice.find('.picker-name').text());
    expect(names).toEqual(['exact', 'extra', 'wrong']);
  });

  it('falls back to the document when a version carries no tupleColumns', async () => {
    const entry = candidate('legacy', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]);
    entry.version.tupleColumns = [];
    store.loadCurrentVersions.mockResolvedValue([entry]);

    const picker = await open(['city']);
    const attach = picker.get('[data-testid="tuple-set-picker-attach"]');
    expect((attach.element as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('TupleSetPicker — what it emits', () => {
  it('narrows rows to the clause variables and drops the rest', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('capitals', ['city', 'population'], [
        { city: { type: 'literal', value: 'Paris' }, population: { type: 'literal', value: '2161000' } },
      ]),
    ]);
    const picker = await open(['city']);
    await copyRows(picker);

    const [payload] = picker.emitted('load')![0] as [{ rows: Array<{ values: Record<string, unknown> }> }];
    expect(Object.keys(payload.rows[0].values)).toEqual(['city']);
    expect(payload.rows[0].values.city).toEqual({ type: 'literal', value: 'Paris' });
  });

  it('leaves a variable the set does not carry blank — UNDEF, not the empty literal', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('cities', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city', 'population']);
    await copyRows(picker);

    const [payload] = picker.emitted('load')![0] as [{ rows: Array<{ values: Record<string, { value: string }> }> }];
    expect(payload.rows[0].values.population.value).toBe('');
  });

  it('appends by default, matching how the runtime unions sources', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('cities', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city']);
    await copyRows(picker);

    const [payload] = picker.emitted('load')![0] as [{ replace: boolean }];
    expect(payload.replace).toBe(false);
  });

  it('replaces when the author asks it to', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('cities', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city']);
    await picker.get('.picker-mode input').setValue(true);
    await copyRows(picker);

    const [payload] = picker.emitted('load')![0] as [{ replace: boolean }];
    expect(payload.replace).toBe(true);
  });

  it('closes after a choice, so the panel does not sit over the rows it just added', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('cities', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city']);
    await copyRows(picker);

    expect(picker.find('[data-testid="tuple-set-picker-panel"]').exists()).toBe(false);
  });

  it('reports a failed listing rather than showing an empty one', async () => {
    store.loadTupleSets.mockRejectedValue(new Error('backend unreachable'));
    const picker = await open(['city']);

    // The failure is an <InlineNote tone="danger"> since the tenth pass's
    // primitive took this file's private note class; a test-id rather than a
    // class name, so the assertion outlives the next styling decision.
    expect(picker.get('[data-testid="tuple-set-picker-error"]').text()).toContain('backend unreachable');
  });
});

describe('TupleSetPicker — the conversion a copy is', () => {
  /*
   * A tuple set's columns are labels, and the query side matches by name, so
   * which variable a column fills is a guess until someone says otherwise. The
   * dialog pre-fills it and marks it unverified rather than deciding it.
   */
  it('pre-fills from the labels and says the pre-fill is a guess', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('capitals', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city']);
    await picker.get('[data-testid="tuple-set-picker-copy"]').trigger('click');

    const field = picker.get('[data-testid="tuple-set-conversion-variable-0"]');
    expect((field.element as HTMLInputElement).value).toBe('city');
    expect(field.classes()).toContain('conversion-input--unverified');
  });

  it('keys the rows by the variable named, not by the label', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('capitals', ['town'], [{ town: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city']);
    await picker.get('[data-testid="tuple-set-picker-copy"]').trigger('click');
    await picker.get('[data-testid="tuple-set-conversion-variable-0"]').setValue('city');
    await picker.get('[data-testid="tuple-set-conversion-confirm"]').trigger('click');

    const [payload] = picker.emitted('load')![0] as [{ rows: Array<{ values: Record<string, { value: string }> }> }];
    expect(payload.rows[0].values.city.value).toBe('Paris');
  });

  /*
   * A rule-set table may lead with a ground term (`TUPLE(:seed, ?x, ?y)`),
   * which fills no variable at all — the question that is easy to forget.
   */
  it('offers to strip the leading fixed column', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('seeded', ['fixed', 'city'], [
        { fixed: { type: 'uri', value: 'http://ex/seed' }, city: { type: 'literal', value: 'Paris' } },
      ]),
    ]);
    const picker = await open(['city']);
    await picker.get('[data-testid="tuple-set-picker-copy"]').trigger('click');
    await picker.get('[data-testid="tuple-set-conversion-strip"]').setValue(true);
    await picker.get('[data-testid="tuple-set-conversion-confirm"]').trigger('click');

    const [payload] = picker.emitted('load')![0] as [{ rows: Array<{ values: Record<string, unknown> }> }];
    expect(Object.keys(payload.rows[0].values)).toEqual(['city']);
  });

  it('hands nothing over when the conversion is cancelled', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('capitals', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city']);
    await picker.get('[data-testid="tuple-set-picker-copy"]').trigger('click');
    await picker.get('[data-testid="tuple-set-conversion-cancel"]').trigger('click');

    expect(picker.emitted('load')).toBeUndefined();
    expect(picker.find('[data-testid="tuple-set-picker-panel"]').exists()).toBe(true);
  });
});

describe('TupleSetPicker — attaching a reference', () => {
  /**
   * The set, not the version it currently points at. Pinning is what a save
   * does; attaching one version early would freeze the reference a step too
   * soon and defeat "float on draft" (design §7.2).
   */
  it('attaches the set and leaves the version to the save', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('cities', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city']);
    await picker.get('[data-testid="tuple-set-picker-attach"]').trigger('click');

    const [payload] = picker.emitted('attach')![0] as [{
      reference: { tupleSetId?: string; versionId?: string };
      setName: string;
    }];
    expect(payload.reference).toEqual({ tupleSetId: 'urn:sqlib:tupleSet:cities' });
    expect(payload.setName).toBe('cities');
    expect(picker.emitted('load')).toBeUndefined();
  });

  it('does not copy rows when it attaches — the two are separate choices', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('cities', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city']);
    await picker.get('[data-testid="tuple-set-picker-attach"]').trigger('click');

    expect(picker.emitted('load')).toBeUndefined();
    expect(picker.find('[data-testid="tuple-set-picker-panel"]').exists()).toBe(false);
  });

  /**
   * Two references to one set double every row it contributes: sources sharing
   * a signature are concatenated, and nothing downstream de-duplicates.
   */
  it('refuses a set the clause already links to', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('cities', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city'], {
      attachedTo: [{ tupleSetId: 'urn:sqlib:tupleSet:cities' }],
    });

    const attach = picker.get('[data-testid="tuple-set-picker-attach"]');
    expect((attach.element as HTMLButtonElement).disabled).toBe(true);
    expect(attach.text()).toContain('Linked');
  });

  it('recognises a link held as a pinned version, not just as a set', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('cities', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city'], {
      attachedTo: [{ versionId: 'urn:sqlib:tupleSetVersion:cities' }],
    });

    expect((picker.get('[data-testid="tuple-set-picker-attach"]').element as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('still offers to copy rows from a set already linked', async () => {
    store.loadCurrentVersions.mockResolvedValue([
      candidate('cities', ['city'], [{ city: { type: 'literal', value: 'Paris' } }]),
    ]);
    const picker = await open(['city'], {
      attachedTo: [{ tupleSetId: 'urn:sqlib:tupleSet:cities' }],
    });

    expect((picker.get('[data-testid="tuple-set-picker-copy"]').element as HTMLButtonElement).disabled)
      .toBe(false);
  });
});
