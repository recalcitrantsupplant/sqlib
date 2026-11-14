<template>
  <span
    v-if="iri"
    class="person-chip"
    :class="{ compact }"
    :title="title"
    data-testid="person-chip"
  >
    <Avatar size="sm" :initials="initials" :tone="known ? 'default' : 'unknown'" />
    <span v-if="!compact" class="person-name" :class="{ unknown: !known }">{{ shownName }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * One person, as the `createdBy` and `modifiedBy` fields name them: initials
 * and a display name.
 *
 * - The signed-in caller reads "You".
 * - An IRI the server has no name for (a library loaded from another server,
 *   or a person whose token carried no name) shows a grey avatar and
 *   "Unknown".
 * - No IRI renders nothing, so the date beside the chip stands alone. That is
 *   every entity saved before authorship was recorded, or with auth off.
 *
 * `compact` shows the avatar only, with the name in the tooltip, for rows
 * with no room for a name.
 */
import { computed } from 'vue';
import Avatar from './Avatar.vue';
import { initialsOf } from '../../lib/account';
import { useAuth } from '../../composables/useAuth';
import { usePrincipalNames } from '../../composables/usePrincipalNames';

const props = withDefaults(
  defineProps<{
    iri?: string | null;
    compact?: boolean;
  }>(),
  { iri: null, compact: false },
);

const auth = useAuth();
const names = usePrincipalNames();

const isSelf = computed(() => !!props.iri && auth.me.value?.subject === props.iri);

const name = computed(() => {
  if (!props.iri) return undefined;
  if (isSelf.value && auth.me.value?.displayName) return auth.me.value.displayName;
  return names.nameOf(props.iri);
});

/** Still loading counts as known, so a chip does not flash grey on the way in. */
const known = computed(() => isSelf.value || name.value !== null);

const initials = computed(() => (name.value ? initialsOf({ name: name.value, email: null }) : ''));

const shownName = computed(() => {
  if (isSelf.value) return 'You';
  if (name.value === null) return 'Unknown';
  return name.value ?? '';
});

const title = computed(() => {
  if (name.value === null) return 'Not known on this server';
  if (isSelf.value) return name.value ? `${name.value} (you)` : 'You';
  return name.value ?? undefined;
});
</script>

<style scoped>
.person-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  color: var(--ink-secondary);
  white-space: nowrap;
}

.person-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.person-name.unknown {
  color: var(--ink-muted);
}
</style>
