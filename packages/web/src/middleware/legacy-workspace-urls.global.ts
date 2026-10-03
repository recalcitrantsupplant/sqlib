/**
 * Old workspace links, to their new addresses.
 *
 * The workspace used to be one page at `/` that read the section and the open
 * record from query parameters (`/?section=rules&ruleSet=…`). Bookmarks, shared
 * links and the docs still carry that shape, so for one release a link of it is
 * redirected to the path that now names the same thing (`lib/sectionRoutes.ts`).
 */
// @ts-ignore - Nuxt auto-imports
import { defineNuxtRouteMiddleware, navigateTo } from '#imports';
import { legacyRedirect, type RoutedSection } from '../lib/sectionRoutes';
import { listSectionForDraftSection } from '../lib/sections';
import { useCallableDrafts } from '../composables/useCallableDrafts';

/** A scratch link that names no section goes where this browser holds the record. */
function scratchSection(id: string): RoutedSection | null {
  const record = useCallableDrafts().get(id);
  return record ? listSectionForDraftSection(record.section) : null;
}

export default defineNuxtRouteMiddleware((to: { path: string; query: Record<string, unknown> }) => {
  if (to.path !== '/') return;
  const target = legacyRedirect(to.query, scratchSection);
  if (!target) return;
  return navigateTo({ path: target.path, query: target.query }, { replace: true });
});
