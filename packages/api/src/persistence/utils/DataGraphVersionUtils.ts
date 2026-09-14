import { createEntityUtilsWithFields } from './EntityUtils.js';
import { DataGraphVersionSchema, type LdkitDataGraphVersion } from '../schemas/DataGraphVersionSchema.js';
import { assertMutableEntity } from '../../lib/immutability.js';

const DataGraphVersionUtils = createEntityUtilsWithFields<LdkitDataGraphVersion>(
  DataGraphVersionSchema,
  'DataGraphVersion'
);

export const DataGraphVersions = DataGraphVersionUtils.Repository;
export const createDataGraphVersion = DataGraphVersionUtils.create;
export async function updateDataGraphVersion(id: string, updates: Partial<LdkitDataGraphVersion>): Promise<void> {
  const existing = await findDataGraphVersionById(id);
  assertMutableEntity('DataGraphVersion', existing as Record<string, unknown> | null);
  return DataGraphVersionUtils.update(id, updates);
}
export const deleteDataGraphVersion = DataGraphVersionUtils.delete;
export const findAllDataGraphVersions = DataGraphVersionUtils.findAll;
export const findDataGraphVersionById = DataGraphVersionUtils.findById;

export async function listVersionsForDataGraph(dataGraphId: string): Promise<LdkitDataGraphVersion[]> {
  const all = await DataGraphVersionUtils.findAll();
  return all
    .filter(v => v.isPartOf === dataGraphId)
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
}
