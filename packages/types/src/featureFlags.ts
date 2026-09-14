export const FEATURE_FLAG_KEYS = ['queries', 'queryGroups', 'rulesSuite', 'benchmarks', 'tests', 'dataGraphs', 'tupleSets', 'argumentSets', 'etl', 'backends', 'settings', 'rulesAllowInvalidSave', 'ruleTuples', 'playgroundQueries', 'playgroundRules', 'playgroundEtl', 'assistant'] as const;

export type FeatureFlagKey = typeof FEATURE_FLAG_KEYS[number];

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export const FEATURE_FLAG_ENV_VARS: Record<FeatureFlagKey, string> = {
  queries: 'FEATURE_QUERIES',
  queryGroups: 'FEATURE_QUERY_GROUPS',
  rulesSuite: 'FEATURE_RULES_SUITE',
  benchmarks: 'FEATURE_BENCHMARKS',
  tests: 'FEATURE_TESTS',
  dataGraphs: 'FEATURE_DATA_GRAPHS',
  tupleSets: 'FEATURE_TUPLE_SETS',
  argumentSets: 'FEATURE_ARGUMENT_SETS',
  etl: 'FEATURE_ETL',
  backends: 'FEATURE_BACKENDS',
  settings: 'FEATURE_SETTINGS',
  rulesAllowInvalidSave: 'FEATURE_RULES_ALLOW_INVALID_SAVE',
  ruleTuples: 'FEATURE_RULE_TUPLES',
  playgroundQueries: 'FEATURE_PLAYGROUND_QUERIES',
  playgroundRules: 'FEATURE_PLAYGROUND_RULES',
  playgroundEtl: 'FEATURE_PLAYGROUND_ETL',
  assistant: 'FEATURE_ASSISTANT',
};

const FALSE_LITERALS = new Set(['0', 'false', 'off', 'no', 'disabled']);
const TRUE_LITERALS = new Set(['1', 'true', 'on', 'yes', 'enabled']);

export function coerceFeatureFlagValue(value: string | undefined, fallback = true): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return fallback;
  }
  if (FALSE_LITERALS.has(normalized)) {
    return false;
  }
  if (TRUE_LITERALS.has(normalized)) {
    return true;
  }
  return fallback;
}

export function buildFeatureFlags(
  env: Record<string, string | undefined>,
  overrides: Partial<FeatureFlags> = {},
  defaults: FeatureFlags = {
    queries: true,
    queryGroups: true,
    rulesSuite: true,
    benchmarks: true,
    /*
     * On, like the sections it tests. A test runs a callable that is already
     * runnable from its own screen, so nothing about it is a new capability —
     * it is the same invocation with an expectation attached.
     */
    tests: true,
    /*
     * On. A data graph is reference RDF you paste into your own library,
     * capped at write; it grants no capability the library did not already
     * have.
     */
    dataGraphs: true,
    /*
     * On, for the same reason data graphs are: a tuple set is tabular input
     * you register in your own library, and it grants no capability the
     * library did not already have. Rows are spliced into a VALUES clause at
     * execution, never loaded into a store.
     */
    tupleSets: true,
    /*
     * On, and for a narrower reason than the two above: argument sets have
     * been reachable from the query screen since they existed, so the flag
     * grants nothing new. It exists because a rail section needs one, and so
     * the section can be hidden without touching the query screen's Inputs
     * tab, which is the same entity seen from its callable.
     */
    argumentSets: true,
    /*
     * Off unless asked for, same reasoning as `assistant` below. Both ETL
     * surfaces take arbitrary DuckDB SQL, which is a host filesystem read
     * primitive and — with httpfs — an outbound request primitive. ETL is a
     * managed operator flow, not a per-visitor feature, so it should not
     * appear because someone upgraded. See issue #132.
     */
    etl: false,
    backends: true,
    settings: true,
    rulesAllowInvalidSave: false,
    /*
     * Off unless asked for. The rule-tuples extension adds TUPLE( … ) to SRL,
     * which conformant SHACL 1.2 Rules tooling does not accept: a document
     * written with it on cannot be read anywhere else. A build that does not
     * ask for the extension should not offer an author a way to write one, so
     * the toggle, the seed inputs and the API fields are all absent by default.
     *
     * This is not the `tupleSets` flag above. A tuple set is a saved table of
     * RDF terms that fills a VALUES clause; it is unaffected by this flag and
     * its rail stays drawn.
     */
    ruleTuples: false,
    playgroundQueries: true,
    playgroundRules: true,
    /* Off unless asked for — see `etl` above. */
    playgroundEtl: false,
    /*
     * Off unless asked for. The in-app assistant is unauthenticated (like /mcp
     * beside it, and blocked on the same caller-authorization model), it calls
     * a paid provider, and it can reach a configured backend. A feature with
     * those three properties should not appear because someone upgraded.
     */
    assistant: false,
  },
): FeatureFlags {
  const flags: FeatureFlags = {
    queries: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.queries], defaults.queries),
    queryGroups: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.queryGroups], defaults.queryGroups),
    rulesSuite: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.rulesSuite], defaults.rulesSuite),
    benchmarks: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.benchmarks], defaults.benchmarks),
    tests: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.tests], defaults.tests),
    dataGraphs: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.dataGraphs], defaults.dataGraphs),
    tupleSets: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.tupleSets], defaults.tupleSets),
    argumentSets: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.argumentSets], defaults.argumentSets),
    etl: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.etl], defaults.etl),
    backends: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.backends], defaults.backends),
    settings: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.settings], defaults.settings),
    rulesAllowInvalidSave: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.rulesAllowInvalidSave], defaults.rulesAllowInvalidSave),
    ruleTuples: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.ruleTuples], defaults.ruleTuples),
    playgroundQueries: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.playgroundQueries], defaults.playgroundQueries),
    playgroundRules: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.playgroundRules], defaults.playgroundRules),
    playgroundEtl: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.playgroundEtl], defaults.playgroundEtl),
    assistant: coerceFeatureFlagValue(env[FEATURE_FLAG_ENV_VARS.assistant], defaults.assistant),
  };

  return {
    ...flags,
    ...overrides,
  };
}

export function featureFlagLabels(): Record<FeatureFlagKey, string> {
  return {
    queries: 'Queries',
    queryGroups: 'Query Groups',
    rulesSuite: 'Rules / Data Blocks / Rule Sets',
    benchmarks: 'Benchmarks',
    tests: 'Tests',
    dataGraphs: 'Data graphs',
    tupleSets: 'Tuple sets',
    argumentSets: 'Argument sets',
    etl: 'ETL',
    backends: 'Backends',
    settings: 'Settings',
    rulesAllowInvalidSave: 'Rules: Allow Invalid Save',
    ruleTuples: 'Rules: named tuples (extension)',
    playgroundQueries: 'Playground: Queries',
    playgroundRules: 'Playground: Rules',
    playgroundEtl: 'Playground: ETL',
    assistant: 'Build assistant (in-app)',
  };
}
