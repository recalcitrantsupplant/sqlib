<template>
  <!--
    The run, as one sentence.

    "Run *with* these inputs *against* this backend *as* this format" is one
    decision, not four controls that happen to share a strip — and it is the
    same decision that gets frozen when the pair beyond the rule becomes a test
    or a benchmark. So the whole thing is one unbroken row with Run at the head,
    the connectives set in italic muted type, and a single rule separating the
    recipe from what you can keep it as.
  -->
  <div class="run-bar" data-testid="run-bar">
    <div class="sentence">
      <div class="run-group">
        <button
          class="run-button"
          type="button"
          data-testid="run-bar-run"
          :disabled="runDisabled || running"
          :title="runTitle"
          @click="emit('run', null)"
        >
          <Loader2 v-if="running" :size="12" class="spin" /><Play
            v-else
            :size="12"
          />{{ running ? runningLabel : runLabel }}
        </button>
        <DropdownMenu v-if="runOptions.length">
          <DropdownMenuTrigger as-child>
            <button
              class="run-chevron"
              type="button"
              data-testid="run-bar-run-options"
              title="Run options"
              :disabled="runDisabled || running"
            >
              <ChevronDown :size="12" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              v-for="option in runOptions"
              :key="option.key"
              :disabled="option.disabled"
              @select="emit('run', option.key)"
            >
              {{ option.label }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <!--
        The inputs. Each one is a picker only in the sense that pressing it
        shows the panel where the choice is actually made — a tuple set and a
        data graph are documents, and a dropdown is not where you read one.
      -->
      <span v-if="inputs.length" class="clause">
        <span class="joiner">{{ withWord }}</span>
        <button
          v-for="pick in inputs"
          :key="pick.key"
          class="pick"
          type="button"
          :class="{ empty: pick.empty, inert: pick.inert }"
          :data-testid="`run-bar-${pick.key}`"
          :disabled="pick.disabled"
          :title="pick.title"
          @click="pick.inert ? undefined : emit('pick', pick.key)"
        >
          <component :is="iconFor(pick.icon)" v-if="pick.icon" :size="11" class="pick-icon" />
          <span v-if="pick.kind" class="pick-kind">{{ pick.kind }}</span>
          <span class="pick-value">{{ pick.empty ? (pick.emptyLabel ?? 'none') : pick.value }}</span>
          <ChevronDown v-if="!pick.inert" :size="11" class="pick-chevron" />
        </button>
      </span>

      <!--
        "against". Not every subject gets to choose: a rule set runs in an
        in-process store by construction, and a query group's nodes each name
        their own. Those say so as a fact rather than offering a dropdown with
        one entry, which would read as a choice that has been made for you.
      -->
      <span v-if="backend || backendPicks.length" class="clause">
        <span class="joiner">against</span>
        <button
          v-for="pick in backendPicks"
          :key="pick.key"
          class="pick"
          type="button"
          :class="{ empty: pick.empty, inert: pick.inert }"
          :data-testid="`run-bar-${pick.key}`"
          :disabled="pick.disabled"
          :title="pick.title"
          @click="pick.inert ? undefined : emit('pick', pick.key)"
        >
          <component :is="iconFor(pick.icon)" v-if="pick.icon" :size="11" class="pick-icon" />
          <span v-if="pick.kind" class="pick-kind">{{ pick.kind }}</span>
          <span class="pick-value">{{ pick.empty ? (pick.emptyLabel ?? 'none') : pick.value }}</span>
          <ChevronDown v-if="!pick.inert" :size="11" class="pick-chevron" />
        </button>
        <span
          v-if="backend?.readonly"
          class="chip inert"
          data-testid="run-bar-backend"
          :title="backend.title"
        >
          <Database :size="12" class="chip-icon" />{{ backend.label ?? labelOf(backend) }}
        </span>
        <Select
          v-else-if="backend"
          v-model:open="backendMenuOpen"
          :model-value="backend.value"
          :disabled="backend.disabled || backend.loading"
          @update:model-value="(value) => emit('update:backend', String(value))"
        >
          <SelectTrigger class="chip-select" data-testid="run-bar-backend" :title="backend.title">
            <Database :size="12" class="chip-icon" />
            <SelectValue placeholder="Backend" />
          </SelectTrigger>
          <!--
            A fixed width with the long labels faded out rather than ellipsised.
            An endpoint pasted here is its own name, and endpoint URLs are long
            and alike in their first half — a menu sized to the longest of them
            would be wider than the run sentence it hangs off, and `…` at the
            cut tells you nothing a fade does not.
          -->
          <SelectContent class="backend-menu">
            <SelectItem
              v-for="option in backend.options"
              :key="option.value"
              :value="option.value"
              class="backend-item"
            >
              <span class="backend-label">{{ option.label }}</span>
              <!--
                `aside` and not the default slot: the item's default slot is
                what the trigger reads back as the chosen value, so a button
                placed there is mirrored into the chip beside the backend name.
              -->
              <template #aside>
                <BrowserBackendName
                  v-if="isBrowserBackendId(option.value)"
                  :backend-id="option.value"
                  :current="option.label"
                />
              </template>
            </SelectItem>
            <InlineEndpointAdder @added="selectAddedBackend" />
          </SelectContent>
        </Select>
      </span>

      <span v-if="format" class="clause">
        <span class="joiner">as</span>
        <span
          v-if="format.readonly"
          class="chip inert"
          data-testid="run-bar-format"
          :title="format.title"
        >
          {{ format.label ?? labelOf(format) }}
        </span>
        <Select
          v-else
          :model-value="format.value"
          :disabled="format.disabled"
          @update:model-value="(value) => emit('update:format', String(value))"
        >
          <SelectTrigger class="chip-select" data-testid="run-bar-format" :title="format.title">
            <SelectValue placeholder="Format" />
          </SelectTrigger>
          <SelectContent>
            <template v-if="format.groups">
              <SelectGroup v-for="group in format.groups" :key="group.key">
                <SelectLabel class="format-category-label">{{ group.label }}</SelectLabel>
                <SelectItem
                  v-for="option in group.options"
                  :key="option.value"
                  :value="option.value"
                  :class="{ 'select-item-secondary': option.muted }"
                  :title="option.title"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectGroup>
            </template>
            <template v-else>
              <SelectItem
                v-for="option in format.options"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </template>
          </SelectContent>
        </Select>
      </span>

      <slot name="extra" />

      <!--
        One rule, and it separates the recipe from what the recipe can become.
        A test and a benchmark made from here are the same inputs, the same
        backend — the row above is literally their definition.
      -->
      <span v-if="visibleCreateTargets.length" class="clause">
        <span class="rule" />
        <span class="joiner">create</span>
        <div class="create-group">
          <button
            v-for="target in visibleCreateTargets"
            :key="target"
            class="create-button"
            type="button"
            :data-testid="`run-bar-create-${target}`"
            :disabled="Boolean(createDisabledReason[target]) || creating !== null"
            :title="createDisabledReason[target] ?? createTitles[target] ?? CREATE_TITLES[target](recipeNoun)"
            @click="emit('create', target)"
          >
            {{ creating === target ? 'Creating…' : target }}
          </button>
        </div>
      </span>
    </div>

    <slot name="trailing" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  ChevronDown,
  Database,
  FlaskConical,
  Gauge,
  Layers,
  Loader2,
  Play,
  Table,
  Variable,
} from '@lucide/vue';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { CREATE_TARGET_FEATURE } from '../../lib/runBar';
import type {
  CreateTarget,
  PickIcon,
  RunBarChoice,
  RunBarPick,
  RunOption,
} from '../../lib/runBar';
import { useFeatureFlags } from '../../composables/useFeatureFlags';
import { isBrowserBackendId } from '../../composables/useBrowserBackends';
import InlineEndpointAdder from './InlineEndpointAdder.vue';
import BrowserBackendName from './BrowserBackendName.vue';
import { useDeploymentMode } from '../../composables/useDeploymentMode';

