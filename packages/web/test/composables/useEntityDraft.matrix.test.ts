/**
 * The draft lifecycle, checked for every section that drafts.
 *
 * `lib/entityLifecycle.ts` says "one model, every section", and its matrix
 * test checks the model. This checks the code the sections actually run: every
 * work area that keeps a saved entity's edits does it through
 * `useEntityDraft`, so the same rows run here once per section, over the real
 * drafts store and a stand-in editor. The section list is read from the work
 * areas' own source, so a section added there is covered without anyone
 * extending a table.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useEntityDraft, DRAFT_DEBOUNCE_MS } from '@/composables/useEntityDraft';
import { useCallableDrafts, CALLABLE_DRAFTS_STORAGE_KEY, type DraftSection } from '@/composables/useCallableDrafts';

const workAreaSources = import.meta.glob('/src/components/**/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Every `section:` a work area passes to `useEntityDraft`. */
const SECTIONS = [...new Set(
  Object.values(workAreaSources).flatMap((source) =>
    [...source.matchAll(/useEntityDraft<[^>]*>\(\{\s*section:\s*'([a-zA-Z]+)'/g)].map((match) => match[1] as DraftSection),
  ),
)].sort();

/*
 * A string body: it is what a query's editor holds (the drafts store keeps a
 * query's body as its text), and every other section stores whatever it is
 * given, so one shape runs through all of them.
 */
const SAVED = 'saved body';

function harness(section: DraftSection, options: { enabled?: boolean } = {}) {
  const scope = effectScope();
  const body = ref(SAVED);
  const draft = scope.run(() => useEntityDraft<string>({
    section,
    id: () => `urn:sqlib:${section}:1`,
    enabled: () => options.enabled ?? true,
    libraryId: () => 'urn:sqlib:library:1',
    name: () => `A ${section}`,
    editorBody: () => body.value,
    applyBody: (next) => { body.value = next; },
    sources: body,
  }))!;
  draft.markSaved();
  return { scope, body, draft, store: useCallableDrafts() };
}

async function type(body: { value: string }, text: string) {
  body.value = text;
  await nextTick();
  await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 10);
}

describe('useEntityDraft — the lifecycle, per section', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useCallableDrafts().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('finds the sections in the work areas', () => {
    // Eight versioned work areas draft through the shared lifecycle.
    expect(SECTIONS).toEqual(['argumentSet', 'bench', 'dataGraph', 'etl', 'query', 'rule', 'test', 'tupleSet']);
  });

  describe.each(SECTIONS)('%s', (section) => {
    it('keeps typing as a draft layered on the saved entity, counting edits', async () => {
      const { scope, body, draft, store } = harness(section);
      await type(body, 'one');
      await type(body, 'two');

      const record = store.draftFor(`urn:sqlib:${section}:1`);
      expect(record).toMatchObject({ kind: 'draft', section, edits: 2, body: 'two' });
      expect(draft.editCount.value).toBe(2);
      scope.stop();
    });

    it('treats typing back to the saved body as an undo, not an edit', async () => {
      const { scope, body, store } = harness(section);
      await type(body, 'changed');
      await type(body, SAVED);

      expect(store.draftFor(`urn:sqlib:${section}:1`)).toBeNull();
      scope.stop();
    });

    it('does not count reading a record into the editor as typing', async () => {
      const { scope, body, draft, store } = harness(section);
      draft.hydrate(() => { body.value = 'a version read in'; });
      await nextTick();
      await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 10);

      expect(store.draftFor(`urn:sqlib:${section}:1`)).toBeNull();
      scope.stop();
    });

    it('puts the saved body back on Discard and drops the draft', async () => {
      const { scope, body, draft, store } = harness(section);
      await type(body, 'throw me away');

      draft.discardDraft();
      await nextTick();
      await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 10);

      expect(body.value).toBe(SAVED);
      expect(store.draftFor(`urn:sqlib:${section}:1`)).toBeNull();
      scope.stop();
    });

    it('restores the draft over the saved body when one is held', async () => {
      const { scope, body, draft } = harness(section);
      await type(body, 'kept');
      body.value = SAVED;

      expect(draft.restoreDraft()).toBe(true);
      expect(body.value).toBe('kept');
      scope.stop();
    });

    it('writes an edit still queued when the record closes', async () => {
      const { scope, body, draft, store } = harness(section);
      body.value = 'queued';
      await nextTick();
      draft.flushDraft();

      expect(store.draftFor(`urn:sqlib:${section}:1`)?.body).toBe('queued');
      scope.stop();
    });

    it('never drafts a scratch record', async () => {
      const { scope, body, store } = harness(section, { enabled: false });
      await type(body, 'scratch typing');

      expect(store.draftFor(`urn:sqlib:${section}:1`)).toBeNull();
      scope.stop();
    });

    it('survives storage refusing its draft: other sections\' drafts stay kept, and the state shows', async () => {
      const other: DraftSection = section === 'query' ? 'test' : 'query';
      const bystander = harness(other);
      await type(bystander.body, 'already kept');

      const realSetItem = localStorage.setItem.bind(localStorage);
      const full = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
        if (value.includes(`urn:sqlib:${section}:1`)) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        return realSetItem(key, value);
      });

      const { scope, body, draft, store } = harness(section);
      await type(body, 'does not fit');

      expect(draft.notPersisted.value).toBe(true);
      expect(store.draftFor(`urn:sqlib:${section}:1`)?.body).toBe('does not fit');
      const kept = JSON.parse(localStorage.getItem(CALLABLE_DRAFTS_STORAGE_KEY) ?? '[]') as Array<{ basedOn: string }>;
      expect(kept.map((record) => record.basedOn)).toEqual([`urn:sqlib:${other}:1`]);

      full.mockRestore();
      scope.stop();
      bystander.scope.stop();
    });
  });
});
