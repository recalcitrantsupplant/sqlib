import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_CORE_TOOLS,
  ASSISTANT_READ_TOOLS,
  ASSISTANT_TOOL_GROUPS,
  assistantToolNames,
} from '../../src/assistant/allowlist.js';
import {
  ENABLE_TOOLS_TOOL_NAME,
  createTurnToolSelection,
  startingGroupsFor,
} from '../../src/assistant/tool-narrowing.js';

/**
 * Narrowing is an optimisation, so the tests that matter are the ones that
 * prove it did not become a behaviour change: the allowlist is the same set it
 * was, nothing is reachable that was not, and nothing that was reachable has
 * become unreachable rather than merely unlisted.
 */

/**
 * The allowlist as it stood before it was grouped.
 *
 * Pinned as a literal because `ASSISTANT_READ_TOOLS` is now derived: a tool
 * dropped from every group would leave the registry entirely, which is a
 * permission change wearing an optimisation's clothes.
 */
const ALLOWLIST_BEFORE_GROUPING = [
  'libraries.list',
  'libraries.get',
  'backends.list',
  'backends.get',
  'backends.references',
  'queries.list',
  'queries.get',
  'queries.listVersions',
  'queries.getVersion',
  'queries.listArgumentSets',
  'queryGroups.list',
  'queryGroups.get',
  'queryGroups.listVersions',
  'queryGroups.getVersion',
  'queryGroups.validateVersion',
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
  'argumentSets.get',
  'detection.detectInputs',
  'detection.detectOutputs',
  'detection.validateQuery',
  'detection.validateRuleData',
  'detection.format',
];

function open(type: string | undefined) {
  return { openEntity: { id: 'urn:thing:1', ...(type ? { type } : {}) } };
}

describe('the grouped allowlist', () => {
  it('still covers exactly the tools it did before it was grouped', () => {
    expect([...ASSISTANT_READ_TOOLS].sort()).toEqual([...ALLOWLIST_BEFORE_GROUPING].sort());
  });

  it('puts every read tool in the core list or in some group', () => {
    const grouped = new Set([
      ...ASSISTANT_CORE_TOOLS,
      ...Object.values(ASSISTANT_TOOL_GROUPS).flatMap((group) => group.tools),
    ]);
    for (const name of ASSISTANT_READ_TOOLS) expect(grouped.has(name)).toBe(true);
  });

  it('leaves the registry built over the whole allowlist', () => {
    // Narrowing is a view on this, never a filter in front of it.
    expect(assistantToolNames()).toContain('ruleSets.get');
    expect(assistantToolNames()).toContain('queryGroups.get');
    expect(assistantToolNames()).toContain('execute.run');
  });
});

describe('choosing a turn’s starting groups', () => {
  it('narrows on the kind of entity the user has open', () => {
    expect(startingGroupsFor(open('query'))).toEqual(['queries']);
    expect(startingGroupsFor(open('group'))).toEqual(['queryGroups']);
    expect(startingGroupsFor(open('ruleset'))).toEqual(['rules']);
  });

  it('is case- and space-insensitive about the type', () => {
    expect(startingGroupsFor(open('  RuleSet '))).toEqual(['rules']);
  });

  it('does not narrow without a signal', () => {
    expect(startingGroupsFor(null)).toBeNull();
    expect(startingGroupsFor(undefined)).toBeNull();
    // A screen name alone spans every group, so narrowing on it saves nothing.
    expect(startingGroupsFor({ screen: 'build' })).toBeNull();
    expect(startingGroupsFor(open(undefined))).toBeNull();
    // A type nobody has classified fails open rather than to an empty list.
    expect(startingGroupsFor(open('benchmark'))).toBeNull();
  });
});

describe('a turn’s tool selection', () => {
  it('sends everything, and no escape hatch, when it cannot narrow', () => {
    const selection = createTurnToolSelection(null);
    expect(selection.narrowed).toBe(false);
    for (const name of ASSISTANT_READ_TOOLS) expect(selection.includes(name)).toBe(true);
    expect(selection.extraTools()).toEqual([]);
    expect(selection.prompt()).toBe('');
  });

  it('keeps the open kind’s tools and drops the others', () => {
    const selection = createTurnToolSelection(open('query'));
    expect(selection.narrowed).toBe(true);
    expect(selection.includes('queries.get')).toBe(true);
    expect(selection.includes('detection.detectInputs')).toBe(true);
    expect(selection.includes('ruleSets.get')).toBe(false);
    expect(selection.includes('queryGroups.get')).toBe(false);
  });

  it('always keeps the core tools and anything ungrouped', () => {
    const selection = createTurnToolSelection(open('ruleset'));
    for (const name of ASSISTANT_CORE_TOOLS) expect(selection.includes(name)).toBe(true);
    // `execute.run` is in no group; an unclassified tool is not narrowed away.
    expect(selection.includes('execute.run')).toBe(true);
  });

  it('gives a group its query readers, because a group of ids is not readable', () => {
    const selection = createTurnToolSelection(open('group'));
    expect(selection.includes('queryGroups.getVersion')).toBe(true);
    expect(selection.includes('queries.get')).toBe(true);
    expect(selection.includes('ruleSets.get')).toBe(false);
  });

  it('offers the escape hatch and names the groups it withheld', () => {
    const selection = createTurnToolSelection(open('query'));
    const [tool] = selection.extraTools();
    expect(tool.name).toBe(ENABLE_TOOLS_TOOL_NAME);
    expect((tool.inputSchema.properties as Record<string, { enum: string[] }>).group.enum).toEqual(
      Object.keys(ASSISTANT_TOOL_GROUPS)
    );

    const prompt = selection.prompt();
    expect(prompt).toContain('rules');
    expect(prompt).toContain('queryGroups');
    expect(prompt).toContain(ENABLE_TOOLS_TOOL_NAME);
    // What it already has is not advertised as missing.
    expect(prompt).not.toMatch(/^- queries:/m);
  });

  it('widens when the model asks, and stays widened', () => {
    const selection = createTurnToolSelection(open('query'));
    expect(selection.includes('ruleSets.get')).toBe(false);

    const text = selection.enable('rules');
    expect(text).toContain('ruleSets.get');
    expect(selection.includes('ruleSets.get')).toBe(true);
    // And the tools it already had are still there.
    expect(selection.includes('queries.get')).toBe(true);
  });

  it('answers a repeat rather than repeating itself', () => {
    const selection = createTurnToolSelection(open('query'));
    expect(selection.enable('queries')).toMatch(/already available/);
  });

  it('refuses a group that does not exist, and says which do', () => {
    const selection = createTurnToolSelection(open('query'));
    expect(() => selection.enable('everything')).toThrow(/not a tool group/);
    expect(() => selection.enable(undefined)).toThrow(/queries, queryGroups, rules/);
  });

  it('stops advertising once every group is in', () => {
    const selection = createTurnToolSelection(open('query'));
    selection.enable('queryGroups');
    selection.enable('rules');
    expect(selection.prompt()).toBe('');
    for (const name of ASSISTANT_READ_TOOLS) expect(selection.includes(name)).toBe(true);
  });
});
