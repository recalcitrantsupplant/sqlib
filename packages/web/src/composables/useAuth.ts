/**
 * OIDC sign-in for the SPA (design §8.1).
 *
 * The app self-configures from `/health`: when the API reports `auth.mode` of
 * `disabled` it never touches the IdP and behaves exactly as it did before auth
 * existed. That is what lets one build run on both sides of the rollout flip.
 *
 * UI checks driven by `grants` are convenience only — the server remains the
 * authority, and every affordance this hides is also refused server-side.
 */
// @ts-ignore - Nuxt auto-imports
import { computed, ref, useRuntimeConfig } from '#imports';
import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

export type AuthMode = 'disabled' | 'dry-run' | 'required';

export interface AuthMe {
  authMode: AuthMode;
  authenticated: boolean;
  subject: string;
  issuer: string | null;
  tokenType: string;
  principals: string[];
  admin: boolean;
  libraries: Record<string, string[]>;
  backends: Record<string, string[]>;
}

const mode = ref<AuthMode>('disabled');
const user = ref<User | null>(null);
const me = ref<AuthMe | null>(null);
const initialized = ref(false);
const initializing = ref<Promise<void> | null>(null);

let manager: UserManager | null = null;

function apiBase(): string {
  const config = useRuntimeConfig();
  return String(config.public.apiBaseUrl ?? '').replace(/\/$/, '');
}

function buildManager(): UserManager | null {
  const config = useRuntimeConfig();
  const authority = String(config.public.authIssuer ?? '').trim();
  const clientId = String(config.public.authClientId ?? '').trim();
  if (!authority || !clientId) return null;

  const audience = String(config.public.authAudience ?? '').trim();
  const scope = String(config.public.authScope ?? 'openid profile email').trim();

  return new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: window.location.origin,
    response_type: 'code',
    scope,
    // Silent renew keeps long editing sessions from dying mid-edit.
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    ...(audience ? { extraQueryParams: { audience } } : {}),
  });
}

/** Reads the API's auth mode. A failure here must not block the whole app. */
async function fetchMode(): Promise<AuthMode> {
  try {
    const response = await fetch(`${apiBase()}/health`);
    if (!response.ok) return 'disabled';
    const payload = (await response.json()) as { auth?: { mode?: AuthMode } };
    return payload.auth?.mode ?? 'disabled';
  } catch {
    return 'disabled';
  }
}

async function refreshMe(): Promise<void> {
  const token = user.value?.access_token;
  if (!token) {
    me.value = null;
    return;
  }
  try {
    const response = await fetch(`${apiBase()}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    me.value = response.ok ? ((await response.json()) as AuthMe) : null;
  } catch {
    me.value = null;
  }
}

export function useAuth() {
  const initialize = async (): Promise<void> => {
    if (initialized.value) return;
    if (initializing.value) return initializing.value;

    initializing.value = (async () => {
      mode.value = await fetchMode();

      if (mode.value === 'disabled') {
        initialized.value = true;
        return;
      }

      manager ??= buildManager();
      if (!manager) {
        console.warn('[auth] API requires authentication but no issuer/clientId is configured.');
        initialized.value = true;
        return;
      }

      user.value = await manager.getUser();
      if (user.value?.expired) user.value = null;
      await refreshMe();
      initialized.value = true;
    })();

    await initializing.value;
    initializing.value = null;
  };

  const login = async (): Promise<void> => {
    manager ??= buildManager();
    await manager?.signinRedirect();
  };

  const completeLogin = async (): Promise<void> => {
    manager ??= buildManager();
    if (!manager) return;
    user.value = await manager.signinRedirectCallback();
    await refreshMe();
  };

  const logout = async (): Promise<void> => {
    await manager?.signoutRedirect();
    user.value = null;
    me.value = null;
  };

  /** The token for outgoing API calls, refreshed if it has expired. */
  const accessToken = async (): Promise<string | null> => {
    if (mode.value === 'disabled') return null;
    if (!user.value || user.value.expired) {
      manager ??= buildManager();
      const renewed = await manager?.getUser();
      user.value = renewed && !renewed.expired ? renewed : null;
    }
    return user.value?.access_token ?? null;
  };

  return {
    mode: computed(() => mode.value),
    /** True only when the API demands a token and we do not have one. */
    needsLogin: computed(() => mode.value === 'required' && !user.value),
    isAuthenticated: computed(() => Boolean(user.value)),
    isAdmin: computed(() => me.value?.admin ?? mode.value === 'disabled'),
    me: computed(() => me.value),
    initialize,
    login,
    completeLogin,
    logout,
    accessToken,
    refreshMe,
    /** UI convenience: does the caller hold `mode` on this library? */
    canLibrary: (libraryIri: string, libraryMode: string): boolean => {
      if (mode.value === 'disabled') return true;
      const current = me.value;
      if (!current) return false;
      if (current.admin) return true;
      return current.libraries[libraryIri]?.includes(libraryMode) ?? false;
    },
  };
}
