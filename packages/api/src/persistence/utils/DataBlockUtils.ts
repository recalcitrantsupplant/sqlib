import { createEntityUtilsWithFields } from './EntityUtils.js';
import { DataBlockSchema, type LdkitDataBlock } from '../schemas/DataBlockSchema.js';

const DataBlockUtils = createEntityUtilsWithFields<LdkitDataBlock>(
  DataBlockSchema,
  'DataBlock'
);

export const DataBlocks = DataBlockUtils.Repository;
export const createDataBlock = DataBlockUtils.create;
export const updateDataBlock = DataBlockUtils.update;
export const deleteDataBlock = DataBlockUtils.delete;
export const findAllDataBlocks = DataBlockUtils.findAll;
export const findDataBlockById = DataBlockUtils.findById;

export async function findDataBlockByName(name: string): Promise<LdkitDataBlock | null> {
  const items = await DataBlockUtils.findBy('name', name);
  return items[0] || null;
}
