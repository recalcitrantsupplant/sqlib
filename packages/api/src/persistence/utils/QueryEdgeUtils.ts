/**
 * LDKit utilities for QueryEdge entities
 */

import { QueryEdgeSchema, type LdkitQueryEdge } from '../schemas/QueryEdgeSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toLdkit } from './id-adapter.js';

export const QueryEdges = createRepositoryLens(QueryEdgeSchema);

/**
 * Find QueryEdges by sourceNodeId
 */
export async function findQueryEdgesBySourceNode(sourceNodeId: string): Promise<LdkitQueryEdge[]> {
  const allEdges = await QueryEdges.find();
  return allEdges
    .filter(edge => edge.sourceNodeId === sourceNodeId)
    .map(edge => edge as LdkitQueryEdge);
}

/**
 * Find QueryEdges by targetNodeId
 */
export async function findQueryEdgesByTargetNode(targetNodeId: string): Promise<LdkitQueryEdge[]> {
  const allEdges = await QueryEdges.find();
  return allEdges
    .filter(edge => edge.targetNodeId === targetNodeId)
    .map(edge => edge as LdkitQueryEdge);
}

/**
 * Find QueryEdges connected to a specific node (either source or target)
 */
export async function findQueryEdgesByNode(nodeId: string): Promise<LdkitQueryEdge[]> {
  const allEdges = await QueryEdges.find();
  return allEdges
    .filter(edge => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId)
    .map(edge => edge as LdkitQueryEdge);
}

/**
 * Create a QueryEdge with validation
 */
type FlexibleEdgeInput = Omit<LdkitQueryEdge, '$id' | '@id'> & { '@id'?: string; $id?: string };

export async function createQueryEdge(data: FlexibleEdgeInput): Promise<LdkitQueryEdge> {
  // Validate required fields
  if (!data.sourceNodeId || !data.targetNodeId) {
    throw new Error('QueryEdge requires both sourceNodeId and targetNodeId');
  }

  // Convert null to undefined for LDKit insert
  const normalized = toLdkit<LdkitQueryEdge>({ ...(data) });
  const insertData = {
    ...normalized,
    sourceNodeId: normalized.sourceNodeId,
    targetNodeId: normalized.targetNodeId,
  };
  await QueryEdges.insert(insertData);
  return normalized;
}

/**
 * Update a QueryEdge
 */
export const updateQueryEdge = async (
  id: string,
  edge: Partial<LdkitQueryEdge>,
): Promise<LdkitQueryEdge | null> => {
  const existing = await QueryEdges.findByIri(id);
  if (!existing) {
    return null;
  }

  try {
    await QueryEdges.update({ $id: id, ...edge });
    return await QueryEdges.findByIri(id);
  } catch (error) {
    console.error(`Failed to update QueryEdge ${id}:`, error);
    return null;
  }
};

/**
 * Delete a QueryEdge
 */
export async function deleteQueryEdge(edgeId: string): Promise<boolean> {
  try {
    await QueryEdges.delete(edgeId);
    return true;
  } catch (error) {
    console.error(`Failed to delete QueryEdge ${edgeId}:`, error);
    return false;
  }
}

/**
 * Find QueryEdges by group version ID (via isPartOf relationship)
 * Note: In flat schema design, edges belong to QueryGroupVersion, not QueryGroup
 */

/**
 * Find all edges belonging to a specific QueryGroupVersion
 * Note: Edges no longer have isPartOf - the QueryGroupVersion references its edges instead
 */
export async function findQueryEdgesByGroupVersion(groupVersionId: string): Promise<LdkitQueryEdge[]> {
  // This function is deprecated since edges don't track their parent version
  // The QueryGroupVersion should be queried directly for its edges array
  return [];
}

/**
 * Delete all edges connected to a node (used when deleting nodes)
 */
export async function deleteEdgesByNode(nodeId: string): Promise<string[]> {
  const connectedEdges = await findQueryEdgesByNode(nodeId);
  const deletedEdgeIds: string[] = [];
  
  for (const edge of connectedEdges) {
    const success = await deleteQueryEdge(edge.$id);
    if (success) {
      deletedEdgeIds.push(edge.$id);
    }
  }
  
  return deletedEdgeIds;
}
