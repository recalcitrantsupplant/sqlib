/**
 * What page parameters a query group declares.
 *
 * The union of its members', because a `LIMIT` placeholder is named: a value
 * for `10` reaches every node whose query says `LIMIT 00010`, and a node that
 * must page independently names its own. See `docs/concepts.md`.
 *
 * Names are *digits* — `detectInputs` matches `LIMIT 000(\d+)` — so the
 * examples here read `00010` rather than `000pageSize`. The mechanism is the
 * one the design describes; only the naming convention is narrower than its
 * prose suggests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, Record<string, unknown>>();

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({}),
  getCacheCoordinator: () => ({
    get: (iri: string) => store.get(iri) ?? null,
    list: (type: string) => [...store.values()].filter(e => e['@type'] === type),
    create: async () => null,
    update: async () => null,
    delete: async () => {},
  }),
}));

const { QueryGroupSignatureService } = await import('../../src/lib/QueryGroupSignatureService.js');

const VERSION = 'urn:sqlib:query-group-version:v1';

function queryNode(id: string, queryVersionId: string, queryString: string) {
  store.set(id, { $id: id, '@type': 'QueryNode', queryId: queryVersionId });
  store.set(queryVersionId, { $id: queryVersionId, '@type': 'QueryVersion', queryString });
}

function group(...nodeIds: string[]) {
  store.set(VERSION, { $id: VERSION, '@type': 'QueryGroupVersion', executionNodes: nodeIds });
}

const service = new QueryGroupSignatureService();

beforeEach(() => { store.clear(); });

describe('pageParametersFor', () => {
  it('unions the names its members declare', () => {
    queryNode('n1', 'qv1', 'SELECT * WHERE { ?s ?p ?o } LIMIT 00010');
    queryNode('n2', 'qv2', 'SELECT * WHERE { ?s ?p ?o } LIMIT 00020 OFFSET 00030');
    group('n1', 'n2');

    expect(service.pageParametersFor(VERSION)).toEqual({
      limitParameters: ['10', '20'],
      offsetParameters: ['30'],
    });
  });

  /* Two nodes sharing a name share the value — that is what sharing one means. */
  it('reports a shared name once', () => {
    queryNode('n1', 'qv1', 'SELECT * WHERE { ?s ?p ?o } LIMIT 00010');
    queryNode('n2', 'qv2', 'SELECT * WHERE { ?a ?b ?c } LIMIT 00010');
    group('n1', 'n2');

    expect(service.pageParametersFor(VERSION).limitParameters).toEqual(['10']);
  });

  it('is empty for a group whose members declare none', () => {
    queryNode('n1', 'qv1', 'SELECT * WHERE { ?s ?p ?o }');
    group('n1');

    expect(service.pageParametersFor(VERSION)).toEqual({ limitParameters: [], offsetParameters: [] });
  });

  /*
   * A DynamicQueryNode's text arrives at run time, so it has no `queryId` and
   * declares nothing. A group cannot offer a field for a placeholder nobody can
   * see until the run is under way.
   */
  it('ignores a node with no query version, such as a dynamic query node', () => {
    store.set('dyn', { $id: 'dyn', '@type': 'DynamicQueryNode' });
    queryNode('n1', 'qv1', 'SELECT * WHERE { ?s ?p ?o } LIMIT 00010');
    group('dyn', 'n1');

    expect(service.pageParametersFor(VERSION).limitParameters).toEqual(['10']);
  });

  /*
   * Asked on a read path and a validation path, so a malformed node must not
   * turn either into a 500. The run itself fails on that node with a better
   * message than this could give.
   */
  it('skips a node whose query version is missing rather than throwing', () => {
    store.set('n1', { $id: 'n1', '@type': 'QueryNode', queryId: 'urn:sqlib:query-version:gone' });
    queryNode('n2', 'qv2', 'SELECT * WHERE { ?s ?p ?o } OFFSET 00030');
    group('n1', 'n2');

    expect(service.pageParametersFor(VERSION).offsetParameters).toEqual(['30']);
  });

  it('is empty for a version that does not exist', () => {
    expect(service.pageParametersFor('urn:sqlib:query-group-version:missing'))
      .toEqual({ limitParameters: [], offsetParameters: [] });
  });

  it('is empty when asked about something that is not a group version', () => {
    store.set('urn:sqlib:query:q1', { $id: 'urn:sqlib:query:q1', '@type': 'Query' });
    expect(service.pageParametersFor('urn:sqlib:query:q1'))
      .toEqual({ limitParameters: [], offsetParameters: [] });
  });
});
