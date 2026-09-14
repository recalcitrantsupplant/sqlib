import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, triggerRef, type ComputedRef } from 'vue';

import { parseBinding } from '../lib/keys';

/**
 * Every action the app can perform, in one list.
 *
 * The keyboard is not the point — the registry is. A command is declared once
 * with a title, an optional binding and a predicate for when it applies, and
 * three consumers read the same declaration: the key dispatcher
 * (`plugins/commands.client.ts`), the command palette, and the shortcut cheat
 * sheet. That is what keeps "run the query" a single implementation whether it
 * was reached by Ctrl+Enter, by the palette, or by the Run button calling
 * `execute('query.run')` — and what makes an action without a binding still
 * reachable from the keyboard, which is most of them.
 *
 * Registration is scoped. A component registers in `setup` through
 * `useCommand`, and the command disappears when that component unmounts, so
 * "Save query" simply does not exist while no query is open — no `when`
 * predicate needed, no stale callback holding a dead component's state.
 */

/** The palette's headings, in the order they are shown. */
export const COMMAND_GROUPS = ['Go to', 'Query', 'Query group', 'Run', 'View', 'Help'] as const;

export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface Command {
  /** Stable dotted id — `'query.run'`. Also the handle `execute` takes. */
  id: string;
  title: string;
  group: CommandGroup;
  /**
   * Binding(s), in the vocabulary of `lib/keys.ts`: `'Mod+Enter'`, `'g q'`.
   * The first is the one shown; the rest are aliases.
   */
  keys?: string | string[];
  /** Extra words the palette should match on but not show. */
  keywords?: string;
  /**
   * Whether the command applies right now. A command that is registered but
   * not applicable is hidden from the palette and its binding does not fire —
   * the event falls through to the browser rather than being swallowed.
   */
  when?: () => boolean;
  /** Kept out of the palette (the palette's own toggle, mainly). */
  hidden?: boolean;
  run: () => unknown;
}

/**
 * A late-bound source of commands — the queries and query groups in the open
 * library, for instance, which are too many and too changeable to register one
 * by one. Providers are asked only when the palette opens, and their commands
 * are never bound to keys.
 */
export type CommandProvider = () => Command[];

/*
 * Module state, deliberately: the registry is the app's action table, and a
 * per-component instance of it would mean the dispatcher and the palette
 * disagreeing about what exists. `shallowRef` over a Map because the values
 * are opaque objects — nothing benefits from deep reactivity, and commands
 * closing over big stores would pay for it.
 */
const registry = shallowRef(new Map<string, Command>());
const providers = ref<CommandProvider[]>([]);

function touch(): void {
  triggerRef(registry);
}

/** Dev-only warnings; `import.meta.env` is Vite's in the app and vitest's in a spec. */
const isDev = (): boolean => Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

export function registerCommand(command: Command): () => void {
  if (isDev() && registry.value.has(command.id)) {
    console.warn(`[commands] '${command.id}' is already registered; the newer registration wins.`);
  }
  registry.value.set(command.id, command);
  touch();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    // Only if it is still ours: a re-registration under the same id (a
    // remounting component) must not be unregistered by the old owner.
    if (registry.value.get(command.id) === command) {
      registry.value.delete(command.id);
      touch();
    }
  };
}

export function registerCommandProvider(provider: CommandProvider): () => void {
  providers.value = [...providers.value, provider];
  return () => {
    providers.value = providers.value.filter((entry) => entry !== provider);
  };
}

/**
 * Register commands for the lifetime of the calling effect scope.
 *
 * Called from a component's `setup`, the commands go away on unmount. Called
 * outside a scope (a plugin, a test), they stay for good and the returned
 * disposer is the only way out.
 */
export function useCommand(command: Command | Command[]): () => void {
  const list = Array.isArray(command) ? command : [command];
  const disposers = list.map(registerCommand);
  const dispose = () => disposers.forEach((off) => off());
  if (getCurrentScope()) onScopeDispose(dispose);
  return dispose;
}

