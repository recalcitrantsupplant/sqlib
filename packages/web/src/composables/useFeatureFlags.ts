// @ts-ignore - Nuxt auto-imports
import { useRuntimeConfig } from '#imports';
import { computed } from 'vue';
import {
  buildFeatureFlags,
  featureFlagLabels,
  type FeatureFlagKey,
  type FeatureFlags,
} from '@sparql-query-lib/types';
import { useDeploymentMode } from './useDeploymentMode';

const FLAG_LABELS = featureFlagLabels();
const DEFAULT_FLAGS: FeatureFlags = buildFeatureFlags({});

/**
 * Sections a read-only deployment switches off, whatever their flag says.
 *
 * Their Run writes: a benchmark run freezes the version and records every
 * observation, and the ETL screen runs through `/playground/etl/execute`,
 * which takes SQL in the request. The API refuses both on a read-only
 * deployment (`config/readOnly.ts`), so the section could only show a 405.
 * Hidden here rather than on each screen so the rail, the routes and the run
 * bar's "keep as benchmark" target all agree. This goes once the server has a
 * limited read-only run for a seeded version of each.
 */
export const READ_ONLY_HIDDEN_FEATURES: readonly FeatureFlagKey[] = ['benchmarks', 'etl', 'playgroundEtl'];

export function useFeatureFlags() {
  const config = useRuntimeConfig();
  // `app.vue` asks `/health` once per page load; this only reads the answer.
  const deployment = useDeploymentMode();
  const resolvedFlags = computed<FeatureFlags>(() => {
    const incoming = (config.public?.featureFlags ?? {}) as Partial<FeatureFlags>;
    const flags: FeatureFlags = {
      ...DEFAULT_FLAGS,
      ...incoming,
    };
    if (deployment.isReadOnly.value) {
      for (const key of READ_ONLY_HIDDEN_FEATURES) flags[key] = false;
    }
    return flags;
  });

  const isEnabled = (key: FeatureFlagKey) => resolvedFlags.value[key] ?? true;

  const labelFor = (key: FeatureFlagKey) => FLAG_LABELS[key] ?? key;

  return {
    flags: resolvedFlags,
    isEnabled,
    labelFor,
  };
}
