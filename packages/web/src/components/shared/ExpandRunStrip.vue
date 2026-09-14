<template>
  <!--
    Keeps the run strip with the editor.

    An expanded editor covers the strip that runs it, and an editor you cannot
    run from is a reading view. The strip is a sibling of the editor rather
    than part of it, so it moves rather than being drawn twice: one RunBar
    instance, teleported into whichever region is popped out, with every choice
    on it still owned by the work area above.

    A single `Teleport` with `disabled` rather than a `v-if` pair, because the
    two branches of a `v-if` are two component instances — the strip would be
    rebuilt on the way in and again on the way out.
  -->
  <Teleport :to="host ?? 'body'" :disabled="!host">
    <slot />
  </Teleport>
</template>

<script setup lang="ts">
import { useEditorExpand } from '@/composables/useEditorExpand';

const { runHost: host } = useEditorExpand();
</script>
