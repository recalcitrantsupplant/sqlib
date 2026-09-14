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
  /*
   * Reveal the full IRI as a `title` on an abbreviated term.
   *
   * Declared here because it was already being *read* — `RdfTermTable` and
   * `QueryResultsViewer` both gate their tooltip on it — while no constructor of
   * this type ever set it. It survived only for users whose localStorage still
   * carried the key from an older build; anyone starting fresh got `undefined`,
   * so abbreviating `foaf:Person` hid the IRI with no way to see it and no
   * setting anywhere to turn it back on. See issue #52.
   */
  showTooltips: boolean;
}

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
