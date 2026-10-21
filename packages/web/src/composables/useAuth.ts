/**
 * OIDC sign-in for the SPA (design §8.1; docs/design/auth-architecture.md).
 *
 * The app self-configures from `/health`: when the API reports `auth.mode` of
 * `disabled` it never touches the IdP and behaves exactly as it did before auth
 * existed. That is what lets one build run on both sides of the rollout flip.
 *
 * Where it signs in comes from the API too: its protected-resource metadata
 * (RFC 9728) names the authorization server and the resource to ask a token
 * for, so a deployment's `config.json` needs only the client id. `authIssuer`
 * still overrides the server the metadata names.
 *
 * UI checks driven by `grants` are convenience only — the server remains the
 * authority, and every affordance this hides is also refused server-side.
 */
// @ts-ignore - Nuxt auto-imports
import { computed, ref, useRuntimeConfig } from '#imports';
import { InMemoryWebStorage, User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { withBase } from '../lib/basePath';

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

/** What the API's protected-resource metadata says, or null when it has none. */
export interface ResourceMetadata {
  issuer?: string;
  resource?: string;
}

let resourceMetadata: ResourceMetadata | null = null;

function apiBase(): string {
  const config = useRuntimeConfig();
  return String(config.public.apiBaseUrl ?? '').replace(/\/$/, '');
}

/**
 * Sign in whatever the API's mode, when the deployment says so.
 *
 * For an API that leaves authentication to a gateway in front of it: the API
 * reports `disabled`, the gateway refuses requests without a token, and the
 * app has to get one anyway. Set by `authRequireLogin` in `/config.json`.
 */
function requireLogin(): boolean {
  const config = useRuntimeConfig();
  return config.public.authRequireLogin === true;
}

/** Whether this app signs in: the API demands it, or the deployment does. */
function signsIn(): boolean {
  return mode.value !== 'disabled' || requireLogin();
}

/**
 * Where the signed-in user is kept (`authTokenStorage`). `memory`, the
 * default, keeps the tokens out of web storage, where any script on the page
 * could read them; a reload then signs in again through the broker, without a
 * form while the broker's session lives. `session` survives a reload in this
 * tab, and `local` survives it in every tab, for a broker that cannot sign in
 * silently. Anything else is `memory`.
 */
export function userStoreFor(kind: unknown): Storage {
  if (kind === 'local') return window.localStorage;
  if (kind === 'session') return window.sessionStorage;
  return new InMemoryWebStorage();
}

/**
 * The OIDC settings, from the runtime config and the API's metadata. The
 * configured issuer wins over the metadata's; the resource is only ever the
 * API's. Exported for the tests.
 */
export function oidcSettings(
  publicConfig: Record<string, unknown>,
  metadata: ResourceMetadata | null
): { authority: string; clientId: string; scope: string; audience: string; resource: string } | null {
  const authority = String(publicConfig.authIssuer ?? '').trim() || metadata?.issuer || '';
  const clientId = String(publicConfig.authClientId ?? '').trim();
  if (!authority || !clientId) return null;
  return {
    authority,
    clientId,
    scope: String(publicConfig.authScope ?? 'openid profile email').trim(),
    audience: String(publicConfig.authAudience ?? '').trim(),
    resource: metadata?.resource ?? '',
  };
}

function buildManager(): UserManager | null {
  const config = useRuntimeConfig();
  const settings = oidcSettings(config.public, resourceMetadata);
  if (!settings) return null;
  const { authority, clientId, scope, audience, resource } = settings;
  // Under the base the app is served from, which is where the callback page
  // and the app's root are; the site root may be another application.
  const base = String(config.app?.baseURL ?? '/');

  return new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: `${window.location.origin}${withBase('/auth/callback', base)}`,
    post_logout_redirect_uri: `${window.location.origin}${withBase('/', base)}`,
    response_type: 'code',
    scope,
    // RFC 8707: sent on the authorization and token requests, so the token
    // names the API in `aud`. The MCP specification requires it of clients,
    // and a broker that follows it binds the token to this value.
    ...(resource ? { resource } : {}),
    // Silent renew keeps long editing sessions from dying mid-edit. With a
    // refresh token it is a token request; without one, a hidden iframe,
    // which a broker that refuses framing (Rauthy) does not allow.
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: userStoreFor(config.public.authTokenStorage) }),
    ...(audience ? { extraQueryParams: { audience } } : {}),
  });
}

/**
 * Reads the API's protected-resource metadata. Absent (404, an older API, a
 * network failure), the configured issuer is all there is.
 */
async function fetchResourceMetadata(): Promise<ResourceMetadata | null> {
  try {
    const response = await fetch(`${apiBase()}/.well-known/oauth-protected-resource`);
    if (!response.ok) return null;
    const payload = (await response.json()) as { resource?: unknown; authorization_servers?: unknown };
    const servers = Array.isArray(payload.authorization_servers) ? payload.authorization_servers : [];
    return {
      issuer: typeof servers[0] === 'string' ? servers[0] : undefined,
      resource: typeof payload.resource === 'string' ? payload.resource : undefined,
    };
  } catch {
    return null;
  }
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

      if (!signsIn()) {
        initialized.value = true;
        return;
      }

      resourceMetadata = await fetchResourceMetadata();
      manager ??= buildManager();
      if (!manager) {
        console.warn(
          '[auth] API requires authentication but no clientId is configured, or no issuer is known from config or the API.'
        );
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
    if (!signsIn()) return null;
    if (!user.value || user.value.expired) {
      manager ??= buildManager();
      const renewed = await manager?.getUser();
      user.value = renewed && !renewed.expired ? renewed : null;
    }
    return user.value?.access_token ?? null;
  };

  return {
    mode: computed(() => mode.value),
    /** True only when the API or the deployment demands a token and we do not have one. */
    needsLogin: computed(() => (mode.value === 'required' || requireLogin()) && !user.value),
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
