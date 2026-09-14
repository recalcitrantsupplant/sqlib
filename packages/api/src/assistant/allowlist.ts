/**
 * What the in-app assistant is allowed to call, and why.
 *
 * This and the draft gate in `draft-tools.ts` are the two decisions hardest to
 * reverse, so the list is data with reasons attached rather than a filter
 * buried in a service.
 *
 * The rule is simple: **the assistant may read anything and write nothing.**
 * Every catalogue tool that mutates server state is absent — not disabled, not
 * gated behind a flag, absent — and the assistant's writes go through the
 * draft tools instead, which stage into the session and are saved by a
 * human. Creating a version *is* saving in this API (`POST /queries/:id/v`
 * sets `currentVersion`), which is exactly why the catalogue's own write tools
 * cannot be the assistant's.
 *
 * The list has a second job since #128 item 1: it is *grouped* by the kind of
 * thing a tool is about, so a turn can be sent the tools for what the user has
 * open instead of all of them. The grouping decides only what the model is
 * shown, never what it is permitted — the registry is still built over the
 * whole allowlist, and a group the turn did not start with is one tool call
 * away (`tool-narrowing.ts`). Nothing about the read/write rule above changes:
 * a tool absent from every group is a tool the assistant does not have.
 */

/** One concern's worth of tools, and the line the model is told about it. */
export type AssistantToolGroup = {
  /**
   * How the group is described to the model when it is deciding whether to
   * ask for it. Written as a capability rather than a category — "read and
   * check queries" tells it more than "queries".
   */
  summary: string;
  tools: readonly string[];
};

/**
 * Tools every turn gets, whatever is on screen.
 *
 * Deliberately small and deliberately not the interesting ones: which
 * libraries exist and which backends they run against are the questions any
 * answer eventually needs, and getting them wrong wastes a step for every
 * screen equally.
 */
export const ASSISTANT_CORE_TOOLS: readonly string[] = [
  // Grounding: what exists, and where.
  'libraries.list',
  'libraries.get',
  'backends.list',
  'backends.get',
  'backends.references',
];

/**
 * The rest of the allowlist, by the thing it is about.
 *
 * A group is what one screen's worth of work needs, so it is not a namespace
 * sweep: `queryGroups` carries the query readers too, because a group whose
 * members cannot be read is a list of ids.
 */
export const ASSISTANT_TOOL_GROUPS: Record<string, AssistantToolGroup> = {
  queries: {
    summary: 'Read queries, their versions and their argument sets; detect a body’s inputs and outputs; validate and format SPARQL.',
    tools: [
      'queries.list',
      'queries.get',
      'queries.listVersions',
      'queries.getVersion',
      'queries.listArgumentSets',

      'argumentSets.get',

      // Stating a signature instead of guessing at one, and checking a body
      // parses before claiming it works. §8 of the screen design asks for
      // exactly these.
      'detection.detectInputs',
      'detection.detectOutputs',
      'detection.validateQuery',
      'detection.format',
    ],
  },
  queryGroups: {
    summary: 'Read query groups — their versions, their wiring, and the queries they are built from — and validate a group version.',
    tools: [
      'queryGroups.list',
      'queryGroups.get',
      'queryGroups.listVersions',
      'queryGroups.getVersion',
      'queryGroups.validateVersion',

      // A group is made of queries; reading one without them is reading ids.
      'queries.list',
      'queries.get',
      'queries.getVersion',
    ],
  },
  rules: {
    summary: 'Read rules, rule sets and data blocks, normalise a rule, and validate rule data.',
    tools: [
      'rules.list',
      'rules.get',
      'rules.listVersions',
      'rules.getVersion',
      'rules.previewNormalize',

      'ruleSets.list',
      'ruleSets.get',
      'ruleSets.listVersions',
      'ruleSets.getVersion',

      'dataBlocks.list',
      'dataBlocks.get',
      'dataBlocks.listVersions',
      'dataBlocks.getVersion',

      'detection.validateRuleData',
    ],
  },
};

export type AssistantToolGroupName = keyof typeof ASSISTANT_TOOL_GROUPS;

/**
 * Catalogue tools the assistant may call directly.
 *
 * Derived from the groups rather than written twice: the registry is built
 * from this, so a tool that fell out of every group would silently stop being
 * callable at all rather than merely stop being offered. A test pins the set
 * against a literal list for the same reason.
 */
export const ASSISTANT_READ_TOOLS: readonly string[] = [
  ...new Set([
    ...ASSISTANT_CORE_TOOLS,
    ...Object.values(ASSISTANT_TOOL_GROUPS).flatMap((group) => group.tools),
  ]),
];

/**
 * Execution tools, held separately because they are the one place "read" is a
 * judgement rather than a fact.
 *
 * `execute.run` runs a *saved* artifact. If that artifact is an UPDATE the
 * user saved it deliberately, and §8 asks for `run` so the assistant can
 * verify before claiming success — so it is allowed by default.
 *
 * `sparql.proxyQuery` is not here at any setting. It takes arbitrary SPARQL and
 * `/sparql` executes UPDATEs, which would be a write channel straight to the
 * user's triplestore around the draft gate. The assistant runs a body it wrote
 * through `drafts.runQuery`, which refuses anything that is not a read.
 */
export const ASSISTANT_EXECUTION_TOOLS: readonly string[] = ['execute.run'];

/**
 * Tools that must never be assistant-callable, listed explicitly so a new
 * catalogue entry cannot quietly become reachable and so the test that guards
 * this has something to compare against.
 */
export const ASSISTANT_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /\.(create|update|delete)$/,
  /\.(createVersion|patchVersion|updateVersion|deleteVersion)$/,
  /^backends\.clearData$/,
  /^sparql\./,
  /^libraries\.export/,
  /^argumentSets\.(delete|export)$/,
  /^queries\.attachArgumentSet$/,
];

export type AllowlistOptions = {
  /** Include `execute.run`. Default true; see the note above. */
  allowExecution?: boolean;
};

export function assistantToolNames(options: AllowlistOptions = {}): string[] {
  const names = [...ASSISTANT_READ_TOOLS];
  if (options.allowExecution ?? true) names.push(...ASSISTANT_EXECUTION_TOOLS);
  return names;
}

/** True when a catalogue tool is one the assistant must never reach. */
export function isForbiddenForAssistant(name: string): boolean {
  return ASSISTANT_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(name));
}
