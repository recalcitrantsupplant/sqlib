import { createEntityUtilsWithFields } from './EntityUtils.js';
import { DataGraphSchema, type DataGraphEntity } from '../schemas/DataGraphSchema.js';

const DataGraphUtils = createEntityUtilsWithFields<DataGraphEntity>(
  DataGraphSchema,
  'DataGraph'
);

export const DataGraphs = DataGraphUtils.Repository;
export const createDataGraph = DataGraphUtils.create;
export const updateDataGraph = DataGraphUtils.update;
export const deleteDataGraph = DataGraphUtils.delete;
export const findAllDataGraphs = DataGraphUtils.findAll;
export const findDataGraphById = DataGraphUtils.findById;

export async function findDataGraphByName(name: string): Promise<DataGraphEntity | null> {
  const items = await DataGraphUtils.findBy('name', name);
  return items[0] || null;
}
