import { createEntityUtilsWithFields } from './EntityUtils.js';
import { PatchSchema, type PersistedPatch } from '../schemas/PatchSchema.js';

const PatchUtils = createEntityUtilsWithFields<PersistedPatch>(PatchSchema, 'Patch');

export const Patches = PatchUtils.Repository;
export const createPatch = PatchUtils.create;
export const updatePatch = PatchUtils.update;
export const deletePatch = PatchUtils.delete;
export const findAllPatches = PatchUtils.findAll;
export const findPatchById = PatchUtils.findById;
