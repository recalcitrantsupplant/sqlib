import { ref, shallowRef, computed, watch } from 'vue';
import { Parser as SparqlQueryParser } from '@traqula/parser-sparql-1-2';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_PREFIXES } from '@/lib/defaultPrefixes';
import { shrink, expand, type PrefixPair } from '@/lib/curie';
import type { PrefixMapping, PrefixSettings, PrefixCache, AbbreviationResult } from '@/types/prefixes';
import { useSettings } from '@/composables/useSettings';

const LOCAL_STORAGE_KEY = 'sparqlQueryLib.prefixSettings';

function generateId(): string {
  return uuidv4();
}

// Return a fresh, independent copy of the default mappings. Callers store this
// in reactive state and mutate it in place (push/toggle), so handing out the
// shared DEFAULT_PREFIXES constant by reference would corrupt it across sessions.
function defaultMappings(): PrefixMapping[] {
  return DEFAULT_PREFIXES.map(m => ({ ...m }));
}

// Basic IRI validation - checks if it looks like an absolute IRI
function isIri(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://') || str.startsWith('urn:') || str.startsWith('tag:');
}

// Helper to normalize namespaces (ensure trailing slash/hash)
function normalizeNamespace(namespace: string): string {
  if (namespace.endsWith('/') || namespace.endsWith('#')) {
    return namespace;
  }
  // Heuristic: if it looks like a domain or path, add a slash
  if (namespace.includes('/') || namespace.includes('.')) {
    return namespace + '/';
  }
  return namespace;
}

// Resolve duplicates based on the 'longest' strategy
function resolveDuplicates(mappings: PrefixMapping[]): PrefixMapping[] {
  const resolved = new Map<string, PrefixMapping>(); // prefix -> longest namespace mapping
  const namespaceResolved = new Map<string, PrefixMapping>(); // namespace -> preferred prefix mapping

  for (const mapping of mappings) {
    // Resolve prefix conflicts: keep the one with the longest namespace
    const existingByPrefix = resolved.get(mapping.prefix);
    if (!existingByPrefix || mapping.namespace.length > existingByPrefix.namespace.length) {
      resolved.set(mapping.prefix, mapping);
    }

    // Resolve namespace conflicts: keep the one that was defined first, or is a default
    const existingByNamespace = namespaceResolved.get(mapping.namespace);
    if (!existingByNamespace) {
      namespaceResolved.set(mapping.namespace, mapping);
    } else if (mapping.isDefault && !existingByNamespace.isDefault) {
      // Prefer default over non-default if namespace is the same
      namespaceResolved.set(mapping.namespace, mapping);
    } else if (!mapping.isDefault && existingByNamespace.isDefault) {
      // Keep existing default
      // No action needed
    } else if (mapping.createdAt < existingByNamespace.createdAt) {
      // If both are same source type or neither is default, prefer older (first added)
      namespaceResolved.set(mapping.namespace, mapping);
    }
  }

  // Filter out mappings that lost in a namespace conflict
  const finalMappings: PrefixMapping[] = [];
  for (const mapping of resolved.values()) {
    if (namespaceResolved.get(mapping.namespace)?.id === mapping.id) {
      finalMappings.push(mapping);
    }
  }

  return finalMappings;
}


/*
 * The resolution the app abbreviates against, built from the mappings alone.
 *
 * It is deliberately independent of the "Abbreviate IRIs" setting: that setting
 * is the *default* term display for a result table, and a column switched to
 * prefixed names has to abbreviate whatever the default says. Who abbreviates
 * is decided at the call site (see `useTermDisplay`), not here.
 */
