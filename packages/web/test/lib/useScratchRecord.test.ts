/**
 * The scratch lifecycle, tested where it is cheapest to test.
 *
 * Every assertion here is a way to lose someone's unsaved work: hydration
 * echoing back over the record, an edit that never lands, a pending save
 * dropped by switching away, or a write that resurrects a discarded item.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { defineComponent, ref, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useScratchRecord } from '@/composables/useScratchRecord';
import { useCallableDrafts, UNASSIGNED_LIBRARY_ID, type CallableDraft } from '@/composables/useCallableDrafts';

const toastError = vi.fn();
vi.mock('vue-sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

function seed(id: string, body: unknown, name = 'Untitled pipeline 1') {
  useCallableDrafts().save({
    id,
    libraryId: UNASSIGNED_LIBRARY_ID,
    type: 'query',
    kind: 'scratch',
    section: 'etl',
    name,
    description: null,
    queryString: null,
    body,
    resultKind: 'BINDINGS',
    inputTuples: [],
    limitParameters: [],
    offsetParameters: [],
    outputs: [],
    basedOn: null,
  });
}

/** A minimal work area: one editable field bound to one scratch record. */
function mountHost(scratchId: string | null) {
  const text = ref('');
  const hydrated: CallableDraft[] = [];
  const id = ref(scratchId);
  let api: ReturnType<typeof useScratchRecord>;

  const wrapper = mount(defineComponent({
    setup() {
      api = useScratchRecord({
        scratchId: () => id.value,
        missingMessage: 'not here',
        track: [text],
        hydrate: (record) => {
          hydrated.push(record);
          text.value = (record.body as { text?: string })?.text ?? '';
        },
        collect: (record) => ({ name: record.name, body: { text: text.value } }),
      });
      return () => h('div');
    },
  }));

  return { wrapper, text, id, hydrated, api: api!, store: useCallableDrafts() };
}

describe('useScratchRecord', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useCallableDrafts().clear();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates the record it is given', () => {
    seed('urn:ui-temp:a', { text: 'from the store' });
    const { hydrated, text } = mountHost('urn:ui-temp:a');

    expect(hydrated).toHaveLength(1);
    expect(text.value).toBe('from the store');
  });

  it('does not write hydration back as if it were typing', async () => {
    seed('urn:ui-temp:a', { text: 'original' });
    const before = useCallableDrafts().get('urn:ui-temp:a')!.updatedAt;
    const { store } = mountHost('urn:ui-temp:a');

    await nextTick();
    vi.advanceTimersByTime(1000);

    // Untouched: the record must look exactly as unedited as it is.
    expect(store.get('urn:ui-temp:a')!.updatedAt).toBe(before);
  });

  it('saves an edit after the debounce, and not before', async () => {
    seed('urn:ui-temp:a', { text: 'original' });
    const { text, store } = mountHost('urn:ui-temp:a');
    await nextTick();

    text.value = 'typed';
    await nextTick();
    vi.advanceTimersByTime(400);
    expect((store.get('urn:ui-temp:a')!.body as { text: string }).text).toBe('original');

    vi.advanceTimersByTime(200);
    expect((store.get('urn:ui-temp:a')!.body as { text: string }).text).toBe('typed');
  });

  it('collapses a burst of edits into one write', async () => {
    seed('urn:ui-temp:a', { text: '' });
    const { text, store } = mountHost('urn:ui-temp:a');
    await nextTick();

    for (const value of ['a', 'ab', 'abc']) {
      text.value = value;
      await nextTick();
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(500);

    expect((store.get('urn:ui-temp:a')!.body as { text: string }).text).toBe('abc');
  });

  it('flushes a pending edit rather than dropping it', async () => {
    seed('urn:ui-temp:a', { text: '' });
    const { text, api, store } = mountHost('urn:ui-temp:a');
    await nextTick();

    text.value = 'nearly lost';
    await nextTick();
    api.flush();

    expect((store.get('urn:ui-temp:a')!.body as { text: string }).text).toBe('nearly lost');
  });

  it('flushes on unmount — switching sections must not eat the last keystroke', async () => {
    seed('urn:ui-temp:a', { text: '' });
    const { text, wrapper, store } = mountHost('urn:ui-temp:a');
    await nextTick();

    text.value = 'typed then navigated away';
    await nextTick();
    wrapper.unmount();

    expect((store.get('urn:ui-temp:a')!.body as { text: string }).text).toBe('typed then navigated away');
  });

  it('flushes the old record before loading the new one', async () => {
    seed('urn:ui-temp:a', { text: 'a' });
    seed('urn:ui-temp:b', { text: 'b' });
    const { text, id, store } = mountHost('urn:ui-temp:a');
    await nextTick();

    text.value = 'edited a';
    await nextTick();
    id.value = 'urn:ui-temp:b';
    await nextTick();

    expect((store.get('urn:ui-temp:a')!.body as { text: string }).text).toBe('edited a');
    expect(text.value).toBe('b');
  });

  it('does not resurrect a record that was discarded under it', async () => {
    seed('urn:ui-temp:a', { text: '' });
    const { text, store } = mountHost('urn:ui-temp:a');
    await nextTick();

    text.value = 'typed';
    await nextTick();
    store.remove('urn:ui-temp:a');
    vi.advanceTimersByTime(600);

    expect(store.get('urn:ui-temp:a')).toBeNull();
  });

  it('says so when the link names a record this browser does not hold', () => {
    mountHost('urn:ui-temp:missing');
    expect(toastError).toHaveBeenCalledWith('not here');
  });

  it('is inert with no record open', async () => {
    const { text, api } = mountHost(null);
    expect(api.isScratch.value).toBe(false);

    text.value = 'nowhere to go';
    await nextTick();
    vi.advanceTimersByTime(600);

    expect(useCallableDrafts().allDrafts.value).toHaveLength(0);
  });
});

