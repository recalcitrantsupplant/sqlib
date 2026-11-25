/**
 * The caller in `optional` mode (#238): a guest is no one, and a query that
 * reads the caller asks a guest to sign in.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { CallerRequiredError, callerIdentityOf, requireCallerForSlots } from '../../src/auth/caller.js';
import { PRINCIPAL_ANONYMOUS, PRINCIPAL_AUTHENTICATED, createAnonymousContext, type AuthContext } from '../../src/auth/types.js';

const NO_GRANTS = { admin: false, backends: new Map(), libraries: new Map() };

function requestWith(context: AuthContext): FastifyRequest {
  return { authContext: context, log: { warn: () => undefined }, id: 'r1' } as unknown as FastifyRequest;
}

describe('the caller in optional mode', () => {
  it('names no one for a guest', () => {
    expect(callerIdentityOf(createAnonymousContext(NO_GRANTS, 'optional'))).toBeNull();
  });

  it('names a signed-in caller, though they also hold the anonymous principal', () => {
    const context: AuthContext = {
      subject: 'urn:sqlib:principal:user:abc',
      principals: ['urn:sqlib:principal:user:abc', PRINCIPAL_AUTHENTICATED, PRINCIPAL_ANONYMOUS],
      issuer: 'https://issuer.test/',
      tokenType: 'user',
      grants: NO_GRANTS,
      claims: {},
      fullAccess: false,
      mode: 'optional',
    };
    expect(callerIdentityOf(context)).toEqual({ user: 'urn:sqlib:principal:user:abc', groups: [] });
  });

  it('refuses a guest a query that reads the caller with 401, so the client can sign in', () => {
    const request = requestWith(createAnonymousContext(NO_GRANTS, 'optional'));
    expect(() => requireCallerForSlots(request, ['authUser'])).toThrow(CallerRequiredError);
    try {
      requireCallerForSlots(request, ['authUser']);
    } catch (error) {
      expect((error as CallerRequiredError).statusCode).toBe(401);
    }
  });
});
