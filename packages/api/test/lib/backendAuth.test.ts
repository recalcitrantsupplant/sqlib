import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveBackendEnvAuth, isValidAuthEnvKey } from '../../src/lib/backendAuth.js';

describe('backendAuth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SQLIB_BACKEND_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SQLIB_BACKEND_')) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it('returns none mode when key is missing', () => {
    expect(resolveBackendEnvAuth()).toEqual({ usedMode: 'none' });
  });

  it('picks basic auth when username and password exist', () => {
    process.env.SQLIB_BACKEND_MAIN_USERNAME = 'user';
    process.env.SQLIB_BACKEND_MAIN_PASSWORD = 'pass';

    expect(resolveBackendEnvAuth('main')).toEqual({
      username: 'user',
      password: 'pass',
      usedKey: 'main',
      usedMode: 'basic',
    });
  });

  it('falls back to header auth when basic credentials absent', () => {
    process.env.SQLIB_BACKEND_MAIN_AUTH_HEADER = 'Bearer token';

    expect(resolveBackendEnvAuth('main')).toEqual({
      authHeader: 'Bearer token',
      usedKey: 'main',
      usedMode: 'header',
    });
  });

  it('returns none when no matching env values exist', () => {
    expect(resolveBackendEnvAuth('missing')).toEqual({ usedKey: 'missing', usedMode: 'none' });
  });

  it('validates auth env keys', () => {
    expect(isValidAuthEnvKey('UPPER_CASE')).toBe(true);
    expect(isValidAuthEnvKey('with-hyphen')).toBe(false);
  });
});
