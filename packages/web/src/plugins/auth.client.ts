/**
 * Boots the auth state before the app renders.
 *
 * Runs after `runtime-config.client` so the OIDC settings are already in place.
 * When the API reports `disabled` this resolves without contacting any IdP,
 * which is what keeps a no-auth deployment working with the same build, unless
 * `authRequireLogin` says a gateway in front of the API wants a token.
 */
// @ts-ignore - Nuxt auto-imports
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';
import { useAuth } from '../composables/useAuth';
import { withoutBase } from '../lib/basePath';

export default defineNuxtPlugin({
  name: 'auth',
  dependsOn: ['runtime-config'],
  async setup() {
    const auth = useAuth();
    await auth.initialize();

    // The callback route must be allowed to complete the code exchange; it
    // would otherwise bounce back to the IdP forever.
    //
    // Router paths, not browser paths: under a base the browser's path starts
    // with it, and the callback page hands this to `router.replace`, which
    // would add the base a second time.
    const path = withoutBase(window.location.pathname, String(useRuntimeConfig().app?.baseURL ?? '/'));
    if (auth.needsLogin.value && !path.startsWith('/auth/callback')) {
      sessionStorage.setItem('auth:returnTo', `${path}${window.location.search}`);
      await auth.login();
    }
  },
});
