/**
 * `testsForSubject` — the selection behind the Tests tab on a record page
 * (issue #152).
 *
 * The helper existed with no callers and a comment claiming that role, because
 * it took a plain string: a tab is mounted once per screen and its subject
 * changes underneath it, so an id read at call time is the id of whichever
 * entity happened to be open then. `SubjectTestsPanel` filtered inline instead,
 * which left the rule written in two places and the store's sentence untrue.
 *
 * These are the store's half of the contract the panel now relies on. The
 * panel's half — that it hands over a getter rather than a snapshot — is in
 * `test/components/SubjectTestsPanel.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';

const api = vi.hoisted(() => ({ listTests: vi.fn(), deleteTest: vi.fn() }));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

const RULE_SET = 'urn:sqlib:ruleset:rs1';
const QUERY = 'urn:sqlib:query:q1';

const TESTS = [
  { id: 't1', name: 'Reaches b', subject: RULE_SET, currentVersion: 'tv1' },
  { id: 't2', name: 'Also reaches b', subject: RULE_SET, currentVersion: 'tv2' },
  { id: 't3', name: 'A query test', subject: QUERY, currentVersion: 'tv3' },
];

/**
 * The store's state is module-level, so the module is re-imported per test —
 * a listing loaded by one test would otherwise answer another's selection.
 */
let useTestsStore: typeof import('@/composables/useTestsStore')['useTestsStore'];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  api.listTests.mockResolvedValue(TESTS);
  api.deleteTest.mockResolvedValue(undefined);
  ({ useTestsStore } = await import('@/composables/useTestsStore'));
  await useTestsStore().loadTests();
});

describe('testsForSubject', () => {
  it('selects the tests pointing at one subject', () => {
    const store = useTestsStore();
    expect(store.testsForSubject(RULE_SET).value.map((test) => test.id)).toEqual(['t1', 't2']);
    expect(store.testsForSubject(QUERY).value.map((test) => test.id)).toEqual(['t3']);
  });

  it('is empty for a subject nothing tests, rather than absent', () => {
    expect(useTestsStore().testsForSubject('urn:sqlib:query:untested').value).toEqual([]);
  });

  /*
   * The reason for the signature. One `computed` is created when the tab is
   * mounted and re-evaluates when the subject changes — the caller does not
   * have to build a new one per read to stay correct, which is what the plain
   * string forced.
   */
  it('follows a subject held in a ref', async () => {
    const subject = ref(RULE_SET);
    const selected = useTestsStore().testsForSubject(subject);
    expect(selected.value.map((test) => test.id)).toEqual(['t1', 't2']);

    subject.value = QUERY;
    await nextTick();
    expect(selected.value.map((test) => test.id)).toEqual(['t3']);
  });

  it('follows a subject read through a getter, which is how a prop arrives', async () => {
    const props = ref({ subjectId: RULE_SET });
    const selected = useTestsStore().testsForSubject(() => props.value.subjectId);
    expect(selected.value.map((test) => test.id)).toEqual(['t1', 't2']);

    props.value = { subjectId: QUERY };
    await nextTick();
    expect(selected.value.map((test) => test.id)).toEqual(['t3']);
  });

  /*
   * A test created or deleted while the tab is open changes the list under it,
   * so the selection tracks the listing as well as the subject.
   */
  it('follows the listing, not a copy of it taken when it was called', async () => {
    const store = useTestsStore();
    const selected = store.testsForSubject(RULE_SET);
    expect(selected.value).toHaveLength(2);

    await store.deleteTest('t2');
    expect(selected.value.map((test) => test.id)).toEqual(['t1']);
  });
});
