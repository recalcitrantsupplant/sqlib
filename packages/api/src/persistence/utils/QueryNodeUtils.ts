/**
 * LDKit utilities for QueryNode entities
 */

import { QueryNodeSchema, type LdkitQueryNode } from '../schemas/QueryNodeSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toLdkit } from './id-adapter.js';

export const QueryNodes = createRepositoryLens(QueryNodeSchema);

/**
 * Find QueryNodes by queryId (StoredQuery reference)
 */
export async function findQueryNodesByQuery(queryId: string): Promise<LdkitQueryNode[]> {
  const allNodes = await QueryNodes.find();
  return allNodes.filter(node => node.queryId === queryId) as unknown as LdkitQueryNode[];
}

/**
 * Find QueryNodes by backendId (Backend reference)
 */
export async function findQueryNodesByBackend(backendId: string): Promise<LdkitQueryNode[]> {
  const allNodes = await QueryNodes.find();
  return allNodes.filter(node => node.backendId === backendId) as unknown as LdkitQueryNode[];
}


/**
 * Create a QueryNode with validation
 */
type FlexibleNodeInput = Omit<LdkitQueryNode, '$id' | '@id'> & { '@id'?: string; $id?: string };

export async function createQueryNode(data: FlexibleNodeInput): Promise<LdkitQueryNode> {
  // Validate required fields
  if (!data.queryId || !data.backendId) {
    throw new Error('QueryNode requires both queryId and backendId');
  }

  // Convert null to undefined for LDKit insert
  const normalized = toLdkit<LdkitQueryNode>({ ...(data) });
  const insertData = {
    ...normalized,
    queryId: normalized.queryId || undefined,
    backendId: normalized.backendId || undefined,
  };
  await QueryNodes.insert(insertData as unknown as Parameters<typeof QueryNodes.insert>[0]);
  return normalized;
}


/**
 * Update a QueryNode
 */
export async function updateQueryNode(nodeId: string, updates: Partial<Omit<LdkitQueryNode, '$id'>>): Promise<LdkitQueryNode | null> {
  const existingNode = await QueryNodes.findByIri(nodeId);
  if (!existingNode) {
    return null;
  }

  const updateData = {
    $id: nodeId,
    queryId: Object.prototype.hasOwnProperty.call(updates, 'queryId') ? updates.queryId || undefined : existingNode.queryId,
    backendId: Object.prototype.hasOwnProperty.call(updates, 'backendId') ? updates.backendId || undefined : existingNode.backendId,
  };

  await QueryNodes.update(updateData);
  const result = await QueryNodes.findByIri(nodeId);
  return result ? (result as unknown as LdkitQueryNode) : null;
}

/**
 * Delete a QueryNode
 */
export async function deleteQueryNode(nodeId: string): Promise<boolean> {
  try {
    await QueryNodes.delete(nodeId);
    return true;
  } catch (error) {
    console.error(`Failed to delete QueryNode ${nodeId}:`, error);
    return false;
  }
}

/**
 * Find QueryNodes by group ID
 */
export async function findQueryNodesByGroup(groupId: string): Promise<LdkitQueryNode[]> {
  // Nodes belong to QueryGroupVersion, not QueryGroup.
  // Load versions for the group and use the latest version's executionNodes array.
  const { listVersionsForGroup } = await import('./QueryGroupVersionUtils.js');
  const versions = await listVersionsForGroup(groupId);
  if (!versions.length) return [];
  const latest = versions[versions.length - 1];
  const nodeIds = (latest.executionNodes || []).filter(Boolean) as string[];
  if (!nodeIds.length) return [];
  const nodes = await Promise.all(nodeIds.map(id => QueryNodes.findByIri(id)));
  return nodes.filter(Boolean) as unknown as LdkitQueryNode[];
}