const ICONS = {
  tuples: Table,
  data: Layers,
  arguments: Variable,
  cases: FlaskConical,
  strata: Layers,
  backends: Gauge,
} as const;

const CREATE_TITLES: Record<CreateTarget, (noun: string) => string> = {
  benchmark: (noun) => `Creates a benchmark from this recipe — the same ${noun}, the same backend, timed`,
  test: (noun) => `Creates a test from this recipe — the same ${noun}, the same backend, asserted result`,
};

const props = withDefaults(defineProps<{
  runLabel?: string;
  runningLabel?: string;
  running?: boolean;
  runDisabled?: boolean;
  runTitle?: string;
  /** Extra run variants behind a chevron. Empty means a plain Run button. */
  runOptions?: RunOption[];
  inputs?: RunBarPick[];
  /** The connective before the inputs. "with" everywhere but the odd screen. */
  withWord?: string;
  backend?: RunBarChoice | null;
  /**
   * "against", when the answer is a set of things rather than one choice.
   *
   * A benchmark runs against every backend on its axis; naming them with the
   * same picker vocabulary keeps one sentence rather than two spellings of it.
   */
  backendPicks?: RunBarPick[];
  format?: RunBarChoice | null;
  createTargets?: CreateTarget[];
  /** Per target: why it cannot be created, or null/absent when it can. */
  createDisabledReason?: Partial<Record<CreateTarget, string | null>>;
  creating?: CreateTarget | null;
  /** What the created object would freeze, in words: "inputs", "arguments". */
  recipeNoun?: string;
  /**
   * Per target: the hover text, when the generic phrasing is not the clearest
   * thing to say on this screen. Absent targets keep {@link CREATE_TITLES}.
   */
  createTitles?: Partial<Record<CreateTarget, string>>;
}>(), {
  runLabel: 'Run',
  runningLabel: 'Running…',
  running: false,
  runDisabled: false,
  runTitle: undefined,
  runOptions: () => [],
  inputs: () => [],
  withWord: 'with',
  backend: null,
  backendPicks: () => [],
  format: null,
  createTargets: () => [],
  createDisabledReason: () => ({}),
  creating: null,
  recipeNoun: 'inputs',
  createTitles: () => ({}),
});

