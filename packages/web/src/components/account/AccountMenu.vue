<template>
  <!--
    The account at the foot of the rail. The app has no top bar, so the rail
    is its only global chrome, and its foot is where rail-based apps keep the
    person who is signed in. Absent when there is no account to show: auth off,
    or a sign-in that has not happened yet (the login screen covers that).
  -->
  <DropdownMenu v-if="state !== 'none'">
    <DropdownMenuTrigger as-child>
      <button
        class="account-button"
        type="button"
        data-testid="account-button"
        :data-state-account="state"
        :title="buttonLabel"
        :aria-label="buttonLabel"
      >
        <Avatar :initials="initials" :tone="tone" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      side="right"
      :side-offset="6"
      class="w-max min-w-[320px] max-w-[480px]"
      data-testid="account-menu"
    >
      <div class="account-head">
        <Avatar :initials="initials" :tone="tone" size="lg" />
        <div class="account-who">
          <span class="account-name" data-testid="account-name">{{ displayName }}</span>
          <span v-if="identity.email && identity.name" class="account-email">{{ identity.email }}</span>
          <span v-if="host" class="account-meta">{{ host }}</span>
        </div>
      </div>

      <div v-if="groups.length" class="account-groups" data-testid="account-groups">
        <span v-for="group in groups" :key="group" class="account-chip">
          <Users :size="12" aria-hidden="true" />{{ group }}
        </span>
      </div>

      <template v-if="libraryRows.length || backendRows.length">
        <DropdownMenuSeparator />
        <div class="account-access" data-testid="account-access">
          <span class="access-heading">Access</span>
          <div class="access-table">
            <template v-if="libraryRows.length">
              <div class="access-columns">
                <SectionLabel>Library</SectionLabel>
                <SectionLabel class="access-span">Role</SectionLabel>
              </div>
              <DropdownMenuItem
                v-for="row in libraryRows"
                :key="row.iri"
                class="access-row"
                data-testid="account-access-library"
                @select="openLibrary(row.iri)"
              >
                <span class="access-name">{{ row.name }}</span>
                <span class="access-span access-chips">
                  <span
                    v-for="chip in row.chips"
                    :key="chip.label"
                    class="grant-chip"
                    :class="`grant-chip--${chip.tone}`"
                    :title="chip.title"
                  >{{ chip.label }}</span>
                </span>
              </DropdownMenuItem>
            </template>
            <template v-if="backendRows.length">
              <div class="access-columns" :class="{ 'access-columns--gap': libraryRows.length }">
                <SectionLabel>Backend</SectionLabel>
                <SectionLabel>Query</SectionLabel>
                <SectionLabel>Update</SectionLabel>
              </div>
              <DropdownMenuItem
                v-for="row in backendRows"
                :key="row.iri"
                class="access-row"
                data-testid="account-access-backend"
                @select="openBackend(row.iri)"
              >
                <span class="access-name">{{ row.name }}</span>
                <span
                  v-for="chip in row.chips"
                  :key="chip.label + chip.tone"
                  class="grant-chip"
                  :class="`grant-chip--${chip.tone}`"
                >{{ chip.label }}</span>
              </DropdownMenuItem>
            </template>
          </div>
        </div>
      </template>

      <template v-if="state !== 'guest'">
        <DropdownMenuSeparator />
        <DropdownMenuItem
          v-if="tokenAvailable"
          :title="`Copies export ${TOKEN_ENV}=… for your terminal`"
          data-testid="account-copy-token"
          @select="copyToken()"
        >
          <KeyRound :size="14" aria-hidden="true" />Copy API token
          <span v-if="expiresLabel" class="token-expiry" data-testid="account-token-expiry">until {{ expiresLabel }}</span>
        </DropdownMenuItem>
        <DropdownMenuItem v-if="state === 'expired'" data-testid="account-sign-in" @select="login()">
          <LogIn :size="14" aria-hidden="true" />Sign in again
        </DropdownMenuItem>
        <DropdownMenuItem v-else data-testid="account-sign-out" @select="logout()">
          <LogOut :size="14" aria-hidden="true" />Sign out
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { KeyRound, LogIn, LogOut, Users } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import Avatar from '../shared/Avatar.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import { useAuth } from '../../composables/useAuth';
import { useApiTokenCopy } from '../../composables/useApiTokenCopy';
import { TOKEN_ENV } from '../../lib/codeSnippets';
import { useActiveLibrary } from '../../composables/useActiveLibrary';
import { useBackendsStore } from '../../composables/useBackendsStore';
import { initialsOf, issuerHost } from '../../lib/account';
import { backendLevelChip, libraryGrantChips } from '../../lib/accessModel';
import { sectionPath } from '../../lib/sectionRoutes';
import { useRouter } from '#imports';

