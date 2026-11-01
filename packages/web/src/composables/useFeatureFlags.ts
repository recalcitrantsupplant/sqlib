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
 * How a read-only deployment reads the ETL flags.
 *
 * The ETL screen's rail entry sits behind `playgroundEtl`, because on a
 * writable deployment that screen runs whatever SQL is typed into it. A
 * read-only deployment runs only a saved job's stored version
 * (`/etl-jobs/:id/execute`; the playground route is refused there), with the
 * editors read-only. So there the section is offered exactly when saved ETL
 * jobs are: `playgroundEtl` follows `etl`.
 *
 * Bench needs no rule here: a read-only deployment runs a frozen, seeded
 * benchmark version within caps (`lib/readOnlyBenchmarkRun.ts` in the API).
 */
function applyReadOnly(flags: FeatureFlags): FeatureFlags {
  return { ...flags, playgroundEtl: flags.etl };
}

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
    return deployment.isReadOnly.value ? applyReadOnly(flags) : flags;
  });

  const isEnabled = (key: FeatureFlagKey) => resolvedFlags.value[key] ?? true;

  const labelFor = (key: FeatureFlagKey) => FLAG_LABELS[key] ?? key;

  return {
    flags: resolvedFlags,
    isEnabled,
    labelFor,
  };
}
