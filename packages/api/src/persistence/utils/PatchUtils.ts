import { createEntityUtilsWithFields } from './EntityUtils.js';
import { PatchSchema, type PatchEntity } from '../schemas/PatchSchema.js';

const PatchUtils = createEntityUtilsWithFields<PatchEntity>(PatchSchema, 'Patch');

export const Patches = PatchUtils.Repository;
export const createPatch = PatchUtils.create;
export const updatePatch = PatchUtils.update;
export const deletePatch = PatchUtils.delete;
export const findAllPatches = PatchUtils.findAll;
export const findPatchById = PatchUtils.findById;
