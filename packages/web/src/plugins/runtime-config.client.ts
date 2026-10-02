// @ts-ignore - Nuxt auto-imports
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';
import type { FeatureFlags } from '@sparql-query-lib/types';
import { debug } from '../lib/debug';
import { withBase } from '../lib/basePath';

interface RuntimeConfigOverride {
  apiBaseUrl?: string;
  /**
   * The MCP endpoint, when it is not `<apiBaseUrl>/mcp`. Every deployment this
   * repository ships serves `/mcp` beside the API, so this is normally absent
   * and the MCP page derives it; see `mcpEndpoint` in `lib/mcpClients.ts`.
   */
  mcpUrl?: string;
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

  // Beside the app rather than at the site root: a build served under a base
  // path shares that root with whatever else is hosted there, and `/config.json`
  // would be that site's file, not this app's.
  const configUrl = withBase('/config.json', runtimeConfig.app?.baseURL);

  try {
    // No trace for the fetch itself: the next line reports what came back, and
    // every way it can fail already warns.
    const response = await fetch(configUrl);

    if (!response.ok) {
      console.warn(`[runtime-config] Failed to load ${configUrl}, using build-time defaults`);
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.warn(`[runtime-config] ${configUrl} is not JSON (content-type:`, contentType, '), using build-time defaults');
      return;
    }

    const config: RuntimeConfigOverride = await response.json();
    debug('runtime-config', 'loaded runtime config', config);

    // Override apiBaseUrl if provided
    if (config.apiBaseUrl) {
      runtimeConfig.public.apiBaseUrl = config.apiBaseUrl;
      debug('runtime-config', 'API base URL set to', config.apiBaseUrl);
    }

    // Read at run time like the API URL, so a deployment whose MCP endpoint is
    // on another host needs no rebuild. NUXT_PUBLIC_MCP_URL is the build-time
    // equivalent.
    if (config.mcpUrl) {
      runtimeConfig.public.mcpUrl = config.mcpUrl;
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
