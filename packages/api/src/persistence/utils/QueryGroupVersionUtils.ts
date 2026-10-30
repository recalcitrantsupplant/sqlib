import { createEntityUtilsWithFields } from './EntityUtils.js';
import { QueryGroupVersionSchema, type PersistedQueryGroupVersion } from '../schemas/QueryGroupVersionSchema.js';

const QueryGroupVersionUtils = createEntityUtilsWithFields<PersistedQueryGroupVersion>(
  QueryGroupVersionSchema,
  'QueryGroupVersion'
);

export const QueryGroupVersions = QueryGroupVersionUtils.Repository;
export const createQueryGroupVersion = QueryGroupVersionUtils.create;
export const findQueryGroupVersionById = QueryGroupVersionUtils.findById;
export const findAllQueryGroupVersions = QueryGroupVersionUtils.findAll;

export async function listVersionsForGroup(groupId: string): Promise<PersistedQueryGroupVersion[]> {
  const all = await QueryGroupVersionUtils.findAll();
  return all.filter(v => v.isPartOf === groupId).sort((a, b) => Number(a.version) - Number(b.version));
}
