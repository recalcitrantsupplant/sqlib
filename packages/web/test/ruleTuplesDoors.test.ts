/**
 * Every surface that mentions the SRL rule-tuples extension, and what holds it.
 *
 * The extension is gated by the `ruleTuples` feature flag, which defaults off.
 * "Gated" here means absent rather than disabled: a build that withholds the
 * extension should not draw a toggle that turns it on, an input that feeds it,
 * or a pick that leads to either.
 *
 * The inventory is listed rather than pattern-matched, for the reason the
 * sibling guards give (`inputSectionDoors.test.ts`, `testsFeatureDoors.test.ts`):
 * a new surface fails here until someone says which condition holds it, and
 * saying so is where the thinking is.
 *
 * The second half of this file is the more important one. `tupleSets` — the
 * saved-table entity and its rail — shares the word "tuple" and nothing else,
 * and it must keep working with this flag off: a query fills a VALUES clause
 * from a tuple set, and an argument set names one, neither of which has
 * anything to do with rules. The assertions below pin that separation so a
 * later tidy-up cannot quietly fold the two together.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = resolve(import.meta.dirname, '../src');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

/** The tag an attribute sits in, opening angle to `>`. */
function enclosingTag(text: string, needle: string): string {
  const at = text.indexOf(needle);
  if (at < 0) return '';
  const open = text.lastIndexOf('<', at);
  const close = text.indexOf('>', at);
  return text.slice(open, close < 0 ? undefined : close + 1);
}

describe('the rule-tuples extension is absent when the flag is off', () => {
  it('the extension toggle is held by the flag, not merely disabled', () => {
    const text = read('components/rules/RuleSetInspectorPanel.vue');
    expect(text).toContain("isEnabled('ruleTuples')");
    // The control itself, and the rule above it, both go.
    const tag = enclosingTag(text, 'data-testid="tuples-toggle"');
    expect(tag).not.toContain('disabled');
    expect(text).toMatch(/<section v-if="ruleTuplesAllowed" class="details-group">/);
    expect(text).toMatch(/<div v-if="ruleTuplesAllowed" class="details-rule" \/>/);
  });

  it('the panels below are told the document has the extension off', () => {
    const text = read('components/rules/RuleSetInspectorPanel.vue');
    // Every downstream binding reads the combined value, never the raw prop.
    expect(text).not.toContain(':tuples-enabled="tuplesEnabled"');
    expect(text.match(/:tuples-enabled="tuplesInEffect"/g)?.length).toBe(3);
    expect(text).toMatch(/const tuplesInEffect = computed\(\(\) => props\.tuplesEnabled && ruleTuplesAllowed\.value\)/);
  });

  it('the named-tuples input block is behind the same condition', () => {
    // The block's own v-if reads the prop the inspector now combines, so the
    // condition reaches it through `tuplesInEffect` above.
    const text = read('components/rules/RuleSetInputsPanel.vue');
    expect(enclosingTag(text, 'data-testid="inputs-tuples"')).toContain('v-if="tuplesEnabled"');
  });

  it('the work area cannot hold the extension on, whatever it is handed', () => {
    const text = read('components/RuleSetWorkArea.vue');
    // Every assignment goes through the coercion; none writes the ref directly.
    expect(text).toMatch(/function applyTuplesEnabled\(next: boolean\) \{\s*\n\s*tuplesEnabled\.value = next && ruleTuplesAllowed\.value;/);
    const directWrites = text.match(/tuplesEnabled\.value = /g) ?? [];
    // Exactly one: the one inside applyTuplesEnabled.
    expect(directWrites.length).toBe(1);
    // The toggle handler refuses before anything else.
    expect(text).toMatch(/if \(!ruleTuplesAllowed\.value\) return;/);
  });

  it('the run bar pick is absent rather than empty', () => {
    const text = read('components/RuleSetWorkArea.vue');
    expect(text).toMatch(/\.\.\.\(ruleTuplesAllowed\.value/);
  });

  it("a test case's named-tuples box is held by the flag too", () => {
    const text = read('components/TestWorkArea.vue');
    expect(text).toMatch(/featureEnabled\('ruleTuples'\)\s*\n\s*&& slots\.value\.tupleSeeds/);
  });

  it('the api client refuses to send the extension it cannot have', () => {
    const text = read('composables/useApiClient.ts');
    expect(text).toContain("const ensureRuleTuplesEnabled = () => ensureFeatureEnabled('ruleTuples');");
    // Called only where a request would carry the extension.
    expect(text).toMatch(/if \(options\?\.tuples === true\) ensureRuleTuplesEnabled\(\);/);
    expect(text).toMatch(/if \(input\?\.tuples === true \|\| \(input\?\.tupleSeeds \?\? ''\)\.trim\(\)\) ensureRuleTuplesEnabled\(\);/);
  });
});

describe('tuple sets are a different feature and keep working', () => {
  it('the Tuples rail is held by tupleSets, never by ruleTuples', () => {
    const text = read('components/AppNavRail.vue');
    expect(text).toMatch(/section: 'tupleSets'[\s\S]*?isEnabled\('tupleSets'\)/);
    expect(text).not.toContain("isEnabled('ruleTuples')");
  });

  it('the tuple-set section definition is untouched by the rule flag', () => {
    const text = read('lib/sections.ts');
    expect(text).toContain("feature: 'tupleSets'");
    expect(text).not.toContain('ruleTuples');
  });

  it('the tuple-set store and picker do not consult the rule flag', () => {
    for (const file of [
      'composables/useTupleSetsStore.ts',
      'components/query-work-area/TupleSetPicker.vue',
      'components/query-work-area/TupleBindingEditor.vue',
      'components/TupleSetWorkArea.vue',
    ]) {
      expect(read(file)).not.toContain('ruleTuples');
    }
  });

  it('the rule flag gates no tuple-set read', () => {
    const text = read('composables/useApiClient.ts');
    // The four reads argument sets depend on stay ungated by either flag; see
    // inputSectionDoors.test.ts for the tupleSets half of the same rule.
    for (const method of ['listTupleSets', 'getTupleSet', 'listTupleSetVersions', 'getTupleSetVersion']) {
      const at = text.indexOf(`const ${method} =`);
      expect(at, `${method} not found`).toBeGreaterThan(-1);
      const body = text.slice(at, at + 400);
      expect(body).not.toContain('ensureRuleTuplesEnabled');
    }
  });
});
