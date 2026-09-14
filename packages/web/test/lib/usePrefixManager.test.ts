import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';

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
    for (const key in mockLocalStorage) {
      delete mockLocalStorage[key];
    }
  }),
});

// Mock sparqljs Parser
vi.mock('sparqljs', () => ({
  Parser: vi.fn(() => ({
    parse: vi.fn((sparqlString: string) => {
      const prefixes: Record<string, string> = {};
      const prefixRegex = /PREFIX\s+(\w+):\s+<([^>]+)>/gi;
      let match;
      while ((match = prefixRegex.exec(sparqlString)) !== null) {
        prefixes[match[1]] = match[2];
      }
      return { prefixes };
    }),
  })),
}));

// The composable uses module-level singleton state guarded by an `initialized`
// flag, and its initial `mappings` alias the DEFAULT_PREFIXES module constant.
// To keep tests independent we reset the module registry before each test and
// re-import a fresh copy of the composable (and defaults) inside every test.
async function setup() {
  const [{ usePrefixManager }, { DEFAULT_PREFIXES }] = await Promise.all([
    import('@/composables/usePrefixManager'),
    import('@/lib/defaultPrefixes'),
  ]);
  return { usePrefixManager, DEFAULT_PREFIXES };
}

describe('usePrefixManager', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should initialize with default prefixes (enabled by default)', async () => {
    const { usePrefixManager, DEFAULT_PREFIXES } = await setup();
    const { prefixSettings, enabled } = usePrefixManager();

    // Prefix abbreviation now defaults to ENABLED, proxied from useSettings().
    expect(enabled.value).toBe(true);
    expect(prefixSettings.value.mappings.length).toBe(DEFAULT_PREFIXES.length);
    expect(prefixSettings.value.mappings).toEqual(expect.arrayContaining(DEFAULT_PREFIXES.map(p => expect.objectContaining({ prefix: p.prefix, namespace: p.namespace }))));
  });

  it('should load and save settings from localStorage', async () => {
    const initialSettings = {
      showTooltips: false,
      duplicateResolution: 'longest',
      mappings: [
        { id: 'test-1', prefix: 'ex', namespace: 'http://example.org/', enabled: true, isDefault: false, source: 'user-added', createdAt: Date.now() },
      ],
    };
    localStorage.setItem('sparqlQueryLib.prefixSettings', JSON.stringify(initialSettings));

    const { usePrefixManager, DEFAULT_PREFIXES } = await setup();
    const { prefixSettings, enabled } = usePrefixManager();

    // `enabled` is managed by useSettings (defaults true) and is no longer part of prefixSettings.
    expect(enabled.value).toBe(true);
    expect(prefixSettings.value.showTooltips).toBe(false);
    expect(prefixSettings.value.mappings).toHaveLength(initialSettings.mappings.length + DEFAULT_PREFIXES.length); // User-added + defaults
    expect(prefixSettings.value.mappings).toEqual(expect.arrayContaining([expect.objectContaining({ prefix: 'ex' })]));

    // Mutating prefix settings should persist to localStorage.
    prefixSettings.value.showTooltips = true;
    await nextTick();
    expect(localStorage.setItem).toHaveBeenCalledWith('sparqlQueryLib.prefixSettings', JSON.stringify(prefixSettings.value));
  });

  describe('abbreviateIri', () => {
    /*
     * `enabled` is the *default* term display for a result table, not a switch
     * on the abbreviator: a column set to prefixed names has to abbreviate
     * while the default says full IRIs, so the resolution is built from the
     * mappings alone and the caller decides whether to use it.
     */
    it('abbreviates regardless of the app-wide display default', async () => {
      const { usePrefixManager } = await setup();
      const { abbreviateIri, enabled } = usePrefixManager();
      enabled.value = false;
      await nextTick();

      const iri = 'http://xmlns.com/foaf/0.1/name';
      expect(abbreviateIri(iri)).toEqual({
        abbreviated: 'foaf:name',
        fullIri: iri,
        wasAbbreviated: true,
        prefix: 'foaf',
        namespace: 'http://xmlns.com/foaf/0.1/',
      });
    });

    it('should abbreviate IRI using enabled prefix', async () => {
      const { usePrefixManager } = await setup();
      const { abbreviateIri } = usePrefixManager();

      const iri = 'http://xmlns.com/foaf/0.1/name';
      const result = abbreviateIri(iri);
      expect(result.wasAbbreviated).toBe(true);
      expect(result.abbreviated).toBe('foaf:name');
      expect(result.fullIri).toBe(iri);
      expect(result.prefix).toBe('foaf');
      expect(result.namespace).toBe('http://xmlns.com/foaf/0.1/');
    });

    it('should abbreviate IRI with trailing hash namespace', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, abbreviateIri } = usePrefixManager();
      // Add a custom prefix with a trailing hash
      prefixSettings.value.mappings.push({
        id: 'custom-1', prefix: 'my', namespace: 'http://my.org/#', enabled: true, isDefault: false, source: 'user-added', createdAt: Date.now()
      });
      await nextTick();

      const iri = 'http://my.org/#term';
      const result = abbreviateIri(iri);
      expect(result.wasAbbreviated).toBe(true);
      expect(result.abbreviated).toBe('my:term');
    });

    it('should handle IRIs that are exactly a namespace', async () => {
      const { usePrefixManager } = await setup();
      const { abbreviateIri } = usePrefixManager();

      const iri = 'http://xmlns.com/foaf/0.1/';
      const result = abbreviateIri(iri);
      expect(result.wasAbbreviated).toBe(true);
      expect(result.abbreviated).toBe('foaf:');
      expect(result.fullIri).toBe(iri);
    });

    it('should prioritize longest namespace match', async () => {
      const { usePrefixManager } = await setup();
      const { addPrefix, abbreviateIri } = usePrefixManager();
      addPrefix('ex', 'http://example.org/', 'user-added');
      addPrefix('ex-vocab', 'http://example.org/vocab/', 'user-added');
      await nextTick();

      const iri = 'http://example.org/vocab/term';
      const result = abbreviateIri(iri);
      expect(result.wasAbbreviated).toBe(true);
      expect(result.abbreviated).toBe('ex-vocab:term');
      expect(result.prefix).toBe('ex-vocab');
    });

    /*
     * What may be abbreviated is the SPARQL PN_LOCAL production, not a guess at
     * it. This test used to assert that `ex:123invalid` was refused; a leading
     * digit is legal in PN_LOCAL and the app's own parser accepts it, so the
     * refusal was the bug and non-English vocabularies lost abbreviation
     * entirely for the same reason.
     */
    it('abbreviates local names the SPARQL grammar allows', async () => {
      const { usePrefixManager } = await setup();
      const { addPrefix, abbreviateIri } = usePrefixManager();
      addPrefix('ex', 'http://example.org/', 'user-added');
      await nextTick();

      for (const local of ['123invalid', '2023Report', 'a:b', 'café', 'has%20escape']) {
        const result = abbreviateIri(`http://example.org/${local}`);
        expect(result.wasAbbreviated, `expected ex:${local} to abbreviate`).toBe(true);
        expect(result.abbreviated).toBe(`ex:${local}`);
      }
    });

    it('refuses local names that would not parse', async () => {
      const { usePrefixManager } = await setup();
      const { addPrefix, abbreviateIri } = usePrefixManager();
      addPrefix('ex', 'http://example.org/', 'user-added');
      await nextTick();

      // A trailing '.' was the one this previously got wrong in the dangerous
      // direction: PN_LOCAL may contain a dot but may not end on one.
      for (const local of ['-dashed', '.dotted', 'trailing.', 'a/b', 'a b']) {
        const iri = `http://example.org/${local}`;
        const result = abbreviateIri(iri);
        expect(result.wasAbbreviated, `expected ex:${local} to be refused`).toBe(false);
        expect(result.abbreviated).toBe(iri);
      }
    });

    it('should use memoization cache', async () => {
      const { usePrefixManager } = await setup();
      const { abbreviateIri } = usePrefixManager();

      const iri = 'http://xmlns.com/foaf/0.1/name';
      const result1 = abbreviateIri(iri); // computes and caches
      const result2 = abbreviateIri(iri); // cache hit
      const result3 = abbreviateIri(iri); // cache hit
      // The memo is a plain Map, so a cache hit returns the very object that
      // was stored rather than a fresh proxy of it.
      expect(result2).toBe(result3);
      expect(result1).toStrictEqual(result2); // same content
      expect(result1.abbreviated).toBe('foaf:name');
    });
  });

  describe('autoDiscoverFromSparql', () => {
    it('should extract and add prefixes from SPARQL string', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, autoDiscoverFromSparql } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults for clean test
      await nextTick();

      const sparql = `PREFIX ex: <http://example.org/>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#/>\nSELECT * WHERE { ?s ex:p ?o . }`;
      autoDiscoverFromSparql(sparql, 'urn:query:1');
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(2);
      expect(prefixSettings.value.mappings).toEqual(expect.arrayContaining([
        expect.objectContaining({ prefix: 'ex', namespace: 'http://example.org/', source: 'auto-discovered', discoveredFrom: 'urn:query:1' }),
        expect.objectContaining({ prefix: 'rdfs', namespace: 'http://www.w3.org/2000/01/rdf-schema#/', source: 'auto-discovered', discoveredFrom: 'urn:query:1' }),
      ]));
    });

    it('should not add duplicate prefix+namespace combos', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, autoDiscoverFromSparql } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults
      addPrefix('ex', 'http://example.org/', 'user-added');
      await nextTick();

      const sparql = `PREFIX ex: <http://example.org/>\nSELECT * WHERE { ?s ex:p ?o . }`;
      autoDiscoverFromSparql(sparql, 'urn:query:1');
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(1);
      expect(prefixSettings.value.mappings[0].source).toBe('user-added'); // Original should remain
    });

    it('should handle invalid SPARQL gracefully', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, autoDiscoverFromSparql } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults

      // The mocked parser extracts PREFIX declarations via regex and does not throw,
      // so invalid input simply yields no discovered prefixes (no crash).
      expect(() => autoDiscoverFromSparql('INVALID SPARQL QUERY', 'urn:query:2')).not.toThrow();
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(0);
    });
  });

  describe('autoDiscoverFromSparql fallback', () => {
    it('still reads the PREFIX block of a query that does not parse', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, autoDiscoverFromSparql } = usePrefixManager();
      prefixSettings.value.mappings = [];
      await nextTick();

      // Half-typed is the normal state of an editor.
      autoDiscoverFromSparql('PREFIX ex: <http://example.org/>\nSELECT * WHERE { ?s ex:p', 'query:urn:sqlib:query:1');
      await nextTick();

      expect(prefixSettings.value.mappings).toEqual([
        expect.objectContaining({ prefix: 'ex', namespace: 'http://example.org/' }),
      ]);
    });
  });

  describe('autoDiscoverFromRule', () => {
    it('should extract and add prefixes from an SRL rule string via regex', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, autoDiscoverFromRule } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults for clean test
      await nextTick();

      const rule = `PREFIX sh: <http://www.w3.org/ns/shacl#>
PREFIX ex: <http://example.com/ns#>
sh:MyShape a sh:NodeShape ; sh:targetClass ex:Person .`;
      autoDiscoverFromRule(rule, 'urn:rule:1');
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(2);
      expect(prefixSettings.value.mappings).toEqual(expect.arrayContaining([
        expect.objectContaining({ prefix: 'sh', namespace: 'http://www.w3.org/ns/shacl#', source: 'auto-discovered', discoveredFrom: 'urn:rule:1' }),
        expect.objectContaining({ prefix: 'ex', namespace: 'http://example.com/ns#', source: 'auto-discovered', discoveredFrom: 'urn:rule:1' }),
      ]));
    });

    it('should not add duplicate rule prefix+namespace combos', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, autoDiscoverFromRule } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults
      addPrefix('ex', 'http://example.com/ns#', 'user-added');
      await nextTick();

      const rule = `PREFIX ex: <http://example.com/ns#>
sh:MyShape a sh:NodeShape .`;
      autoDiscoverFromRule(rule, 'urn:rule:1');
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(1);
      expect(prefixSettings.value.mappings[0].source).toBe('user-added');
    });
  });

  describe('autoDiscoverFromText', () => {
    it('reads Turtle @prefix lines as well as SPARQL PREFIX lines', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, autoDiscoverFromText } = usePrefixManager();
      prefixSettings.value.mappings = [];
      await nextTick();

      const turtle = `@prefix ex: <http://example.org/> .
@PREFIX up: <http://uppercase.example/> .
PREFIX sparqlish: <http://example.org/sparqlish#>
ex:a a up:Thing .`;
      autoDiscoverFromText(turtle, 'data-graph:urn:sqlib:datagraph:1');
      await nextTick();

      expect(prefixSettings.value.mappings.map((m) => m.prefix).sort()).toEqual([
        'ex',
        'sparqlish',
        'up',
      ]);
      expect(prefixSettings.value.mappings.every(
        (m) => m.source === 'auto-discovered'
          && m.discoveredFrom === 'data-graph:urn:sqlib:datagraph:1',
      )).toBe(true);
    });

    it('discovers without provenance when there is nothing to point at', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, autoDiscoverFromText } = usePrefixManager();
      prefixSettings.value.mappings = [];
      await nextTick();

      autoDiscoverFromText('@prefix ex: <http://example.org/> .', null);
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(1);
      expect(prefixSettings.value.mappings[0].discoveredFrom).toBeUndefined();
    });

    it('skips declarations the manager itself would refuse', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, autoDiscoverFromText } = usePrefixManager();
      prefixSettings.value.mappings = [];
      await nextTick();

      // An empty prefix label, and a namespace that is not an IRI.
      autoDiscoverFromText('@prefix : <http://example.org/> .\nPREFIX bad: <nonsense>', null);
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(0);
    });

    it('does not mistake a word ending in "prefix" for a declaration', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, autoDiscoverFromText } = usePrefixManager();
      prefixSettings.value.mappings = [];
      await nextTick();

      autoDiscoverFromText('# noprefix ex: <http://example.org/>', null);
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(0);
    });
  });

  describe('CRUD Operations', () => {
    it('should add a new prefix mapping', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults
      await nextTick();

      addPrefix('test', 'http://test.org/', 'user-added');
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(1);
      expect(prefixSettings.value.mappings[0]).toEqual(expect.objectContaining({
        prefix: 'test',
        namespace: 'http://test.org/',
        source: 'user-added',
        enabled: true,
        isDefault: false,
      }));
    });

    it('should update an existing prefix mapping', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, updatePrefix } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults
      await nextTick();

      addPrefix('test', 'http://test.org/', 'user-added');
      await nextTick();
      const id = prefixSettings.value.mappings[0].id;

      updatePrefix(id, { namespace: 'http://updated.org/', enabled: false });
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(1);
      expect(prefixSettings.value.mappings[0]).toEqual(expect.objectContaining({
        id,
        prefix: 'test',
        namespace: 'http://updated.org/',
        enabled: false,
      }));
    });

    it('should remove a prefix mapping', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, removePrefix } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults
      await nextTick();

      addPrefix('test1', 'http://test1.org/', 'user-added');
      addPrefix('test2', 'http://test2.org/', 'user-added');
      await nextTick();
      const idToRemove = prefixSettings.value.mappings[0].id;

      removePrefix(idToRemove);
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(1);
      expect(prefixSettings.value.mappings[0].prefix).toBe('test2');
    });

    it('should toggle prefix enabled state', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, togglePrefixEnabled } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults
      await nextTick();

      addPrefix('test', 'http://test.org/', 'user-added');
      await nextTick();
      const id = prefixSettings.value.mappings[0].id;

      expect(prefixSettings.value.mappings[0].enabled).toBe(true);
      togglePrefixEnabled(id);
      await nextTick();
      expect(prefixSettings.value.mappings[0].enabled).toBe(false);
    });

    it('should reset to default prefixes', async () => {
      // Seed localStorage so the composable loads a fresh mappings array rather
      // than aliasing the DEFAULT_PREFIXES module constant.
      localStorage.setItem('sparqlQueryLib.prefixSettings', JSON.stringify({ duplicateResolution: 'longest', mappings: [] }));

      const { usePrefixManager, DEFAULT_PREFIXES } = await setup();
      const { prefixSettings, addPrefix, resetToDefaults } = usePrefixManager();
      addPrefix('user', 'http://user.org/', 'user-added');
      await nextTick();

      resetToDefaults();
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(DEFAULT_PREFIXES.length);
      expect(prefixSettings.value.mappings).toEqual(expect.arrayContaining(DEFAULT_PREFIXES.map(p => expect.objectContaining({ prefix: p.prefix, namespace: p.namespace, isDefault: true }))));
      // resetToDefaults no longer resets the global `enabled` flag; it is managed by useSettings now.
    });

    /*
     * Reset writes to localStorage, and the next page load merges the stored
     * mappings with DEFAULT_PREFIXES. If reset does not preserve the stable
     * `default-<prefix>` ids the merge cannot recognise its own defaults and
     * appends a second copy of every one of them — the 38-row Prefix Manager.
     */
    it('should not duplicate defaults after reset followed by a reload', async () => {
      localStorage.setItem('sparqlQueryLib.prefixSettings', JSON.stringify({ duplicateResolution: 'longest', mappings: [] }));

      {
        const { usePrefixManager } = await setup();
        const { resetToDefaults } = usePrefixManager();
        resetToDefaults();
        await nextTick();
      }

      // Simulate a hard refresh: fresh module registry, same localStorage.
      vi.resetModules();
      const { usePrefixManager, DEFAULT_PREFIXES } = await setup();
      const { prefixSettings } = usePrefixManager();
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(DEFAULT_PREFIXES.length);
      const seen = prefixSettings.value.mappings.map(m => `${m.prefix}|${m.namespace}`);
      expect(new Set(seen).size).toBe(seen.length);
    });

    /*
     * Storage already corrupted by the old reset must heal on load rather than
     * requiring the user to clear site data.
     */
    it('should de-duplicate defaults already stored by an older build', async () => {
      const { DEFAULT_PREFIXES } = await setup();
      vi.resetModules();
      const doubled = [
        ...DEFAULT_PREFIXES.map(p => ({ ...p, id: `stale-a-${p.prefix}` })),
        ...DEFAULT_PREFIXES.map(p => ({ ...p, id: `stale-b-${p.prefix}` })),
      ];
      localStorage.setItem('sparqlQueryLib.prefixSettings', JSON.stringify({ duplicateResolution: 'longest', mappings: doubled }));

      const { usePrefixManager } = await setup();
      const { prefixSettings } = usePrefixManager();
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(DEFAULT_PREFIXES.length);
    });

    it('should export prefixes as VANN turtle', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, exportPrefixesVann } = usePrefixManager();
      prefixSettings.value.mappings = [];
      await nextTick();

      addPrefix('testexp', 'http://export.org/', 'user-added');
      await nextTick();

      const turtle = exportPrefixesVann();
      expect(turtle).toContain('vann:preferredNamespacePrefix "testexp"');
      expect(turtle).toContain('vann:preferredNamespaceUri "http://export.org/"');
    });

    it('should export prefixes as RDFa turtle', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, exportPrefixesRdfa } = usePrefixManager();
      prefixSettings.value.mappings = [];
      await nextTick();

      addPrefix('testexp', 'http://export.org/', 'user-added');
      await nextTick();

      const turtle = exportPrefixesRdfa();
      expect(turtle).toContain('rdfa:prefix "testexp"');
      expect(turtle).toContain('rdfa:uri "http://export.org/"');
    });
  });

  describe('Duplicate Handling', () => {
    it('should detect duplicate prefixes', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, getDuplicates } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults
      await nextTick();

      addPrefix('dup', 'http://dup1.org/', 'user-added');
      addPrefix('dup', 'http://dup2.org/', 'user-added');
      await nextTick();

      const duplicates = getDuplicates();
      expect(duplicates.duplicatePrefixes.has('dup')).toBe(true);
      expect(duplicates.duplicatePrefixes.get('dup')).toEqual(expect.arrayContaining(['http://dup1.org/', 'http://dup2.org/']));
    });

    it('should detect duplicate namespaces', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, getDuplicates } = usePrefixManager();
      prefixSettings.value.mappings = []; // Clear defaults
      await nextTick();

      addPrefix('ns1', 'http://common.org/', 'user-added');
      addPrefix('ns2', 'http://common.org/', 'user-added');
      await nextTick();

      const duplicates = getDuplicates();
      expect(duplicates.duplicateNamespaces.has('http://common.org/')).toBe(true);
      expect(duplicates.duplicateNamespaces.get('http://common.org/')).toEqual(expect.arrayContaining(['ns1', 'ns2']));
    });

    it('should resolve prefix conflicts by longest namespace for abbreviation', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, abbreviateIri } = usePrefixManager();
      prefixSettings.value.mappings = [];

      addPrefix('ex', 'http://example.org/', 'user-added'); // Shorter
      addPrefix('ex', 'http://example.org/longer/', 'user-added'); // Longer, should win for 'ex:'
      await nextTick();

      const iri = 'http://example.org/longer/term';
      const result = abbreviateIri(iri);
      expect(result.abbreviated).toBe('ex:term'); // Should use the 'ex' for longer namespace

      const iri2 = 'http://example.org/term';
      const result2 = abbreviateIri(iri2);
      expect(result2.abbreviated).toBe('http://example.org/term'); // Shorter namespace does not get 'ex' prefix because it lost the conflict
    });

    it('should normalize namespaces for storage and matching', async () => {
      const { usePrefixManager } = await setup();
      const { prefixSettings, addPrefix, abbreviateIri } = usePrefixManager();
      prefixSettings.value.mappings = [];
      await nextTick();

      addPrefix('test', 'http://test.org', 'user-added'); // Missing slash
      addPrefix('testH', 'http://test.org#', 'user-added'); // Missing slash
      await nextTick();

      // Should be normalized when stored and used for abbreviation
      const storedTest = prefixSettings.value.mappings.find(m => m.prefix === 'test');
      expect(storedTest?.namespace).toBe('http://test.org/');

      const storedTestH = prefixSettings.value.mappings.find(m => m.prefix === 'testH');
      expect(storedTestH?.namespace).toBe('http://test.org#'); // # should be preserved

      expect(abbreviateIri('http://test.org/resource').abbreviated).toBe('test:resource');
      expect(abbreviateIri('http://test.org#fragment').abbreviated).toBe('testH:fragment');
    });

    it('should merge new default prefixes on load from localStorage', async () => {
      const { usePrefixManager, DEFAULT_PREFIXES } = await setup();

      // Simulate old settings without a new default (e.g., 'prov')
      const oldDefaults = DEFAULT_PREFIXES.filter(p => p.prefix !== 'prov');
      const oldSettings = {
        showTooltips: true,
        duplicateResolution: 'longest',
        mappings: oldDefaults.map(p => ({ ...p, createdAt: Date.now() }))
      };
      localStorage.setItem('sparqlQueryLib.prefixSettings', JSON.stringify(oldSettings));

      // usePrefixManager should now load and merge 'prov' from DEFAULT_PREFIXES
      const { prefixSettings } = usePrefixManager();
      await nextTick();

      expect(prefixSettings.value.mappings).toHaveLength(DEFAULT_PREFIXES.length); // All defaults should be present
      expect(prefixSettings.value.mappings).toEqual(expect.arrayContaining([
        expect.objectContaining({ prefix: 'prov', source: 'default' })
      ]));
    });
  });
});
