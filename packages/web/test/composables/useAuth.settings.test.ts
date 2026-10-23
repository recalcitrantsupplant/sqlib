/**
 * Where the SPA signs in, and where it keeps the result.
 *
 * The API's protected-resource metadata names the authorization server and the
 * resource, so a deployment's `config.json` needs only a client id. An explicit
 * `authIssuer` still wins, because a deployment may front the broker with a
 * URL the API does not know.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryWebStorage } from 'oidc-client-ts';
import { oidcSettings, userStoreFor } from '@/composables/useAuth';

const metadata = { issuer: 'https://broker.test/auth/v1/', resource: 'https://sqlib.test/mcp' };

describe('oidcSettings', () => {
  it('takes the issuer and the resource from the metadata when only the client id is configured', () => {
    expect(oidcSettings({ authClientId: 'sqlib-web' }, metadata)).toEqual({
      authority: 'https://broker.test/auth/v1/',
      clientId: 'sqlib-web',
      scope: 'openid profile email',
      audience: '',
      resource: 'https://sqlib.test/mcp',
    });
  });

  it('lets a configured issuer override the metadata, and keeps the resource the API named', () => {
    const settings = oidcSettings({ authClientId: 'sqlib-web', authIssuer: ' https://other.test/ ' }, metadata);
    expect(settings?.authority).toBe('https://other.test/');
    expect(settings?.resource).toBe('https://sqlib.test/mcp');
  });

  it('works from config alone against an API without metadata', () => {
    const settings = oidcSettings(
      { authClientId: 'sqlib-web', authIssuer: 'https://idp.test/', authAudience: 'sqlib-api', authScope: 'openid groups' },
      null
    );
    expect(settings).toMatchObject({ authority: 'https://idp.test/', audience: 'sqlib-api', scope: 'openid groups', resource: '' });
  });

  it('has nothing to sign in with without a client id, or without any issuer', () => {
    expect(oidcSettings({}, metadata)).toBeNull();
    expect(oidcSettings({ authClientId: 'sqlib-web' }, null)).toBeNull();
    expect(oidcSettings({ authClientId: 'sqlib-web' }, {})).toBeNull();
  });
});

describe('userStoreFor', () => {
  it('keeps the user in memory by default, and in web storage only when asked', () => {
    expect(userStoreFor(undefined)).toBeInstanceOf(InMemoryWebStorage);
    expect(userStoreFor('memory')).toBeInstanceOf(InMemoryWebStorage);
    expect(userStoreFor('anything')).toBeInstanceOf(InMemoryWebStorage);
    expect(userStoreFor('session')).toBe(window.sessionStorage);
    expect(userStoreFor('local')).toBe(window.localStorage);
  });
});