function buildCache(settings: PrefixSettings): PrefixCache {
  const cache: PrefixCache = {
    namespaceToPrefix: new Map(),
    sortedNamespaces: [],
    duplicatePrefixes: new Map(),
    duplicateNamespaces: new Map(),
    effectiveIds: new Set(),
  };

  const activeMappings = settings.mappings.filter(m => m.enabled);

  // Detect duplicates for UI warnings
  // We use Sets to count UNIQUE targets. If multiple mappings have same prefix AND same namespace,
  // that is redundancy, not a conflict.
  const prefixMap = new Map<string, Set<string>>();
  const namespaceMap = new Map<string, Set<string>>();

  for (const mapping of activeMappings) {
    const namespaces = prefixMap.get(mapping.prefix) || new Set();
    namespaces.add(mapping.namespace);
    prefixMap.set(mapping.prefix, namespaces);

    const prefixes = namespaceMap.get(mapping.namespace) || new Set();
    prefixes.add(mapping.prefix);
    namespaceMap.set(mapping.namespace, prefixes);
  }

  // Store duplicates for UI warnings
  for (const [prefix, namespaces] of prefixMap.entries()) {
    if (namespaces.size > 1) {
      cache.duplicatePrefixes.set(prefix, Array.from(namespaces));
    }
  }
  for (const [namespace, prefixes] of namespaceMap.entries()) {
    if (prefixes.size > 1) {
      cache.duplicateNamespaces.set(namespace, Array.from(prefixes));
    }
  }

  // Resolve duplicates (longest/most specific namespace wins for a given prefix)
  const resolvedMappings = resolveDuplicates(activeMappings);

  // Populate effective IDs
  cache.effectiveIds = new Set(resolvedMappings.map(m => m.id));

  // Build lookup map (namespace -> prefix)
  // This map will store the *preferred* prefix for a given namespace if duplicates exist
  for (const mapping of resolvedMappings) {
    cache.namespaceToPrefix.set(mapping.namespace, mapping.prefix);
  }

  // Sort by namespace length (descending) for greedy matching for abbreviation
  cache.sortedNamespaces = resolvedMappings
    .map(m => ({ namespace: m.namespace, prefix: m.prefix }))
    .sort((a, b) => b.namespace.length - a.namespace.length);

  return cache;
}

