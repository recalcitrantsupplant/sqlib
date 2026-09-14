import { createEntityUtilsWithFields } from './EntityUtils.js';
import { DataGraphSchema, type LdkitDataGraph } from '../schemas/DataGraphSchema.js';

const DataGraphUtils = createEntityUtilsWithFields<LdkitDataGraph>(
  DataGraphSchema,
  'DataGraph'
);

export const DataGraphs = DataGraphUtils.Repository;
export const createDataGraph = DataGraphUtils.create;
export const updateDataGraph = DataGraphUtils.update;
export const deleteDataGraph = DataGraphUtils.delete;
export const findAllDataGraphs = DataGraphUtils.findAll;
export const findDataGraphById = DataGraphUtils.findById;

export async function findDataGraphByName(name: string): Promise<LdkitDataGraph | null> {
  const items = await DataGraphUtils.findBy('name', name);
  return items[0] || null;
}
