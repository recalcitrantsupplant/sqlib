import { createEntityUtilsWithFields } from './EntityUtils.js';
import { TupleSetSchema, type LdkitTupleSet } from '../schemas/TupleSetSchema.js';
import { TupleSetVersionSchema, type LdkitTupleSetVersion } from '../schemas/TupleSetVersionSchema.js';

const TupleSetUtils = createEntityUtilsWithFields<LdkitTupleSet>(
  TupleSetSchema,
  'TupleSet'
);

export const TupleSets = TupleSetUtils.Repository;
export const createTupleSet = TupleSetUtils.create;
export const updateTupleSet = TupleSetUtils.update;
export const deleteTupleSet = TupleSetUtils.delete;
export const findAllTupleSets = TupleSetUtils.findAll;
export const findTupleSetById = TupleSetUtils.findById;

export async function findTupleSetByName(name: string): Promise<LdkitTupleSet | null> {
  const items = await TupleSetUtils.findBy('name', name);
  return items[0] || null;
}

const TupleSetVersionUtils = createEntityUtilsWithFields<LdkitTupleSetVersion>(
  TupleSetVersionSchema,
  'TupleSetVersion'
);

export const TupleSetVersions = TupleSetVersionUtils.Repository;
export const createTupleSetVersion = TupleSetVersionUtils.create;
export const updateTupleSetVersion = TupleSetVersionUtils.update;
export const deleteTupleSetVersion = TupleSetVersionUtils.delete;
export const findAllTupleSetVersions = TupleSetVersionUtils.findAll;
export const findTupleSetVersionById = TupleSetVersionUtils.findById;
