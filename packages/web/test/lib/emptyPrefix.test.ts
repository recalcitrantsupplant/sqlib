import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';

/*
 * The empty prefix, `PREFIX : <…>`, end to end.
 *
 * It is the one label the grammar allows to be empty, and every step between a
 * document and the prefix manager used to refuse it: discovery skipped it, the
 * manager would not store it, so expansion could not sweep its declaration and
 * contraction had nothing to contract against. These tests drive the real
 * toolbar path (`usePrefixConversion`) with the real manager behind it, so a
 * step that drops ':' anywhere along the way shows up here.
 */

const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage[key];
  }),
  clear: vi.fn(() => {
    for (const key in mockLocalStorage) delete mockLocalStorage[key];
  }),
});

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

async function setup() {
  const [{ usePrefixManager }, { usePrefixConversion }] = await Promise.all([
    import('@/composables/usePrefixManager'),
    import('@/composables/usePrefixConversion'),
  ]);
  return { manager: usePrefixManager(), usePrefixConversion };
}

/** The rule set from the report, as typed: `:`-prefixed names and an SRL `:=`. */
const RULES = [
  'PREFIX : <http://example/>',
  '',
  'RULE {',
  '  ?x :consolidatedInto ?x .',
  '} WHERE {',
  '  ?x <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> :Company .',
  '}',
  '',
  'RULE {',
  '  ?g :consolidatedProfit ?sum .',
  '} WHERE {',
  '  ?g <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> :Company .',
  '  GROUP BY ?g {',
  '    ?m :consolidatedInto ?g .',
  '    ?m :hasProfit ?amount .',
  '  } [ ?sum := SUM( ?amount ) ]',
  '}',
  '',
].join('\n');

const emptyPrefixMappings = (mappings: { prefix: string; namespace: string }[]) =>
  mappings.filter((m) => m.prefix === '').map((m) => m.namespace);

