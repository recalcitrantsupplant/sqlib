import type { useApiClient } from './useApiClient';

type ApiClient = Pick<ReturnType<typeof useApiClient>, 'listRuleSets' | 'listRuleSetVersions'>;

/** A rule set version, with the rule set it belongs to. */
export interface ResolvedRuleSetVersion {
  ruleSetId: string;
  version: number;
  srlDocument: string | null;
}

/*
 * A query group node stores only the rule set *version* IRI, and the API has no
 * route that reads a version by its IRI. The owner is found by listing the rule
 * sets and then their versions. Results are kept for the session, because a
 * version is immutable: its owner and its text do not change.
 */
const cache = new Map<string, Promise<ResolvedRuleSetVersion | null>>();

async function lookup(api: ApiClient, versionId: string): Promise<ResolvedRuleSetVersion | null> {
  const ruleSets = await api.listRuleSets();
  // The current version is the usual case, so check those owners first.
  const ordered = [
    ...ruleSets.filter((ruleSet) => ruleSet.currentVersion === versionId),
    ...ruleSets.filter((ruleSet) => ruleSet.currentVersion !== versionId),
  ];
  for (const ruleSet of ordered) {
    const versions = await api.listRuleSetVersions(ruleSet.id);
    const match = versions.find((version) => version.id === versionId);
    if (match) {
      return { ruleSetId: ruleSet.id, version: match.version, srlDocument: match.srlDocument ?? null };
    }
  }
  return null;
}

/**
 * Find the rule set that owns `versionId`, or null when no rule set does.
 * `api` comes from the caller's setup, where `useApiClient` can read the
 * runtime config.
 */
export function resolveRuleSetVersion(api: ApiClient, versionId: string): Promise<ResolvedRuleSetVersion | null> {
  let pending = cache.get(versionId);
  if (!pending) {
    pending = lookup(api, versionId).catch((error) => {
      cache.delete(versionId);
      throw error;
    });
    cache.set(versionId, pending);
  }
  return pending;
}
