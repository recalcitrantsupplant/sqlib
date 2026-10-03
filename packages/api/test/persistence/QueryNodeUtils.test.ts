import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQueryNode, findQueryNodesByQuery, findQueryNodesByBackend, updateQueryNode, deleteQueryNode, findQueryNodesByGroup } from '../../src/persistence/utils/QueryNodeUtils.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

describe('QueryNodeUtils', () => {
  const testNodeId1 = 'http://example.org/test-node-1';
  const testNodeId2 = 'http://example.org/test-node-2';
  const testQueryId = 'http://example.org/test-query';
  const testBackendId = 'http://example.org/test-backend';

  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeEach(async () => {
    store = await installFakePersistenceAdapter();
  });

  afterEach(() => store.restore());

  it('should create a query node', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });
    expect(store.get(testNodeId1)).toMatchObject({ queryId: testQueryId, backendId: testBackendId });
  });

  it('should find query nodes by query', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });

    const found = await findQueryNodesByQuery(testQueryId);
    expect(found.length).toBe(1);
    expect(found[0].$id).toBe(testNodeId1);
  });

  it('should find query nodes by backend', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });

    const found = await findQueryNodesByBackend(testBackendId);
    expect(found.length).toBe(1);
    expect(found[0].$id).toBe(testNodeId1);
  });

  it('should update a query node', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });
    await updateQueryNode(testNodeId1, { queryId: 'http://example.org/updated-query' });
    expect(store.get(testNodeId1)).toMatchObject({ queryId: 'http://example.org/updated-query' });
  });

  it('should delete a query node', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });
    await deleteQueryNode(testNodeId1);
    expect(store.get(testNodeId1)).toBeUndefined();
  });

  it('should find query nodes by group', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });
    await createQueryNode({
      $id: testNodeId2,
      queryId: testQueryId,
      backendId: testBackendId,
    });
    // The latest version of the group names the nodes; an older one does not count.
    store.put('QueryGroupVersion', { $id: 'http://example.org/test-group/v1', isPartOf: 'http://example.org/test-group', version: 1, executionNodes: [testNodeId2] });
    store.put('QueryGroupVersion', { $id: 'http://example.org/test-group/v2', isPartOf: 'http://example.org/test-group', version: 2, executionNodes: [testNodeId1] });

    const found = await findQueryNodesByGroup('http://example.org/test-group');
    expect(found.length).toBe(1);
    expect(found[0].$id).toBe(testNodeId1);
  });
});