describe('the empty prefix', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  describe('discovery registers it', () => {
    it('from SPARQL', async () => {
      const { manager } = await setup();
      manager.autoDiscoverFromSparql('PREFIX : <http://example/>\nSELECT * WHERE { ?s :p ?o }');
      await nextTick();
      expect(emptyPrefixMappings(manager.prefixSettings.value.mappings)).toEqual(['http://example/']);
    });

    it('from a half-typed query, through the text fallback', async () => {
      const { manager } = await setup();
      manager.autoDiscoverFromSparql('PREFIX : <http://example/>\nSELECT * WHERE { ?s :p');
      await nextTick();
      expect(emptyPrefixMappings(manager.prefixSettings.value.mappings)).toEqual(['http://example/']);
    });

    it('from Turtle', async () => {
      const { manager } = await setup();
      manager.autoDiscoverFromText('@prefix : <http://example/> .\n:a :b :c .');
      await nextTick();
      expect(emptyPrefixMappings(manager.prefixSettings.value.mappings)).toEqual(['http://example/']);
    });

    it('from SRL', async () => {
      const { manager } = await setup();
      manager.autoDiscoverFromRule(RULES);
      await nextTick();
      expect(emptyPrefixMappings(manager.prefixSettings.value.mappings)).toEqual(['http://example/']);
    });

    it('keeps one mapping per namespace however often it is seen', async () => {
      const { manager } = await setup();
      manager.autoDiscoverFromText('PREFIX : <http://example/>');
      await nextTick();
      manager.autoDiscoverFromText('PREFIX : <http://example/>');
      await nextTick();
      expect(emptyPrefixMappings(manager.prefixSettings.value.mappings)).toEqual(['http://example/']);
    });
  });

  describe('the manager', () => {
    it('stores it when added by hand', async () => {
      const { manager } = await setup();
      expect(manager.addPrefix('', 'http://example/', 'user-added')).not.toBeNull();
      expect(emptyPrefixMappings(manager.prefixSettings.value.mappings)).toEqual(['http://example/']);
    });

    it('lets an existing mapping be renamed to it', async () => {
      const { manager } = await setup();
      const id = manager.addPrefix('ex', 'http://example/', 'user-added')!;
      manager.updatePrefix(id, { prefix: '' });
      await nextTick();
      expect(emptyPrefixMappings(manager.prefixSettings.value.mappings)).toEqual(['http://example/']);
    });

    it('abbreviates and expands with it', async () => {
      const { manager } = await setup();
      manager.addPrefix('', 'http://example/', 'user-added');
      await nextTick();

      expect(manager.abbreviateIri('http://example/A').abbreviated).toBe(':A');
      expect(manager.abbreviateIri('http://example/').abbreviated).toBe(':');
      expect(manager.expandPrefix(':A')).toBe('http://example/A');
      expect(manager.expandPrefix(':')).toBe('http://example/');
    });

    it('still refuses labels the grammar refuses', async () => {
      const { manager } = await setup();
      expect(manager.addPrefix('1ex', 'http://example/', 'user-added')).toBeNull();
      expect(manager.addPrefix(' ', 'http://example/', 'user-added')).toBeNull();
    });
  });

  /*
   * Two documents that both say `PREFIX :` for different namespaces. Both
   * mappings are kept, one wins, and abbreviation and expansion agree on which.
   */
  describe('bound to two namespaces', () => {
    it('keeps both, and every direction uses the same winner', async () => {
      const { manager } = await setup();
      manager.autoDiscoverFromText('PREFIX : <http://example/>');
      await nextTick();
      manager.autoDiscoverFromText('PREFIX : <http://example.org/ns/>');
      await nextTick();

      expect(emptyPrefixMappings(manager.prefixSettings.value.mappings)).toHaveLength(2);

      const winner = manager.namespaceFor('');
      expect(winner).toBeDefined();
      expect(manager.expandPrefix(':A')).toBe(`${winner}A`);
      expect(manager.abbreviateIri(`${winner}A`).abbreviated).toBe(':A');
      expect(manager.effectivePairs().filter((p) => p.prefix === '')).toEqual([
        { prefix: '', namespace: winner },
      ]);
    });

    it('never sweeps a declaration the winner would not put back', async () => {
      const { manager, usePrefixConversion } = await setup();
      manager.autoDiscoverFromText('PREFIX : <http://example/>');
      await nextTick();
      manager.autoDiscoverFromText('PREFIX : <http://example.org/a/longer/namespace/>');
      await nextTick();

      const { toIris } = usePrefixConversion('application/sparql-query');
      const expanded = toIris('PREFIX : <http://example/>\nSELECT * WHERE { ?s :p ?o }')!;

      // The other namespace wins ':', so contracting could not restore this
      // binding; the declaration is the only record of it and stays.
      expect(expanded).toContain('PREFIX : <http://example/>');
      expect(expanded).toContain('<http://example/p>');
    });
  });

  describe('the editor toolbar', () => {
    it('expands the reported rule set and sweeps its declaration', async () => {
      const { manager, usePrefixConversion } = await setup();
      manager.autoDiscoverFromRule(RULES);
      await nextTick();

      const { toIris } = usePrefixConversion('application/srl');
      const expanded = toIris(RULES)!;

      expect(expanded).not.toContain('PREFIX');
      expect(expanded).toContain('?x <http://example/consolidatedInto> ?x .');
      expect(expanded).toContain('?m <http://example/hasProfit> ?amount .');
      // The assignment is not a prefixed name, empty prefix or not.
      expect(expanded).toContain('[ ?sum := SUM( ?amount ) ]');
    });

    it('contracts back to exactly what was typed', async () => {
      const { manager, usePrefixConversion } = await setup();
      manager.autoDiscoverFromRule(RULES);
      await nextTick();

      const { toIris, toPrefixed } = usePrefixConversion('application/srl');
      const expanded = toIris(RULES)!;
      const back = toPrefixed(expanded)!;

      // rdf:type comes back as rdf:type too, since rdf is a default prefix.
      expect(back).toBe(
        RULES.replace('PREFIX : <http://example/>', 'PREFIX : <http://example/>\nPREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>')
          .replaceAll('<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>', 'rdf:type'),
      );
    });

    it('contracts a document that never declared it', async () => {
      const { manager, usePrefixConversion } = await setup();
      manager.addPrefix('', 'http://example/', 'user-added');
      await nextTick();

      const { toPrefixed } = usePrefixConversion('application/sparql-query');
      expect(toPrefixed('SELECT * WHERE { ?s <http://example/p> <http://example/> }')).toBe(
        'PREFIX : <http://example/>\nSELECT * WHERE { ?s :p : }',
      );
    });

    it('contracts in Turtle', async () => {
      const { manager, usePrefixConversion } = await setup();
      manager.addPrefix('', 'http://example/', 'user-added');
      await nextTick();

      const { toPrefixed, toIris } = usePrefixConversion('text/turtle');
      const contracted = toPrefixed('<http://example/a> <http://example/b> <http://example/c> .')!;
      expect(contracted).toBe('PREFIX : <http://example/>\n:a :b :c .');
      expect(toIris(contracted)).toBe('<http://example/a> <http://example/b> <http://example/c> .');
    });
  });
});