const emit = defineEmits<{
  /** The head of the sentence. `optionKey` is null for the plain button. */
  (e: 'run', optionKey: string | null): void;
  /** A "with" pick was pressed — show the panel where that choice is made. */
  (e: 'pick', key: string): void;
  (e: 'update:backend', value: string): void;
  (e: 'update:format', value: string): void;
  (e: 'create', target: CreateTarget): void;
}>();

const { isEnabled } = useFeatureFlags();

/*
 * A read-only deployment holds neither a test nor a benchmark it was sent, so
 * the whole clause goes for the same reason a switched-off feature's does.
 * Running still works — only keeping the recipe does not.
 */
const deployment = useDeploymentMode();

/*
 * Held here so adding an endpoint can close the menu.
 *
 * A pasted endpoint is chosen by the act of pasting it — the row it would
 * otherwise leave you to find is the row you just made. The menu is open at
 * that moment and does not know a choice was made, because the choice came
 * from a field inside it rather than from one of its items.
 */
const backendMenuOpen = ref(false);

function selectAddedBackend(backendId: string) {
  emit('update:backend', backendId);
  backendMenuOpen.value = false;
}

/**
 * The targets this build can actually create.
 *
 * A caller says what its recipe *could* become; whether the feature that holds
 * the result is switched on is not the screen's question, and three screens
 * asking it separately is three places to forget. Absent rather than disabled,
 * for the reason the rail hides a section rather than greying it: a control
 * that can only refuse teaches nothing.
 */
const visibleCreateTargets = computed(() =>
  deployment.isReadOnly.value
    ? []
    : props.createTargets.filter((target) => isEnabled(CREATE_TARGET_FEATURE[target])),
);

const iconFor = (icon: PickIcon) => ICONS[icon];

/** A readonly choice usually carries `label`; fall back to its option list. */
const labelOf = (choice: RunBarChoice) =>
  choice.options.find((option) => option.value === choice.value)?.label ?? choice.value;
</script>

<style scoped>
.run-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-4);
  box-sizing: border-box;
  min-height: var(--panel-bar-h);
  /* `--space-2` rather than `--space-3`: a `--control-h` control plus the
     larger pad came to 41px, one over the band, and the bar is what sets the
     rule the results action bar has to meet. */
  padding: var(--space-2) var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.sentence {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  /*
   * Wraps rather than scrolls. The sentence is long by design and the columns
   * it sits in are not always wide; a horizontal scroller would hide the end of
   * it — which is the create pair, the half people do not already know is
   * there. Two lines is the honest failure mode.
   */
  flex-wrap: wrap;
  row-gap: var(--space-3);
  min-width: 0;
}

.clause {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}

.joiner {
  color: var(--ink-muted);
  font-size: var(--text-body);
  font-style: italic;
  white-space: nowrap;
}

/* -- Run ------------------------------------------------------------- */

.run-group {
  display: inline-flex;
  flex-shrink: 0;
}

