import { createEntityUtilsWithFields } from './EntityUtils.js';
import { QuerySchema, type LdkitQuery } from '../schemas/QuerySchema.js';

const QueryUtils = createEntityUtilsWithFields<LdkitQuery>(
  QuerySchema,
  'Query',
  {
    // QuerySchema makes `isPartOf` mandatory, but this path never enforced it.
    // Deriving would start rejecting creates that succeed today, so the
    // narrower list stands; the route's create schema already requires at
    // least one library, so the gap is only reachable from internal callers.
    requiredFields: ['name'],
  },
);

export const Queries = QueryUtils.Repository;
export const createQuery = QueryUtils.create;
export const updateQuery = QueryUtils.update;
export const deleteQuery = QueryUtils.delete;
export const findAllQueries = QueryUtils.findAll;
export const findQueryById = QueryUtils.findById;

export async function findQueryByName(name: string): Promise<LdkitQuery | null> {
  const items = await QueryUtils.findBy('name', name);
  return items[0] || null;
}
