import { createEntityUtilsWithFields } from './EntityUtils.js';
import { DataBlockVersionSchema, type LdkitDataBlockVersion } from '../schemas/DataBlockVersionSchema.js';
import { assertMutableEntity } from '../../lib/immutability.js';

const DataBlockVersionUtils = createEntityUtilsWithFields<LdkitDataBlockVersion>(
  DataBlockVersionSchema,
  'DataBlockVersion'
);

export const DataBlockVersions = DataBlockVersionUtils.Repository;
export const createDataBlockVersion = DataBlockVersionUtils.create;
export async function updateDataBlockVersion(id: string, updates: Partial<LdkitDataBlockVersion>): Promise<void> {
  const existing = await findDataBlockVersionById(id);
  assertMutableEntity('DataBlockVersion', existing as Record<string, unknown> | null);
  return DataBlockVersionUtils.update(id, updates);
}
export const deleteDataBlockVersion = DataBlockVersionUtils.delete;
export const findAllDataBlockVersions = DataBlockVersionUtils.findAll;
export const findDataBlockVersionById = DataBlockVersionUtils.findById;

export async function listVersionsForDataBlock(dataBlockId: string): Promise<LdkitDataBlockVersion[]> {
  const all = await DataBlockVersionUtils.findAll();
  return all
    .filter(v => v.isPartOf === dataBlockId)
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
}

export async function loadDataBlockVersionsByIds(ids: string[]): Promise<LdkitDataBlockVersion[]> {
  const out: LdkitDataBlockVersion[] = [];
  for (const id of ids) {
    const item = await findDataBlockVersionById(id);
    if (item) out.push(item);
  }
  return out;
}