/** Register a provider for the lifetime of the calling effect scope. */
export function useCommandProvider(provider: CommandProvider): () => void {
  const dispose = registerCommandProvider(provider);
  if (getCurrentScope()) onScopeDispose(dispose);
  return dispose;
}

/** Test seam: module state has to be clearable between specs. */
export function resetCommandsForTest(): void {
  registry.value = new Map();
  providers.value = [];
}

const groupRank = (group: CommandGroup): number => {
  const index = COMMAND_GROUPS.indexOf(group);
  return index === -1 ? COMMAND_GROUPS.length : index;
};

export function isAvailable(command: Command): boolean {
  try {
    return command.when ? command.when() !== false : true;
  } catch (error) {
    // A throwing predicate is a bug in the caller, not a reason to lose the
    // rest of the palette.
    console.error(`[commands] '${command.id}' when() threw`, error);
    return false;
  }
}

export interface CommandRegistry {
  /** Everything registered, applicable or not — the cheat sheet's source. */
  all: ComputedRef<Command[]>;
  /** The applicable subset, sorted by group then title. */
  available: ComputedRef<Command[]>;
  /** `available` plus whatever the providers offer. For the palette only. */
  palette: () => Command[];
  register: typeof registerCommand;
  registerProvider: typeof registerCommandProvider;
  /** Run a command by id. Returns false when it is missing or inapplicable. */
  execute: (id: string) => boolean;
  /** The applicable command whose binding is exactly this run of chords. */
  matchSequence: (chords: readonly string[]) => Command | null;
  /** Whether an applicable binding continues past `chords` — `'g'`, mid-`'g q'`. */
  isSequencePrefix: (chords: readonly string[]) => boolean;
}

const byGroupThenTitle = (a: Command, b: Command): number =>
  groupRank(a.group) - groupRank(b.group) || a.title.localeCompare(b.title);

function bindingsOf(command: Command): string[][] {
  if (!command.keys) return [];
  const keys = Array.isArray(command.keys) ? command.keys : [command.keys];
  return keys.map((binding) => parseBinding(binding));
}

export function useCommandRegistry(): CommandRegistry {
  const all = computed(() => [...registry.value.values()].sort(byGroupThenTitle));
  /*
   * A computed rather than a filter at each call site, and it stays correct
   * because evaluating it *calls* every `when()` — so whatever reactive state
   * those predicates read is tracked, and a run finishing or a draft going
   * dirty invalidates this list. A predicate reading something non-reactive
   * (the DOM, say) is the exception: it is re-read whenever anything else
   * invalidates, which is enough for the palette and the cheat sheet.
   */
  const available = computed(() => all.value.filter(isAvailable));

  const palette = (): Command[] => {
    const dynamic = providers.value.flatMap((provider) => {
      try {
        return provider();
      } catch (error) {
        console.error('[commands] a provider threw', error);
        return [];
      }
    });
    return [...available.value, ...dynamic.filter(isAvailable)].filter((command) => !command.hidden);
  };

  const execute = (id: string): boolean => {
    const command = registry.value.get(id);
    if (!command || !isAvailable(command)) return false;
    void Promise.resolve(command.run()).catch((error) => {
      console.error(`[commands] '${id}' failed`, error);
    });
    return true;
  };

  const isSequencePrefix = (chords: readonly string[]): boolean =>
    available.value.some((command) =>
      bindingsOf(command).some((steps) =>
        steps.length > chords.length && chords.every((chord, i) => steps[i] === chord)));

  const matchSequence = (chords: readonly string[]): Command | null =>
    available.value.find((command) =>
      bindingsOf(command).some((steps) =>
        steps.length === chords.length && chords.every((chord, i) => steps[i] === chord))) ?? null;

  return {
    all,
    available,
    palette,
    register: registerCommand,
    registerProvider: registerCommandProvider,
    execute,
    matchSequence,
    isSequencePrefix,
  };
}
