// @ts-ignore - Nuxt auto-imports
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';
import type { FeatureFlags } from '@sparql-query-lib/types';
import { debug } from '../lib/debug';

interface RuntimeConfigOverride {
  apiBaseUrl?: string;
  featureFlags?: Partial<FeatureFlags>;
  authIssuer?: string;
  authClientId?: string;
  authAudience?: string;
  authScope?: string;
}

// Named so the auth plugin can declare `dependsOn: ['runtime-config']` — it
// needs the OIDC settings this installs, and filename ordering would run it
// first otherwise.
export default defineNuxtPlugin({
  name: 'runtime-config',
  async setup() {
  const runtimeConfig = useRuntimeConfig();

  try {
    // No trace for the fetch itself: the next line reports what came back, and
    // every way it can fail already warns.
    const response = await fetch('/config.json');

    if (!response.ok) {
      console.warn('[runtime-config] Failed to load /config.json, using build-time defaults');
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.warn('[runtime-config] /config.json is not JSON (content-type:', contentType, '), using build-time defaults');
      return;
    }

    const config: RuntimeConfigOverride = await response.json();
    debug('runtime-config', 'loaded runtime config', config);

    // Override apiBaseUrl if provided
    if (config.apiBaseUrl) {
      runtimeConfig.public.apiBaseUrl = config.apiBaseUrl;
      debug('runtime-config', 'API base URL set to', config.apiBaseUrl);
    }

    // OIDC settings, so one build serves every environment.
    for (const key of ['authIssuer', 'authClientId', 'authAudience', 'authScope'] as const) {
      if (config[key]) {
        runtimeConfig.public[key] = config[key];
      }
    }

    // Override feature flags if provided
    if (config.featureFlags) {
      runtimeConfig.public.featureFlags = {
        ...runtimeConfig.public.featureFlags,
        ...config.featureFlags,
      };
      debug('runtime-config', 'feature flags updated', runtimeConfig.public.featureFlags);
    }
  } catch (error) {
    console.warn('[runtime-config] Error loading runtime config, using build-time defaults:', error instanceof Error ? error.message : error);
  }
  },
});
