export type AuthMode = 'basic' | 'header' | 'none';

export interface EnvAuth {
  username?: string;
  password?: string;
  authHeader?: string;
  usedKey?: string;
  usedMode: AuthMode;
}

export const AUTH_KEY_REGEX = /^[A-Z0-9_]+$/;
export function isValidAuthEnvKey(key: string): boolean {
  return AUTH_KEY_REGEX.test(key);
}

/**
 * Resolve backend auth credentials from environment variables based on authEnvKey.
 * Naming: SQLIB_BACKEND_<KEY>_USERNAME|_PASSWORD|_AUTH_HEADER
 * Precedence: basic (USERNAME+PASSWORD) > header (AUTH_HEADER) > none
 */
export function resolveBackendEnvAuth(authEnvKey?: string | null): EnvAuth {
  const key = (authEnvKey || '').toString().trim();
  if (!key) return { usedMode: 'none' };

  const base = `SQLIB_BACKEND_${key.toUpperCase()}`;
  const u = process.env[`${base}_USERNAME`];
  const p = process.env[`${base}_PASSWORD`];
  if (u && p) return { username: u, password: p, usedKey: key, usedMode: 'basic' };

  const h = process.env[`${base}_AUTH_HEADER`];
  if (h) return { authHeader: h, usedKey: key, usedMode: 'header' };

  return { usedKey: key, usedMode: 'none' };
}

/**
 * The same credentials as request headers.
 *
 * Lives here rather than in each caller because the probe, the prefix service
 * and anything else reaching a store from the server side must agree about how
 * a `SQLIB_BACKEND_*` key becomes an `Authorization` header — a second copy of
 * this is a second place for a store to start answering 401.
 */
export function backendAuthHeaders(authEnvKey?: string | null): Record<string, string> {
  const auth = resolveBackendEnvAuth(authEnvKey);
  if (auth.usedMode === 'basic') {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
    return { authorization: `Basic ${encoded}` };
  }
  if (auth.usedMode === 'header' && auth.authHeader) {
    return { authorization: auth.authHeader };
  }
  return {};
}
