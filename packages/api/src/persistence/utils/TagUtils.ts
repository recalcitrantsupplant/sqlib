import { createEntityUtilsWithFields } from './EntityUtils.js';
import { TagSchema, type LdkitTag } from '../schemas/TagSchema.js';

const TagUtils = createEntityUtilsWithFields<LdkitTag>(
  TagSchema,
  'Tag'
);

export const Tags = TagUtils.Repository;
export const createTag = TagUtils.create;
export const updateTag = TagUtils.update;
export const deleteTag = TagUtils.delete;
export const findAllTags = TagUtils.findAll;
export const findTagById = TagUtils.findById;

export async function findTagByName(name: string): Promise<LdkitTag | null> {
  const items = await TagUtils.findBy('name', name);
  return items[0] || null;
}
