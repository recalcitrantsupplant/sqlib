/**
 * Boots the auth state before the app renders.
 *
 * Runs after `runtime-config.client` so the OIDC settings are already in place.
 * When the API reports `disabled` this resolves without contacting any IdP,
 * which is what keeps a no-auth deployment working with the same build.
 */
// @ts-ignore - Nuxt auto-imports
import { defineNuxtPlugin } from '#imports';
import { useAuth } from '../composables/useAuth';

export default defineNuxtPlugin({
  name: 'auth',
  dependsOn: ['runtime-config'],
  async setup() {
    const auth = useAuth();
    await auth.initialize();

    // The callback route must be allowed to complete the code exchange; it
    // would otherwise bounce back to the IdP forever.
    const path = window.location.pathname;
    if (auth.needsLogin.value && !path.startsWith('/auth/callback')) {
      sessionStorage.setItem('auth:returnTo', `${path}${window.location.search}`);
      await auth.login();
    }
  },
});