const { account, me, login, logout } = useAuth();
const { available: tokenAvailable, expiresLabel, copyToken } = useApiTokenCopy();
const { libraries } = useActiveLibrary();
const { backends } = useBackendsStore();
const router = useRouter();

const state = computed(() => account.value.state);
const identity = computed(() => account.value.identity);
const initials = computed(() => initialsOf(identity.value));
const tone = computed(() =>
  state.value === 'guest' ? 'guest' : state.value === 'expired' ? 'warning' : 'default');

const displayName = computed(() =>
  state.value === 'guest' ? 'Guest user' : identity.value.name ?? identity.value.email ?? 'Signed in');

const buttonLabel = computed(() => {
  if (state.value === 'guest') return 'Guest user';
  if (state.value === 'expired') return `Session expired — ${displayName.value}`;
  return `Account — ${displayName.value}`;
});

const host = computed(() => (state.value === 'guest' ? null : issuerHost(me.value?.issuer)));

const groups = computed(() =>
  (me.value?.groups ?? []).map((group) => group.name).filter((name): name is string => Boolean(name)));

/** The tail of an IRI, for a resource this client has not loaded a name for. */
function shortName(iri: string): string {
  return iri.split(/[/#:]/).filter(Boolean).pop() ?? iri;
}

const libraryRows = computed(() =>
  Object.entries(me.value?.libraries ?? {})
    .filter(([, modes]) => modes.length > 0)
    .map(([iri, modes]) => ({
      iri,
      name: libraries.value.find((library) => library.id === iri)?.name ?? shortName(iri),
      chips: libraryGrantChips(modes),
    }))
    .sort((a, b) => a.name.localeCompare(b.name)));

const backendRows = computed(() =>
  Object.entries(me.value?.backends ?? {})
    .filter(([, modes]) => modes.length > 0)
    .map(([iri, modes]) => ({
      iri,
      name: backends.value.find((backend) => backend.id === iri)?.name ?? shortName(iri),
      chips: [backendLevelChip(modes, 'query'), backendLevelChip(modes, 'update')],
    }))
    .sort((a, b) => a.name.localeCompare(b.name)));

/** The Library page for one library, which becomes the active one. */
function openLibrary(iri: string) {
  void router?.push({ path: '/library', query: { library: iri } });
}

function openBackend(iri: string) {
  void router?.push({ path: sectionPath({ section: 'backends', id: iri }) });
}
</script>

<style scoped>
.account-button {
  width: 44px;
  height: var(--control-h-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-panel);
  background: transparent;
  cursor: pointer;
}

.account-button:hover,
.account-button[data-state='open'] {
  background: var(--action-surface);
}

.account-head {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-5) var(--space-5) var(--space-4);
}

.account-who {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.account-name {
  color: var(--ink);
  font-size: var(--text-content);
  font-weight: var(--weight-semibold);
}

.account-email,
.account-meta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.account-email {
  color: var(--ink-secondary);
  font-size: var(--text-body);
}

.account-meta {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.account-groups {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 0 var(--space-5) var(--space-5);
}

.account-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--ink-secondary);
  font-size: var(--text-label);
}

.account-access {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-1);
}

.access-heading {
  padding: 0 var(--space-4);
  color: var(--ink);
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
}

/* Name, then one column per grant. Rows and column labels share the tracks. */
.access-table {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  column-gap: var(--space-6);
}

.access-columns,
.access-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  padding: var(--space-2) var(--space-4);
}

.access-columns--gap {
  margin-top: var(--space-4);
}

.access-span {
  grid-column: 2 / -1;
}

.access-row {
  font-size: var(--text-body);
  cursor: pointer;
}

.access-name {
  color: var(--ink);
  overflow-wrap: anywhere;
}

.access-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.grant-chip {
  justify-self: start;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  font-weight: var(--weight-medium);
  white-space: nowrap;
}

.grant-chip--view { background: var(--grant-view-surface); color: var(--grant-view-ink); }
.grant-chip--run { background: var(--grant-run-surface); color: var(--grant-run-ink); }
.grant-chip--edit { background: var(--grant-edit-surface); color: var(--grant-edit-ink); }
.grant-chip--manage { background: var(--grant-manage-surface); color: var(--grant-manage-ink); }
.grant-chip--adhoc { background: var(--grant-adhoc-surface); color: var(--grant-adhoc-ink); }
.grant-chip--saved { background: var(--grant-saved-surface); color: var(--grant-saved-ink); }
.grant-chip--none { color: var(--grant-none-ink); font-weight: var(--weight-normal); }

.token-expiry {
  margin-left: auto;
  padding-left: var(--space-4);
  color: var(--ink-muted);
  font-size: var(--text-label);
}
</style>
