/**
 * LDKit utilities for QueryGroup entities
 */

import { QueryGroupSchema, type LdkitQueryGroup } from '../schemas/QueryGroupSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toLdkit } from './id-adapter.js';
import { stringToDate, dateToIsoString } from './type-conversions.js';

export const QueryGroups = createRepositoryLens(QueryGroupSchema);

/**
 * Load QueryGroup entities by IDs using LDKit
 */
export async function loadQueryGroupsByIds(ids: string[]): Promise<LdkitQueryGroup[]> {
  const results: LdkitQueryGroup[] = [];
  
  for (const id of ids) {
    try {
      const group = await QueryGroups.findByIri(id);
      if (group) {
        // Convert null to undefined for type compatibility  
        const compatibleGroup: LdkitQueryGroup = {
          ...group,
          description: group.description || undefined,
          currentVersion: group.currentVersion || undefined,
          dateCreated: dateToIsoString(group.dateCreated),
          dateModified: dateToIsoString(group.dateModified),
        };
        results.push(compatibleGroup);
      } else {
        console.warn(`Failed to load QueryGroup ${id}:`, null);
      }
    } catch (error) {
      console.warn(`Failed to load QueryGroup ${id}:`, error);
    }
  }
  
  return results;
}

/**
 * Create multiple QueryGroup entities
 */
export async function createQueryGroups(
  groupsData: Array<Omit<LdkitQueryGroup, '$id'> & { id: string }>
): Promise<LdkitQueryGroup[]> {
  const results: LdkitQueryGroup[] = [];
  
  for (const data of groupsData) {
    try {
      const { id, ...groupData } = data;
      
      // Validate required fields
      if (!groupData.name || !groupData.currentVersion || !groupData.isPartOf) {
        throw new Error('QueryGroup requires name, currentVersion, and isPartOf');
      }
      
      const insertGroup = {
        $id: id,
        ...groupData,
        // Convert string dates to Date objects for LDKit
        dateCreated: stringToDate(groupData.dateCreated),
        dateModified: stringToDate(groupData.dateModified),
      };
      await QueryGroups.insert(insertGroup as unknown as Parameters<typeof QueryGroups.insert>[0]);
      // Return API-shaped group (string dates)
      const apiGroup: LdkitQueryGroup = {
        $id: id,
        ...groupData,
        currentVersion: groupData.currentVersion || undefined,
        dateCreated: groupData.dateCreated || undefined,
        dateModified: groupData.dateModified || undefined,
      };
      results.push(apiGroup);
    } catch (error) {
      console.error(`Failed to create QueryGroup ${data.id}:`, error);
    }
  }
  
  return results;
}

/**
 * Update a single QueryGroup entity
 */
export async function updateQueryGroup(
  id: string,
  updates: Partial<Omit<LdkitQueryGroup, '$id' | 'argumentSets'>>
): Promise<LdkitQueryGroup | null> {
  // Check if the entity exists first
  const existing = await QueryGroups.findByIri(id);
  if (!existing) {
    return null;
  }

  const updatesWithTimestamp = {
    ...updates,
    dateModified: new Date(), // LDKit expects Date object
    // Convert any string dates to Date objects
    dateCreated: updates.dateCreated ? stringToDate(updates.dateCreated) : undefined,
  };

  await QueryGroups.update({ $id: id, ...updatesWithTimestamp });
  const result = await QueryGroups.findByIri(id);
  if (!result) {
    return null;
  }
  return {
    ...result,
    description: result.description || undefined,
    currentVersion: result.currentVersion || undefined,
    dateCreated: dateToIsoString(result.dateCreated),
    dateModified: dateToIsoString(result.dateModified),
  };
}

/**
 * Delete multiple QueryGroup entities
 */
export async function deleteQueryGroups(ids: string[]): Promise<boolean[]> {
  const results: boolean[] = [];
  
  for (const id of ids) {
    try {
      const existing = await QueryGroups.findByIri(id);
      if (!existing) {
        results.push(false);
        continue;
      }
      
      await QueryGroups.delete(id);
      results.push(true);
    } catch (error) {
      console.error(`Failed to delete QueryGroup ${id}:`, error);
      results.push(false);
    }
  }
  
  return results;
}

/**
 * Find QueryGroups by library/parent
 */
export async function findQueryGroupsByParent(parentId: string): Promise<LdkitQueryGroup[]> {
  try {
    const allGroups = await QueryGroups.find();
    const filtered = allGroups.filter(group =>
      group.isPartOf === parentId ||
      (group as { 'https://schema.org/isPartOf'?: string })['https://schema.org/isPartOf'] === parentId
    );
    
    // Convert null to undefined for type compatibility
    return filtered.map(group => ({
      ...group,
      description: group.description || undefined,
      currentVersion: group.currentVersion || undefined,
      dateCreated: dateToIsoString(group.dateCreated),
      dateModified: dateToIsoString(group.dateModified),
      isPartOf: group.isPartOf || (group as unknown as { 'https://schema.org/isPartOf': string })['https://schema.org/isPartOf'],
    }));
  } catch (error) {
    console.error(`Failed to find QueryGroups by parent ${parentId}:`, error);
    return [];
  }
}

// Note: In flat schema design, QueryGroup doesn't contain nodes/edges arrays.
// Nodes and edges are linked via QueryGroupVersion. These functions have been 
// removed to maintain consistency with the flat schema architecture.

/**
 * Create a QueryGroup with validation
 */
type FlexibleGroupInput = Omit<LdkitQueryGroup, '$id' | '@id'> & { '@id'?: string; $id?: string };

export async function createQueryGroup(data: FlexibleGroupInput): Promise<LdkitQueryGroup> {
  // Validate required fields
  if (!data.name || !data.currentVersion || !data.isPartOf) {
    throw new Error('QueryGroup requires name, currentVersion, and isPartOf');
  }
  
  const normalized = toLdkit<LdkitQueryGroup>({ 
    ...(data),
    // Convert string dates to Date objects for LDKit
    dateCreated: stringToDate(data.dateCreated),
    dateModified: stringToDate(data.dateModified),
  });
  await QueryGroups.insert(normalized as unknown as Parameters<typeof QueryGroups.insert>[0]);
  const result = await QueryGroups.findByIri(normalized.$id);
  if (!result) {
    throw new Error('Failed to retrieve QueryGroup after creation');
  }
  return {
    ...result,
    description: result.description || undefined,
    currentVersion: result.currentVersion || undefined,
    dateCreated: dateToIsoString(result.dateCreated),
    dateModified: dateToIsoString(result.dateModified),
  };
}

// Note: In flat schema architecture, QueryGroup doesn't contain nodes/edges.
// For getting nodes and edges, query the QueryGroupVersion and then fetch 
// the referenced nodes/edges separately. This maintains clean separation
// and follows the established flat schema pattern.