/**
 * Bodies that are edited in place, which is every section but Queries.
 *
 * A ref holding an array notifies only when `.value` is replaced. The editors
 * do not replace: they set `mappings[i].targetVariable`, `rules[i]`,
 * `specs[i].subjectId`. A shallow watcher would autosave the query editor and
 * silently drop everything typed in the other three.
 */
describe('useScratchRecord with a mutable body', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useCallableDrafts().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves an element assigned by index', async () => {
    seed('urn:ui-temp:a', { rules: ['first'] });
    const rules = ref<string[]>([]);

    mount(defineComponent({
      setup() {
        useScratchRecord({
          scratchId: () => 'urn:ui-temp:a',
          missingMessage: 'not here',
          track: [rules],
          hydrate: (record) => { rules.value = [...((record.body as { rules: string[] }).rules)]; },
          collect: (record) => ({ name: record.name, body: { rules: [...rules.value] } }),
        });
        return () => h('div');
      },
    }));
    await nextTick();

    rules.value[0] = 'edited in place';
    await nextTick();
    vi.advanceTimersByTime(600);

    expect((useCallableDrafts().get('urn:ui-temp:a')!.body as { rules: string[] }).rules)
      .toEqual(['edited in place']);
  });

  it('saves a field mutated on a row object', async () => {
    seed('urn:ui-temp:a', { rows: [{ target: '' }] });
    const rows = ref<Array<{ target: string }>>([]);

    mount(defineComponent({
      setup() {
        useScratchRecord({
          scratchId: () => 'urn:ui-temp:a',
          missingMessage: 'not here',
          track: [rows],
          hydrate: (record) => {
            rows.value = (record.body as { rows: Array<{ target: string }> }).rows.map((r) => ({ ...r }));
          },
          collect: (record) => ({ name: record.name, body: { rows: rows.value.map((r) => ({ ...r })) } }),
        });
        return () => h('div');
      },
    }));
    await nextTick();

    rows.value[0]!.target = '?country';
    await nextTick();
    vi.advanceTimersByTime(600);

    expect((useCallableDrafts().get('urn:ui-temp:a')!.body as { rows: Array<{ target: string }> }).rows)
      .toEqual([{ target: '?country' }]);
  });
});
