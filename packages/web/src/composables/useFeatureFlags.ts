// @ts-ignore - Nuxt auto-imports
import { useRuntimeConfig } from '#imports';
import { computed } from 'vue';
import {
  buildFeatureFlags,
  featureFlagLabels,
  type FeatureFlagKey,
  type FeatureFlags,
} from '@sparql-query-lib/types';

const FLAG_LABELS = featureFlagLabels();
const DEFAULT_FLAGS: FeatureFlags = buildFeatureFlags({});

export function useFeatureFlags() {
  const config = useRuntimeConfig();
  const resolvedFlags = computed<FeatureFlags>(() => {
    const incoming = (config.public?.featureFlags ?? {}) as Partial<FeatureFlags>;
    return {
      ...DEFAULT_FLAGS,
      ...incoming,
    };
  });

  const isEnabled = (key: FeatureFlagKey) => resolvedFlags.value[key] ?? true;

  const labelFor = (key: FeatureFlagKey) => FLAG_LABELS[key] ?? key;

  return {
    flags: resolvedFlags,
    isEnabled,
    labelFor,
  };
}
