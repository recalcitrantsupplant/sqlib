/**
 * What the import dialog's stored-query list is allowed to offer.
 *
 * A rule is built from a CONSTRUCT template or an INSERT … WHERE, and nothing
 * else converts — `fromUpdate` in `@sparql-query-lib/srl` rejects the other ten
 * update forms, and the other query forms have no template to read a head out
 * of. The list has to say the same thing the converter does: a library of
 * mostly-SELECT queries offering every row would be a list that refuses on
 * click, one row at a time.
 *
 * So these pin the two filters the list applies — the query type, and the
 * server's `srlImportable` verdict for the updates the type alone cannot
 * settle.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { QueryTypeIri } from '@sparql-query-lib/types';

const LIBRARY_ID = 'urn:sqlib:library:l1';

/** A query and the current version the list reads its type off. */
function pair(
  name: string,
  queryType: string,
  extra: { srlImportable?: boolean } = {},
) {
  const id = `urn:sqlib:query:${name}`;
  const versionId = `urn:sqlib:query-version:${name}-v1`;
  return {
    query: { id, name, isPartOf: [LIBRARY_ID], currentVersion: versionId },
    version: {
      id: versionId,
      version: 1,
      queryString: `# ${name}`,
      queryType,
      ...extra,
    },
  };
}

const PAIRS = [
  pair('construct-one', QueryTypeIri.construct),
  pair('insert-one', QueryTypeIri.update, { srlImportable: true }),
  pair('delete-one', QueryTypeIri.update, { srlImportable: false }),
  pair('update-unflagged', QueryTypeIri.update),
  pair('select-one', QueryTypeIri.select),
  pair('ask-one', QueryTypeIri.ask),
  pair('describe-one', QueryTypeIri.describe),
];

const api = vi.hoisted(() => ({ ruleFromSparql: vi.fn() }));
const store = vi.hoisted(() => ({
  queries: { value: [] as unknown[] },
  loadQueries: vi.fn(),
  loadQueryVersions: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useQueriesStore', () => ({ useQueriesStore: () => store }));

import ImportSparqlDialog from '@/components/rules/ImportSparqlDialog.vue';

/** The dialog renders in a teleport, so rows are read off the document. */
function rowNames(): string[] {
  return [...document.querySelectorAll('[data-testid^="import-query-"]')]
    .map((row) => row.querySelector('.query-name')?.textContent?.trim() ?? '')
    .filter(Boolean);
}

async function openDialog() {
  const wrapper = mount(ImportSparqlDialog, {
    props: { open: false, libraryId: LIBRARY_ID, targetPrologue: '' },
    attachTo: document.body,
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  await flushPromises();
  return wrapper;
}

describe('the import dialog offers only the queries a rule can be read out of', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    store.queries.value = PAIRS.map((entry) => entry.query);
    store.loadQueries.mockResolvedValue(undefined);
    store.loadQueryVersions.mockImplementation(async (queryId: string) => {
      const match = PAIRS.find((entry) => entry.query.id === queryId);
      return match ? [match.version] : [];
    });
    api.ruleFromSparql.mockResolvedValue({
      rule: 'RULE { ?s :q ?o } WHERE { ?s :p ?o }',
      form: 'construct',
      issues: [],
      prefixes: [],
      runOnce: false,
    });
  });

  it('lists the CONSTRUCTs and the INSERTs and nothing else', async () => {
    const wrapper = await openDialog();

    // `update-unflagged` is a version written before the flag existed. It is
    // offered rather than hidden — the conversion on click settles it, and the
    // alternative is a library that quietly loses rows as the flag ages.
    expect(rowNames().sort()).toEqual(['construct-one', 'insert-one', 'update-unflagged']);

    wrapper.unmount();
  });

  it('drops an update the server has already judged unconvertible', async () => {
    const wrapper = await openDialog();

    expect(rowNames()).not.toContain('delete-one');

    wrapper.unmount();
  });

  it('labels each row with the form it came from', async () => {
    const wrapper = await openDialog();

    const forms = [...document.querySelectorAll('[data-testid^="import-query-"]')]
      .map((row) => row.querySelector('.query-form')?.textContent?.trim());

    expect(new Set(forms)).toEqual(new Set(['CONSTRUCT', 'UPDATE']));

    wrapper.unmount();
  });
});
