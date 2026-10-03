import { createEntityUtilsWithFields } from './EntityUtils.js';
import { LibrarySchema, type LibraryEntity } from '../schemas/LibrarySchema.js';

const LibraryUtils = createEntityUtilsWithFields<LibraryEntity>(
  LibrarySchema,
  'Library'
);

export const Libraries = LibraryUtils.Repository;
export const createLibrary = LibraryUtils.create;
export const updateLibrary = LibraryUtils.update;
export const deleteLibrary = LibraryUtils.delete;
export const findAllLibraries = LibraryUtils.findAll;
export const findLibraryById = LibraryUtils.findById;

export async function findLibraryByName(name: string): Promise<LibraryEntity | null> {
  const libraries = await LibraryUtils.findBy('name', name);
  return libraries[0] || null;
}