.run-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h);
  padding: 0 var(--space-5);
  border: 1px solid var(--action);
  border-radius: var(--radius) 0 0 var(--radius);
  background: var(--action);
  color: var(--action-fg);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  cursor: pointer;
}

.run-group:not(:has(.run-chevron)) .run-button {
  border-radius: var(--radius);
}

.run-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: var(--control-h);
  border: 1px solid var(--action);
  border-left-color: var(--action-hover);
  border-radius: 0 var(--radius) var(--radius) 0;
  background: var(--action);
  color: var(--action-fg);
  cursor: pointer;
}

.run-button:hover:not(:disabled),
.run-chevron:hover:not(:disabled) {
  background: var(--action-hover);
  border-color: var(--action-hover);
}

.run-button:disabled,
.run-chevron:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.spin {
  animation: run-bar-spin 1s linear infinite;
}

@keyframes run-bar-spin {
  to { transform: rotate(360deg); }
}

/* -- The "with" picks ------------------------------------------------ */

.pick {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  white-space: nowrap;
  cursor: pointer;
}

.pick:hover:not(:disabled):not(.inert) {
  border-color: var(--border-hover);
  background: var(--surface-subtle);
}

.pick:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.pick.inert {
  cursor: default;
}

.pick-icon,
.chip-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.pick-kind {
  color: var(--ink-muted);
}

.pick-value {
  overflow: hidden;
  max-width: var(--grid-5);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick.empty .pick-value {
  /* Trailing room so the italic lean is not clipped by the value's overflow: hidden. */
  padding-right: 0.12em;
  color: var(--ink-muted);
  font-style: italic;
}

.pick-chevron {
  flex-shrink: 0;
  color: var(--ink-disabled);
}

/* -- "against" / "as" ------------------------------------------------ */

.chip-select {
  height: 26px;
  min-width: 0;
  max-width: var(--grid-7);
  gap: var(--space-3);
  flex-shrink: 0;
  padding: 0 var(--space-4);
  border: none;
  background: var(--surface-raised);
  color: var(--ink-secondary);
  font-size: var(--text-body);
}

.chip-select :deep(span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-select:hover {
  background: var(--border-default);
}

.chip {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
  height: 26px;
  padding: 0 var(--space-4);
  border-radius: var(--radius);
  background: var(--surface-raised);
  color: var(--ink-secondary);
  font-size: var(--text-body);
  white-space: nowrap;
}

.chip.inert {
  color: var(--ink-muted);
  cursor: help;
}

/* -- The pair beyond the rule ---------------------------------------- */

.rule {
  flex-shrink: 0;
  width: 1px;
  height: 22px;
  margin: 0 var(--space-2);
  background: var(--border-default);
}

.create-group {
  display: inline-flex;
  flex-shrink: 0;
}

.create-button {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: 0;
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  white-space: nowrap;
  cursor: pointer;
}

.create-button:first-child {
  border-radius: var(--radius) 0 0 var(--radius);
}

.create-button:last-child {
  border-radius: 0 var(--radius) var(--radius) 0;
}

.create-button:not(:first-child) {
  border-left: none;
}

.create-button:only-child {
  border-radius: var(--radius);
}

.create-button:hover:not(:disabled) {
  background: var(--surface-subtle);
  color: var(--ink);
}

.create-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}


</style>

<!--
  The backend menu, deliberately outside the scoped block.

  Its content is portalled to `body` by `SelectPortal`, and a teleported
  subtree does not carry this file's scope attribute — the rules below matched
  nothing at all while they lived in `<style scoped>`, which is why the menu
  kept sizing itself from the trigger. `.backend-menu` and the two classes
  under it are names this file owns, so the global surface is those three.
  The hover reveal for `+ name` is not here — that button belongs to
  `BrowserBackendName`, which writes the rule against the row itself.
-->
<style>
/*
 * One width for every row, whatever the URL in it. The label takes what is
 * left after the check column and the `+ name` button, and anything longer
 * dissolves into the edge instead of being cut with an ellipsis: endpoints
 * differ at their *end* far more often than at their start, so a fade says
 * "there is more" without pretending, as `…` does, that what is hidden is the
 * unimportant part.
 */
.backend-menu {
  width: 340px;
  max-width: calc(100vw - 32px);
}

.backend-menu .backend-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.backend-menu .backend-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent 100%);
}
</style>
