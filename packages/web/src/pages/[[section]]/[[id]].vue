<template>
  <LibraryWorkspace />
</template>

<script setup lang="ts">
/**
 * The workspace, at `/`, `/<section>` and `/<section>/<record id>`.
 *
 * One page for all three rather than `index.vue` beside `[section]/[[id]].vue`:
 * two page components would unmount the whole workspace — rail, sidebar, the
 * open editor — on the first click away from the splash, and remount it on the
 * way back. The static key keeps one instance across every address it serves,
 * so moving between records is a change of selection, not a page load; the
 * workspace follows the route itself (`lib/sectionRoutes.ts`).
 */
// @ts-ignore - Nuxt auto-imports
import { definePageMeta } from '#imports';
import LibraryWorkspace from '../../components/workspace/LibraryWorkspace.vue';
import { parseSectionRoute } from '../../lib/sectionRoutes';

definePageMeta({
  key: 'workspace',
  // A first segment that names no section is a 404, not an empty workspace.
  validate: (route: { params: Record<string, unknown> }) => parseSectionRoute(route.params) !== undefined,
});
</script>
