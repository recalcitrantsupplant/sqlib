<template>
  <!--
    What a share link will carry, ticked by default, and the one action. The
    query always goes; arguments and backend can be left out, so the plainest
    link is the query alone. Each row says whether it travels as a link to a
    saved record or as its content (`lib/shareLink.ts`), because that decides
    what a recipient without access will see.
  -->
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        class="icon-control"
        data-testid="share-link-menu"
        title="Share a link to this query"
        :disabled="disabled"
      >
        <Link :size="16" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="share-menu">
      <DropdownMenuLabel>Share link</DropdownMenuLabel>
      <DropdownMenuCheckboxItem :model-value="true" disabled data-testid="share-query">
        {{ parts.query }}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        v-if="parts.arguments"
        v-model="includeArguments"
        data-testid="share-arguments"
        @select.prevent
      >
        {{ parts.arguments }}
      </DropdownMenuCheckboxItem>
      <template v-if="parts.backend">
        <DropdownMenuCheckboxItem
          v-model="includeBackend"
          data-testid="share-backend"
          @select.prevent
        >
          {{ parts.backend.label }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          v-if="parts.backend.canSendEndpoint"
          v-model="backendAsEndpoint"
          :disabled="!includeBackend"
          class="share-sub"
          data-testid="share-backend-endpoint"
          title="For someone who cannot see this backend: their browser adds the endpoint as a backend of its own. The link then shows the endpoint's address."
          @select.prevent
        >
          Send its endpoint URL instead
        </DropdownMenuCheckboxItem>
      </template>
      <DropdownMenuSeparator />
      <DropdownMenuItem data-testid="copy-share-link" @select="copy">
        <Copy :size="14" />Copy link
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
/**
 * The share control in a save bar: a menu of what the link carries, and Copy.
 *
 * It decides nothing about the content. The work area says which parts exist
 * and how each would travel; this collects which of them to include and hands
 * that back.
 */
import { ref } from 'vue';
import { Copy, Link } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export interface ShareLinkParts {
  /** How the query travels, in words. */
  query: string;
  /** How the arguments travel, or null when none are chosen. */
  arguments: string | null;
  backend: {
    label: string;
    /** A backend that has an endpoint the recipient's browser could add. */
    canSendEndpoint: boolean;
  } | null;
}

export interface ShareLinkChoice {
  includeArguments: boolean;
  includeBackend: boolean;
  backendAsEndpoint: boolean;
}

defineProps<{
  parts: ShareLinkParts;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'copy', choice: ShareLinkChoice): void;
}>();

const includeArguments = ref(true);
const includeBackend = ref(true);
// Off by default: a reference opens only for people who can see the backend,
// and keeps its address out of the link.
const backendAsEndpoint = ref(false);

function copy() {
  emit('copy', {
    includeArguments: includeArguments.value,
    includeBackend: includeBackend.value,
    backendAsEndpoint: backendAsEndpoint.value,
  });
}
</script>

<style scoped>
.share-menu {
  min-width: 260px;
}

.share-sub {
  padding-left: var(--space-9);
}
</style>
