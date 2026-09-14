/**
 * Sending the model the tools for the screen it is on, not the whole list.
 *
 * Door A's first cheap win (issue #128 item 1, the *does not mirror* half of
 * plan §13). MCP advertises the catalogue once at session start and cannot
 * take it back without `listChanged` gymnastics; door A rebuilds the request
 * every step and, since #128 item 2, knows what the user has open. So a turn
 * about a query can be sent the query tools and not the rule-set ones. Tools
 * are the largest fixed cost in the request — they are re-sent, in full, on
 * every step of every turn — which is what makes halving them worth a file.
 *
 * Two rules keep this from being a footgun.
 *
 * **Narrowing hides, it never forbids.** The allowlist is still the whole of
 * what the assistant may do and the registry is still built over all of it
 * (`allowlist.ts`). A group left out of a turn is one `tools.enable` call from
 * being in it, and the prompt says so, naming the groups. A model that needs a
 * rule set while a query is open spends one step instead of failing — which is
 * the difference between an optimisation and a behaviour change.
 *
 * **It narrows only on a signal it has.** No context, or a context that does
 * not say what kind of thing is open, means no narrowing and a request byte
 * for byte the same as before this existed. Guessing the screen from a library
 * id would trade a certain token saving for an uncertain wrong answer.
 */
import {
  ASSISTANT_CORE_TOOLS,
  ASSISTANT_TOOL_GROUPS,
  type AssistantToolGroupName,
} from './allowlist.js';
import type { ModelTool } from './model.js';
import type { ScreenContext } from './screen-context.js';

/** The escape hatch, and the reason narrowing is safe to do at all. */
export const ENABLE_TOOLS_TOOL_NAME = 'tools.enable';

const GROUP_NAMES = Object.keys(ASSISTANT_TOOL_GROUPS) as AssistantToolGroupName[];

/**
 * Every tool that belongs to some group — and so the only tools narrowing can
 * take away.
 *
 * An allowlist entry in no group (`execute.run`, and the core list) is sent on
 * every turn. That is the fail-open direction on purpose: a tool nobody has
 * classified should keep working, not quietly vanish from a screen whose group
 * was never written.
 */
const GROUPED_TOOLS = new Set<string>(
  Object.values(ASSISTANT_TOOL_GROUPS).flatMap((group) => group.tools)
);

/**
 * What the entity open on screen is about.
 *
 * Matched on `openEntity.type`, which the browser fills from the row it came
 * from (`query`, `group`, `ruleset`) — the one field that says which *kind* of
 * work the turn is. `screen` is deliberately not used: today every screen that
 * sends a context sends `build`, which spans all three and would narrow to
 * everything.
 */
const GROUP_FOR_ENTITY_TYPE: Record<string, AssistantToolGroupName> = {
  query: 'queries',
  queries: 'queries',
  group: 'queryGroups',
  querygroup: 'queryGroups',
  'query-group': 'queryGroups',
  ruleset: 'rules',
  'rule-set': 'rules',
  rule: 'rules',
};

/**
 * Which groups a turn starts with, or null for "no usable signal, send
 * everything".
 *
 * Null rather than every group name so the caller can tell the two apart: a
 * turn that could not be narrowed gets the old request exactly, with no
 * `tools.enable` and no prompt paragraph about groups it already has.
 */
export function startingGroupsFor(
  context: ScreenContext | null | undefined
): AssistantToolGroupName[] | null {
  const type = context?.openEntity?.type?.trim().toLowerCase();
  if (!type) return null;
  const group = GROUP_FOR_ENTITY_TYPE[type];
  return group ? [group] : null;
}

/** The definition of `tools.enable`, built over whatever groups exist. */
export function enableToolsDefinition(): ModelTool {
  return {
    name: ENABLE_TOOLS_TOOL_NAME,
    description:
      'Add a group of tools to this conversation. You have been given the tools for what the user has open; call this when the tool you need is not in your list. The tools appear on your next step, so call this first and the tool you wanted after.',
    inputSchema: {
      type: 'object',
      properties: {
        group: {
          type: 'string',
          enum: GROUP_NAMES,
          description: 'The group to add.',
        },
      },
      required: ['group'],
      additionalProperties: false,
    },
  };
}

export type TurnToolSelection = {
  /** True when this turn is narrowed at all. */
  readonly narrowed: boolean;
  /** Whether a catalogue tool is in the turn's current set. */
  includes(name: string): boolean;
  /** The `tools.enable` definition, when narrowing is on. */
  extraTools(): ModelTool[];
  /**
   * Add a group. Returns the text the model gets back, and throws on a name
   * that is not a group — the enum should prevent it, but the model is the one
   * filling it in.
   */
  enable(group: unknown): string;
  /** The paragraph appended to the turn's system prompt, or ''. */
  prompt(): string;
};

/**
 * The turn's tool set, which only ever grows.
 *
 * Stateful and per turn: `runTurn` builds one and the loop reads it every
 * step, so a group enabled at step three is there at step four. It is never
 * shared between turns — the screen the next turn is sent from is a different
 * screen, and a set that accumulated across a session would end up as the full
 * list by the third question.
 */
export function createTurnToolSelection(
  context: ScreenContext | null | undefined
): TurnToolSelection {
  const starting = startingGroupsFor(context);
  const narrowed = starting !== null;
  const enabled = new Set<AssistantToolGroupName>(starting ?? GROUP_NAMES);

  const enabledTools = () => {
    const set = new Set<string>(ASSISTANT_CORE_TOOLS);
    for (const group of enabled) for (const tool of ASSISTANT_TOOL_GROUPS[group].tools) set.add(tool);
    return set;
  };

  return {
    narrowed,
    includes(name: string) {
      // Not narrowed means the registry's own membership is the only filter,
      // which is what it was before this file existed.
      if (!narrowed) return true;
      // Ungrouped tools are nobody's to remove; see GROUPED_TOOLS.
      if (!GROUPED_TOOLS.has(name)) return true;
      return enabledTools().has(name);
    },
    extraTools() {
      return narrowed ? [enableToolsDefinition()] : [];
    },
    enable(group: unknown) {
      const name = typeof group === 'string' ? group.trim() : '';
      if (!(name in ASSISTANT_TOOL_GROUPS)) {
        throw new Error(
          `${ENABLE_TOOLS_TOOL_NAME}: "${String(group)}" is not a tool group. Available: ${GROUP_NAMES.join(', ')}.`
        );
      }
      const typed = name as AssistantToolGroupName;
      if (enabled.has(typed)) {
        return `Group "${typed}" is already available; its tools are already in your list.`;
      }
      enabled.add(typed);
      return `Added "${typed}". Now available: ${ASSISTANT_TOOL_GROUPS[typed].tools.join(', ')}. Call one on your next step.`;
    },
    prompt() {
      if (!narrowed) return '';
      const missing = GROUP_NAMES.filter((group) => !enabled.has(group));
      if (missing.length === 0) return '';
      const lines = missing.map((group) => `- ${group}: ${ASSISTANT_TOOL_GROUPS[group].summary}`);
      return `\n\nYour tool list is the one for what the user has open, not everything you
may use. These groups also exist and are not in it yet:

${lines.join('\n')}

Call ${ENABLE_TOOLS_TOOL_NAME} with a group name to add one. Do that rather than
telling the user you cannot do something, or working around a tool you were not
handed — nothing here is off limits, it is only not loaded.`;
    },
  };
}
