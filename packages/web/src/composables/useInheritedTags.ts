/**
 * The tags a new test would start with, taken from the subject it is about.
 *
 * The server is what actually applies them: `POST /tests` copies the subject's
 * tags whenever the body says nothing about `tags`, so that the four places the
 * UI creates a test from, the REST API and MCP all behave the same way. This
 * composable exists so the two screens that *ask* first can show what that
 * will mean — a checkbox whose label says "3 tags" is a promise, and a list
 * of the actual chips is the promise kept.
 *
 * It therefore mirrors the server's rule rather than owning it: the subject's
 * tags, minus any the current library does not hold. That subtraction is the
 * rule that a tag may only be applied inside its own library, and it matters
 * here because a test made from a record page falls back to the active library
 * when the subject names none, so the two can differ.
 *
 * Tags absent from the store are dropped, not rendered grey. The store holds
 * one library's vocabulary, so "not in it" and "not ours to copy" are the same
 * condition, and it is the same answer the server will reach.
 */
import { computed, type Ref } from 'vue';
import { useTagsStore } from './useTagsStore';
import { useEntityTags, type TaggableKind } from './useEntityTags';
import { normalizeTagColor, tagForeground } from '../lib/tagPalette';

/** One chip: what the toggle draws, already resolved to colours. */
export interface InheritedTag {
  id: string;
  name: string;
  color: string;
  ink: string;
}

/**
 * `subjectKind` and `subjectId` are refs because both change while a scratch
 * test is being written — switching the kind clears the subject — and the list
 * has to follow rather than be recomputed by every caller.
 */
export function useInheritedTags(
  subjectKind: Ref<TaggableKind | null>,
  subjectId: Ref<string | null>,
) {
  const tagsStore = useTagsStore();
  const entityTags = useEntityTags();

  const inheritedTags = computed<InheritedTag[]>(() => {
    const kind = subjectKind.value;
    const id = subjectId.value;
    if (!kind || !id) return [];
    return entityTags
      .tagsOf(kind, id)
      .map((tagId) => tagsStore.tagsById.value.get(tagId))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: normalizeTagColor(tag.color),
        ink: tagForeground(tag.color),
      }));
  });

  return { inheritedTags };
}
