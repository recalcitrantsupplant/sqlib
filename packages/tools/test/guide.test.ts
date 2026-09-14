import { describe, expect, it } from 'vitest';
import { catalogueGuide, guideToolMentions } from '../src/guide.js';
import { tools } from '../src/tools.js';

/**
 * The guide is prose about the catalogue, and prose does not fail to compile
 * when a tool is renamed. These pin the two ways it could go stale.
 */
describe('catalogue guide', () => {
  const names = new Set(tools.map((tool) => tool.name));

  /**
   * Backticked dotted tokens in the guide that are not tools. Listed here, not
   * skipped by pattern, so a misspelt tool name cannot hide among them: an
   * unknown mention fails unless it is named in this set.
   */
  const NOT_TOOLS = new Set(['head.vars']);

  it('names only tools that exist', () => {
    const mentions = guideToolMentions();
    expect(mentions.length).toBeGreaterThan(5);
    for (const mention of mentions) {
      if (NOT_TOOLS.has(mention)) continue;
      expect(names.has(mention), `guide mentions ${mention}, which is not in the catalogue`).toBe(true);
    }
    // And every entry in NOT_TOOLS is still in use, so the set cannot rot.
    for (const token of NOT_TOOLS) {
      expect(mentions, `${token} is listed as a non-tool but the guide no longer mentions it`).toContain(token);
    }
  });

  it('renders tool names the way a door publishes them', () => {
    const rendered = catalogueGuide((name) => name.replace(/\./g, '_'));
    expect(rendered).toContain('`queries_createVersion`');
    expect(rendered).not.toContain('`queries.createVersion`');
    // A dotted token that is not a tool is left alone.
    expect(rendered).toContain('`head.vars`');
  });

  it('is the identity rendering by default', () => {
    expect(catalogueGuide()).toContain('`queries.createVersion`');
  });

  it('states the two things agents got wrong', () => {
    const guide = catalogueGuide();
    // A query carries no SPARQL text; a version does.
    expect(guide).toMatch(/NO SPARQL/);
    expect(guide).toContain('"queryVersion"');
    // A parameter is an all-UNDEF VALUES row.
    expect(guide).toContain('VALUES ?city { UNDEF }');
    expect(guide).toContain('"bindings"');
  });

  it('stays short enough to be sent with every session', () => {
    // Roughly 700 tokens at 4 chars/token; the tool listing is ~5.4k.
    expect(catalogueGuide().length).toBeLessThan(3200);
  });
});