function loadFromLocalStorage(): PrefixSettings {
  if (typeof window === 'undefined') {
    return {
      duplicateResolution: 'longest',
      mappings: defaultMappings(),
    };
  }
  try {
    const storedSettings = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (storedSettings) {
      const parsedSettings: PrefixSettings = JSON.parse(storedSettings);
      /*
       * Drop exact repeats before merging.
       *
       * A mapping is identified by what it *means* — its prefix and namespace —
       * not by its id. An older build's `resetToDefaults` minted a fresh uuid
       * for every default, so the merge below could not recognise the defaults
       * already in storage and appended a second copy of each on the next load
       * (19 mappings became 38, every row shown twice). Reset now preserves the
       * stable ids, but storage written by that build is already doubled and
       * has to heal here rather than making the user clear site data.
       *
       * Only exact prefix+namespace repeats go: two mappings sharing just one
       * of the two are a real conflict the manager reports, not redundancy.
       */
      const seen = new Set<string>();
      const mergedMappings: PrefixMapping[] = [];
      for (const mapping of parsedSettings.mappings ?? []) {
        const key = `${mapping.prefix}\u0000${mapping.namespace}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mergedMappings.push(mapping);
      }
      // Merge with defaults: add any new defaults that aren't in stored settings
      for (const defaultPrefix of DEFAULT_PREFIXES) {
        const key = `${defaultPrefix.prefix}\u0000${defaultPrefix.namespace}`;
        if (!seen.has(key) && !mergedMappings.some(m => m.id === defaultPrefix.id)) {
          seen.add(key);
          mergedMappings.push({ ...defaultPrefix });
        }
      }
      parsedSettings.mappings = mergedMappings;
      
      // Ensure strict type compliance by removing 'enabled' if it exists in stored JSON
      // (This is implicitly handled by not including it in the return type, but good to be safe)
      const { enabled, ...cleanSettings } = parsedSettings as any;

      /*
       * Only the fields this type declares, never the whole blob.
       *
       * Storage written by an older build carries keys nothing reads any more
       * — `showTooltips`, which gated the IRI popover that no longer exists —
       * and spreading the blob would carry them straight back into the settings
       * the app then saves. Naming the fields is what stops a removed setting
       * living on in every user's localStorage forever.
       */
      return {
        duplicateResolution: 'longest',
        mappings: cleanSettings.mappings ?? defaultMappings(),
      };
    }
  } catch (e) {
    console.error("Failed to load prefix settings from localStorage", e);
  }
  // Default settings if nothing in localStorage or parsing fails
  return {
    duplicateResolution: 'longest',
    mappings: defaultMappings(),
  };
}

function saveToLocalStorage(settings: PrefixSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error("Failed to save prefix settings to localStorage", e);
  }
}

// Singleton state
const prefixSettings = ref<PrefixSettings>({
  duplicateResolution: 'longest',
  mappings: defaultMappings(),
});
/*
 * Shallow, and the memo below is not reactive at all.
 *
 * These are lookup structures, not state anything renders from. As a deep
 * `ref`, `sortedNamespaces` was a reactive array of reactive objects, so every
 * abbreviation paid a proxy trap per namespace and per property while scanning
 * — measured at 7.4x the cost of the same scan over a plain array, which was
 * most of `abbreviateIri` running ~15x slower than its own algorithm. The
 * reactive `Map` added another 1.7x on top for gets and sets nothing observes.
 *
 * Nothing outside this module reads `prefixCache`, and the watcher below
 * replaces it wholesale rather than mutating it, so `shallowRef` keeps exactly
 * the invalidation that existed before.
 */
const prefixCache = shallowRef<PrefixCache>({
  namespaceToPrefix: new Map(),
  sortedNamespaces: [],
  duplicatePrefixes: new Map(),
  duplicateNamespaces: new Map(),
  effectiveIds: new Set(),
});
const abbreviationMemoCache = new Map<string, AbbreviationResult>();

let initialized = false;

export function usePrefixManager() {
  const { settings, setPrefixAbbreviationEnabled } = useSettings();

  // Computed property to proxy the enabled state from useSettings
  const enabled = computed({
    get: () => settings.value.prefixAbbreviationEnabled,
    set: (val: boolean) => setPrefixAbbreviationEnabled(val),
  });

  if (!initialized) {
    const loaded = loadFromLocalStorage();
    prefixSettings.value = loaded;
    prefixCache.value = buildCache(prefixSettings.value);
    initialized = true;

    // Watch for settings changes and update localStorage and cache (global watcher)
    watch(prefixSettings, () => {
      saveToLocalStorage(prefixSettings.value);
      prefixCache.value = buildCache(prefixSettings.value);
      abbreviationMemoCache.clear(); // Clear memoization on config change
    }, { deep: true });
  }

  // Auto-discovery

  /**
   * Record one declaration, unless an identical mapping is already held.
   *
   * The comparison is on prefix *and* namespace: two prefixes for one
   * namespace, or one prefix used for two namespaces across documents, are
   * both legitimate and both kept — the cache resolves which wins.
   */
  function rememberDiscovered(prefix: string, namespace: string, sourceUrn?: string | null): void {
    const normalizedNamespace = normalizeNamespace(namespace);
    if (!prefix || !normalizedNamespace) return;
    if (!isIri(normalizedNamespace)) return;
    // The manager will not let a person type a prefix it would refuse; a
    // document should not be able to smuggle one in either.
    if (!/^[a-zA-Z_][a-zA-Z0-9_\-]*$/.test(prefix)) return;

    const existing = prefixSettings.value.mappings.find(
      m => m.prefix === prefix && normalizeNamespace(m.namespace) === normalizedNamespace
    );
    if (existing) return;

    prefixSettings.value.mappings.push({
      id: generateId(),
      prefix,
      namespace: normalizedNamespace,
      enabled: true, // Auto-enable discovered prefixes
      isDefault: false,
      source: 'auto-discovered',
      ...(sourceUrn ? { discoveredFrom: sourceUrn } : {}),
      createdAt: Date.now(),
    });
  }

  /**
   * Every prefix declaration any RDF-family document can carry.
   *
   * SPARQL writes `PREFIX foaf: <…>`, Turtle and TriG write `@prefix foaf: <…> .`
   * and also accept the SPARQL form, and a SHACL rule set carries whichever of
   * the two its author wrote. One expression reads all of them, which is what
   * lets every editor in the app discover prefixes the same way rather than
   * each one discovering the subset its own screen happened to implement.
   *
   * The prefix label is optional in the grammar (`PREFIX : <…>`); those are
   * matched so they are consumed rather than half-matched, and dropped by
   * `rememberDiscovered`, which refuses what the manager would refuse.
   */
  const PREFIX_DECLARATION = /(?:^|[\s;.])@?prefix\s+([A-Za-z_][A-Za-z0-9_.\-]*)?\s*:\s*<([^<>"{}|^`\\\s]*)>/gi;

  /**
   * Discover prefixes from any RDF or SPARQL text.
   *
   * The one entry point every editing surface and every result body goes
   * through, so "where prefixes come from" is a property of the app rather
   * than of the screen you happen to be on.
   */
  function autoDiscoverFromText(text: string, sourceUrn?: string | null): void {
    if (!text) return;
    PREFIX_DECLARATION.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PREFIX_DECLARATION.exec(text)) !== null) {
      const [, prefix, namespace] = match;
      if (!prefix || !namespace) continue;
      rememberDiscovered(prefix, namespace, sourceUrn);
    }
  }

  function autoDiscoverFromSparql(sparqlString: string, sourceUrn?: string | null): void {
    try {
      const parser = new SparqlQueryParser();
      const parsed = parser.parse(sparqlString) as any;

      // Traqula stores PREFIX declarations in an ordered `context` array of
      // { subType: 'prefix', key, value: { value: <namespace> } } entries. Updates
      // keep their prefixes per-operation, so gather from both the top level and
      // each update operation.
      const contextArrays: any[] = [];
      if (Array.isArray(parsed.context)) contextArrays.push(parsed.context);
      if (Array.isArray(parsed.updates)) {
        for (const entry of parsed.updates) {
          if (Array.isArray(entry?.context)) contextArrays.push(entry.context);
        }
      }
      const prefixEntries: Array<[string, string]> = [];
      for (const ctx of contextArrays) {
        for (const def of ctx) {
          if (def?.subType === 'prefix' && def.value && typeof def.value.value === 'string') {
            prefixEntries.push([def.key, def.value.value]);
          }
        }
      }

      for (const [prefix, namespace] of prefixEntries) {
        rememberDiscovered(prefix, namespace, sourceUrn);
      }
    } catch {
      /*
       * A half-typed query is the normal case in an editor, not an error: the
       * parser refuses the whole document over one unclosed brace, while its
       * PREFIX block above the fault is complete and readable. So fall back to
       * reading the declarations directly rather than discovering nothing
       * until the query parses.
       */
      autoDiscoverFromText(sparqlString, sourceUrn);
    }
  }

  function autoDiscoverFromRule(ruleString: string, sourceUrn?: string | null): void {
    // A rule set is Turtle carrying SPARQL: both declaration forms appear, at
    // the document level and inside sh:construct/sh:select bodies.
    autoDiscoverFromText(ruleString, sourceUrn);
  }

  // Abbreviation (with memoization)
  function abbreviateIri(iri: string): AbbreviationResult {
    /*
     * Read the reactive state BEFORE the memo lookup, and use the values read
     * here for the rest of the call.
     *
     * Callers are render functions — every result cell is its own `FlexRender`
     * component, so a cell re-renders only when a ref it touched during its own
     * last render changes. Returning straight out of the memo touched nothing,
     * so the second and later cells showing the same IRI subscribed to nothing
     * and kept their old text when a prefix was added, removed or toggled:
     * one row would abbreviate and an identical row beside it would not.
     *
     * Touching `cache` up front makes every call a subscriber regardless of
     * whether it went on to do any work. The watcher replaces `prefixCache`
     * wholesale and clears the memo, so a change invalidates every cell that
     * has ever rendered an IRI.
     */
    const cache = prefixCache.value;

    // Check memoization cache
    if (abbreviationMemoCache.has(iri)) {
      return abbreviationMemoCache.get(iri)!;
    }

    // Early exit if this is not an IRI at all
    if (!isIri(iri)) {
      const result = { abbreviated: iri, fullIri: iri, wasAbbreviated: false };
      abbreviationMemoCache.set(iri, result);
      return result;
    }

    const iriValue = iri.trim();

    // Try exact namespace match (edge case: IRI is exactly the namespace)
    if (cache.namespaceToPrefix.has(iriValue)) {
      const prefix = cache.namespaceToPrefix.get(iriValue)!;
      const result = {
        abbreviated: `${prefix}:`,
        fullIri: iri,
        wasAbbreviated: true,
        prefix,
        namespace: iriValue,
      };
      abbreviationMemoCache.set(iri, result);
      return result;
    }

    // Longest namespace first; `sortedNamespaces` is built in that order.
    const match = shrink(iriValue, cache.sortedNamespaces);
    if (match) {
      const result = {
        abbreviated: match.curie,
        fullIri: iri,
        wasAbbreviated: true,
        prefix: match.prefix,
        namespace: match.namespace,
      };
      abbreviationMemoCache.set(iri, result);
      return result;
    }

    // No match
    const result = { abbreviated: iri, fullIri: iri, wasAbbreviated: false };
    abbreviationMemoCache.set(iri, result);
    return result;
  }

  /*
   * The reverse of `abbreviateIri`. Delegated so that both directions agree
   * about what a local name is: this used to `split(':')` and bail unless it
   * saw exactly two parts, which quietly refused every CURIE with a colon in
   * its local name — `foaf:a:b` among them — and so could not round-trip what
   * `abbreviateIri` had just produced.
   */
  function expandPrefix(prefixedName: string): string | null {
    return expand(prefixedName, (prefix) => {
      const mapping = prefixSettings.value.mappings.find(m => m.enabled && m.prefix === prefix);
      return mapping?.namespace;
    });
  }

  // CRUD operations
  /**
   * Returns the new mapping's id, or null when the input was refused.
   *
   * Endpoint sync needs the id: a pulled mapping has to be findable again by
   * the next sync, and an applied plan reports what it actually created.
   */
  function addPrefix(
    prefix: string,
    namespace: string,
    source: PrefixMapping['source'],
    provenance?: { discoveredFrom?: string; syncedWith?: string }
  ): string | null {
    const normalizedNamespace = normalizeNamespace(namespace);
    // Basic validation
    if (!prefix || !normalizedNamespace) {
      console.warn('Cannot add prefix: prefix and namespace cannot be empty.');
      return null;
    }
    if (!isIri(normalizedNamespace)) {
      console.warn('Cannot add prefix: namespace must be a valid IRI.');
      return null;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_\-]*$/.test(prefix)) {
      console.warn('Cannot add prefix: invalid prefix format.');
      return null;
    }

    const newMapping: PrefixMapping = {
      id: generateId(),
      prefix,
      namespace: normalizedNamespace,
      enabled: true,
      isDefault: false,
      source,
      ...(provenance?.discoveredFrom ? { discoveredFrom: provenance.discoveredFrom } : {}),
      ...(provenance?.syncedWith ? { syncedWith: provenance.syncedWith } : {}),
      createdAt: Date.now(),
    };
    prefixSettings.value.mappings.push(newMapping);
    return newMapping.id;
  }

  function updatePrefix(id: string, updates: Partial<PrefixMapping>): void {
    const index = prefixSettings.value.mappings.findIndex(m => m.id === id);
    if (index !== -1) {
      const current = prefixSettings.value.mappings[index];
      const updatedNamespace = updates.namespace ? normalizeNamespace(updates.namespace) : current.namespace;

      // Basic validation for updates
      if (updates.prefix && !/^[a-zA-Z_][a-zA-Z0-9_\-]*$/.test(updates.prefix)) {
        console.warn('Cannot update prefix: invalid prefix format.');
        return;
      }
      if (updates.namespace && !isIri(updatedNamespace)) {
        console.warn('Cannot update prefix: namespace must be a valid IRI.');
        return;
      }

      prefixSettings.value.mappings[index] = { ...current, ...updates, namespace: updatedNamespace };
    }
  }

  function removePrefix(id: string): void {
    prefixSettings.value.mappings = prefixSettings.value.mappings.filter(m => m.id !== id);
  }

  /*
   * Put a removed mapping back where it was.
   *
   * Removing a prefix is cheap and recoverable, so the manager offers an inline
   * undo rather than a confirm dialog. Undo has to restore the whole record —
   * id included, because `effectiveIds` and the row keys are keyed on it — and
   * at its old index, so the list does not reshuffle under the pointer.
   */
  function restorePrefix(mapping: PrefixMapping, index: number): void {
    if (prefixSettings.value.mappings.some(m => m.id === mapping.id)) return;
    const at = Math.max(0, Math.min(index, prefixSettings.value.mappings.length));
    prefixSettings.value.mappings.splice(at, 0, { ...mapping });
  }

  function togglePrefixEnabled(id: string): void {
    const mapping = prefixSettings.value.mappings.find(m => m.id === id);
    if (mapping) {
      mapping.enabled = !mapping.enabled;
    }
  }

  // Utilities
  function getDuplicates(): { duplicatePrefixes: Map<string, string[]>; duplicateNamespaces: Map<string, string[]> } {
    // Re-run buildCache with current settings to get fresh duplicate info
    const tempCache = buildCache(prefixSettings.value);
    return { duplicatePrefixes: tempCache.duplicatePrefixes, duplicateNamespaces: tempCache.duplicateNamespaces };
  }

  function resetToDefaults(): void {
    /*
     * Keep the defaults' own stable `default-<prefix>` ids. Minting fresh uuids
     * here made the reset state unrecognisable to the merge in
     * `loadFromLocalStorage`, which then re-added every default on the next
     * page load and left the manager showing each one twice.
     */
    prefixSettings.value.mappings = defaultMappings();
    // Do NOT reset 'enabled' here as it's managed by useSettings now. 
    // If we wanted to reset it, we'd call setPrefixAbbreviationEnabled(true);
  }

  function exportPrefixesVann(): string {
    const mappings = prefixSettings.value.mappings;
    let turtle = '@prefix vann: <http://purl.org/vocab/vann/> .\n';
    turtle += '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n';

    for (const m of mappings) {
      const escapeTurtleLiteral = (value: string) =>
        value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\r/g, '\\r')
          .replace(/\n/g, '\\n');

      const prefix = escapeTurtleLiteral(m.prefix);
      const uri = escapeTurtleLiteral(m.namespace);
      
      turtle += `[] vann:preferredNamespacePrefix "${prefix}" ;\n`;
      turtle += `   vann:preferredNamespaceUri "${uri}" .\n`;
    }
    return turtle;
  }

  function exportPrefixesRdfa(): string {
    const mappings = prefixSettings.value.mappings;
    let turtle = '@prefix rdfa: <http://www.w3.org/ns/rdfa#> .\n\n';

    for (const m of mappings) {
      const escapeTurtleLiteral = (value: string) =>
        value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\r/g, '\\r')
          .replace(/\n/g, '\\n');

      const prefix = escapeTurtleLiteral(m.prefix);
      const uri = escapeTurtleLiteral(m.namespace);

      turtle += `[] a rdfa:PrefixMapping ;\n`;
      turtle += `   rdfa:prefix "${prefix}" ;\n`;
      turtle += `   rdfa:uri "${uri}" .\n`;
    }
    return turtle;
  }

  function isMappingEffective(id: string): boolean {
    return prefixCache.value.effectiveIds.has(id);
  }

  /*
   * Which mappings win. Computed fresh rather than read off the live cache so
   * the manager describes the mappings themselves, the way `getDuplicates`
   * does, and not whatever a table happens to be rendering.
   */
  function getEffectiveIds(): Set<string> {
    return buildCache(prefixSettings.value).effectiveIds;
  }

  /*
   * The winning mappings as plain pairs, longest namespace first.
   *
   * `shrink` requires that order and does not sort for itself, so handing out
   * the cache's own list is what keeps a whole-document conversion from
   * re-sorting the prefix table once per term. Read off the live cache
   * deliberately: a conversion abbreviates against exactly what the rest of
   * the app is abbreviating against.
   */
  function effectivePairs(): readonly PrefixPair[] {
    return prefixCache.value.sortedNamespaces;
  }

  return {
    prefixSettings,
    enabled,

    // Auto-discovery
    autoDiscoverFromText,
    autoDiscoverFromSparql,
    autoDiscoverFromRule,

    // Abbreviation
    abbreviateIri,
    expandPrefix,

    // Management
    addPrefix,
    updatePrefix,
    removePrefix,
    restorePrefix,
    togglePrefixEnabled,
    getDuplicates,
    getEffectiveIds,
    effectivePairs,
    resetToDefaults,
    exportPrefixesVann,
    exportPrefixesRdfa,
    isMappingEffective,
  };
}
