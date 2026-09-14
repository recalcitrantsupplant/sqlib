/**
 * How far `tupleSets`, `dataGraphs` and `argumentSets` reach outside their own
 * sections.
 *
 * The composable answers one question — "is there a section to send someone
 * to?" — and the point of it is what it deliberately does *not* answer: whether
 * the entity can be read. Those two were the same question for `tests`, which
 * is a feature; they are not the same question for an input, which a callable
 * on another screen has to resolve whether or not its section is drawn.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { useInputSections, INPUT_SECTION_FEATURE } from '@/composables/useInputSections';
import { FEATURE_FLAG_KEYS } from '@sparql-query-lib/types';

function setFlags(flags: Record<string, boolean> | null): void {
  globalThis.__NUXT_TEST_CONFIG__ = flags === null
    ? undefined
    : { public: { apiBaseUrl: 'http://api.test', featureFlags: flags } };
}

afterEach(() => setFlags(null));

describe('useInputSections', () => {
  it('reports every section open when nothing switches one off', () => {
    const { sectionOpen } = useInputSections();
    expect(sectionOpen('tupleSet').value).toBe(true);
    expect(sectionOpen('dataGraph').value).toBe(true);
    expect(sectionOpen('argumentSet').value).toBe(true);
  });

  it('closes one section without closing the others', () => {
    setFlags({ tupleSets: false });
    const { sectionOpen } = useInputSections();
    expect(sectionOpen('tupleSet').value).toBe(false);
    expect(sectionOpen('dataGraph').value).toBe(true);
    expect(sectionOpen('argumentSet').value).toBe(true);
  });

  it('pairs each kind with a flag that exists', () => {
    // A kind mapped to a misspelt flag would read as "always on" — `isEnabled`
    // falls back to true for a key it does not hold — so the pairing is checked
    // rather than trusted.
    for (const flag of Object.values(INPUT_SECTION_FEATURE)) {
      expect(FEATURE_FLAG_KEYS).toContain(flag);
    }
    expect(Object.keys(INPUT_SECTION_FEATURE).sort()).toEqual(
      ['argumentSet', 'dataGraph', 'tupleSet'],
    );
  });

  it('closes a section a partial flag set does not mention as open', () => {
    // The runtime config carries whatever the build baked in, which need not be
    // every key; the defaults fill the rest, and all three of these default on.
    setFlags({ dataGraphs: false });
    const { sectionOpen } = useInputSections();
    expect(sectionOpen('dataGraph').value).toBe(false);
    expect(sectionOpen('tupleSet').value).toBe(true);
  });
});
