import { createEntityUtilsWithFields } from './EntityUtils.js';
import { QueryGroupVersionSchema, type LdkitQueryGroupVersion } from '../schemas/QueryGroupVersionSchema.js';

const QueryGroupVersionUtils = createEntityUtilsWithFields<LdkitQueryGroupVersion>(
  QueryGroupVersionSchema,
  'QueryGroupVersion'
);

export const QueryGroupVersions = QueryGroupVersionUtils.Repository;
export const createQueryGroupVersion = QueryGroupVersionUtils.create;
export const findQueryGroupVersionById = QueryGroupVersionUtils.findById;
export const findAllQueryGroupVersions = QueryGroupVersionUtils.findAll;

export async function listVersionsForGroup(groupId: string): Promise<LdkitQueryGroupVersion[]> {
  const all = await QueryGroupVersionUtils.findAll();
  return all.filter(v => v.isPartOf === groupId).sort((a, b) => Number(a.version) - Number(b.version));
}
