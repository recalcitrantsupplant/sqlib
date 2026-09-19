export interface PrefixMapping {
  id: string;              // Unique ID for Vue key and deletion
  prefix: string;          // e.g., "foaf", "rdf", "xsd"
  namespace: string;       // e.g., "http://xmlns.com/foaf/0.1/"
  enabled: boolean;        // Toggle individual prefix on/off
  isDefault: boolean;      // True for built-in defaults
  /**
   * Where the mapping came from. `endpoint` means it was pulled from a
   * backend's own prefix map — see `docs/guides/prefixes.md`.
   */
  source: 'default' | 'auto-discovered' | 'user-added' | 'endpoint';
  discoveredFrom?: string; // Query/Rule URN if auto-discovered, backend id if synced
  /**
   * The backend this mapping is tracked against, set when it arrives from or is
   * reconciled with a store's prefix map. Distinct from `discoveredFrom`, which
   * is provenance a user reads; this one is what a later sync matches on.
   */
  syncedWith?: string;
  createdAt: number;       // Timestamp
}

export interface PrefixSettings {
  duplicateResolution: 'longest';        // Always use longest (most specific) namespace match
  mappings: PrefixMapping[];             // All prefix mappings
}

/*
 * `showTooltips` used to live here: it gated the hover popover that revealed
 * the full IRI behind an abbreviated term. The popover is gone — a cell's type
 * badge copies the full IRI, and a column that should *read* as full IRIs is
 * switched to them from its header menu — so the flag gated nothing and went
 * with it. A settings blob in localStorage that still carries the key is read
 * and the key dropped, which is what the spread in `loadFromLocalStorage` does
 * for every field this type no longer declares.
 */

export interface PrefixCache {
  namespaceToPrefix: Map<string, string>;  // Fast lookup
  sortedNamespaces: Array<{ namespace: string; prefix: string }>; // Greedy match
  duplicatePrefixes: Map<string, string[]>;    // Warnings
  duplicateNamespaces: Map<string, string[]>;  // Warnings
  effectiveIds: Set<string>; // IDs of mappings that are currently in use
}

export interface AbbreviationResult {
  abbreviated: string;     // Prefixed form or original IRI
  fullIri: string;         // Original IRI
  wasAbbreviated: boolean; // Whether abbreviation occurred
  prefix?: string;         // Which prefix was used
  namespace?: string;      // Which namespace matched
}
