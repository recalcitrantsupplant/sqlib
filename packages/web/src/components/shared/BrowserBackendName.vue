<script setup lang="ts">
/**
 * Give a pasted endpoint a name, from the row that shows it.
 *
 * The second half of `InlineEndpointAdder`, and deliberately a separate step:
 * a URL is enough to run against, so nothing asks for a name until someone
 * wants one. `+ name` is the same gesture as `+ prefix` on a result cell —
 * the edit sits next to the thing it applies to, and Enter commits.
 *
 * Only browser backends get it. A server-side backend is renamed where the
 * rest of its fields are, and on a read-only deployment cannot be renamed at
 * all, so a button here would be offering a refusal.
 */
import { nextTick, ref } from 'vue';
import { useBackendsStore } from '@/composables/useBackendsStore';
import { useBrowserBackends } from '@/composables/useBrowserBackends';
import { endpointDisplayName } from '@/lib/endpointUrl';

const props = defineProps<{
  backendId: string;
  /** What the row reads now — the URL until it has been named. */
  current: string;
}>();

const browserBackends = useBrowserBackends();
const backendsStore = useBackendsStore();

const open = ref(false);
const draft = ref('');
const inputEl = ref<HTMLInputElement | null>(null);

async function start() {
  const record = browserBackends.get(props.backendId);
  /*
   * Empty while the endpoint is still called after its URL: the field is for
   * the name it does not have yet, and handing back a URL to edit invites
   * editing the wrong thing. A name it already has is offered for correction.
   */
  const unnamed = !record || record.name === endpointDisplayName(record.endpoint);
  draft.value = unnamed ? '' : record!.name;
  open.value = true;
  await nextTick();
  inputEl.value?.focus();
  inputEl.value?.select();
}

function cancel() {
  open.value = false;
  draft.value = '';
}

/**
 * Commit the name, once.
 *
 * Closing first is load-bearing: removing a focused input fires `blur`, so a
 * submit that closed afterwards was immediately re-entered by its own unmount
 * — the second pass carried the cleared draft, and an empty name means "call
 * it after its URL", which is how a just-named endpoint went straight back to
 * being a URL.
 */
function submit() {
  if (!open.value) return;
  const name = draft.value.trim();
  open.value = false;
  draft.value = '';

  const record = browserBackends.get(props.backendId);
  if (!record) return;
  browserBackends.save({ ...record, name });
  void backendsStore.loadBackends();
}
</script>

<template>
  <!--
    Every pointer event a Select acts on is stopped here, not just the ones a
    button normally cares about: the row above chooses itself on `pointerup`,
    so a `click`-only guard let `+ name` pick the backend and close the menu
    before the field it opens had rendered.
  -->
  <span
    class="browser-backend-name"
    @keydown.stop
    @pointerdown.stop
    @pointerup.stop
    @mouseup.stop
  >
    <button
      v-if="!open"
      type="button"
      class="name-trigger"
      :title="`Name ${current}`"
      data-testid="backend-name-endpoint"
      @click.stop="start"
    >
      + name
    </button>

    <input
      v-else
      ref="inputEl"
      v-model="draft"
      type="text"
      class="name-input"
      placeholder="Wikidata"
      spellcheck="false"
      autocomplete="off"
      aria-label="Backend name"
      data-testid="backend-name-input"
      @click.stop
      @keydown.enter.prevent="submit"
      @keydown.esc.prevent="cancel"
      @blur="submit"
    >
  </span>
</template>

<style scoped>
.browser-backend-name {
  display: inline-flex;
  align-items: center;
  flex: none;
}

.name-trigger {
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--action);
  font-family: inherit;
  font-size: var(--text-micro);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
}

/* The row-hover half of the reveal is the unscoped block at the end. */
.name-trigger:focus-visible {
  opacity: 1;
}

@media (hover: none) {
  .name-trigger {
    opacity: 1;
  }
}

.name-input {
  width: 12ch;
  height: 22px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-micro);
  color: inherit;
}

.name-input:focus-visible {
  outline: 2px solid var(--action);
  outline-offset: -1px;
}
</style>

<!--
  The row-hover reveal, outside the scoped block for the reason
  `InlinePrefixAdder`'s is: `.backend-item` is a row `RunBar` renders, so the
  ancestor half of this selector can never carry this file's scope attribute.
  `.name-trigger` is a class this file owns, which keeps the global surface to
  one name.
-->
<style>
.backend-item:hover .name-trigger,
.backend-item[data-highlighted] .name-trigger {
  opacity: 1;
}
</style>
