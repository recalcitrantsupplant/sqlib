/**
 * What the account button at the foot of the rail says you are.
 */
import { describe, it, expect } from 'vitest';
import { accountStateOf, identityFrom, initialsOf, issuerHost } from '@/lib/account';

describe('identityFrom', () => {
  it('takes the name and email from the ID token profile', () => {
    expect(identityFrom({ name: 'Priya Shah', email: 'priya@example.com' })).toEqual({
      name: 'Priya Shah',
      email: 'priya@example.com',
    });
  });

  it('builds a name from given and family names, then the username', () => {
    expect(identityFrom({ given_name: 'Priya', family_name: 'Shah' }).name).toBe('Priya Shah');
    expect(identityFrom({ preferred_username: 'pshah' }).name).toBe('pshah');
  });

  it('falls back to the label the server recorded', () => {
    expect(identityFrom(null, 'priya@example.com')).toEqual({ name: null, email: 'priya@example.com' });
    expect(identityFrom({}, 'pshah')).toEqual({ name: 'pshah', email: null });
  });
});

describe('initialsOf', () => {
  it('uses the first and last words of the name', () => {
    expect(initialsOf({ name: 'Priya Anjali Shah', email: null })).toBe('PS');
    expect(initialsOf({ name: 'priya', email: null })).toBe('P');
  });

  it('uses the email when there is no name, and nothing when there is neither', () => {
    expect(initialsOf({ name: null, email: 'sam@example.com' })).toBe('S');
    expect(initialsOf({ name: null, email: null })).toBe('');
  });

  it('skips words with no letters or digits', () => {
    expect(initialsOf({ name: 'Ana — López', email: null })).toBe('AL');
  });
});

describe('accountStateOf', () => {
  it('is a guest in an anonymous deployment, whatever else is true', () => {
    expect(accountStateOf({ mode: 'anonymous', signedIn: false, lapsed: false })).toBe('guest');
  });

  it('is signed in with a token, expired after one lapsed, and none otherwise', () => {
    expect(accountStateOf({ mode: 'required', signedIn: true, lapsed: false })).toBe('signed-in');
    expect(accountStateOf({ mode: 'required', signedIn: false, lapsed: true })).toBe('expired');
    expect(accountStateOf({ mode: 'disabled', signedIn: false, lapsed: false })).toBe('none');
  });
});

describe('issuerHost', () => {
  it('shows the host of the issuer URL', () => {
    expect(issuerHost('https://auth.example.com/auth/v1')).toBe('auth.example.com');
    expect(issuerHost(null)).toBeNull();
  });
});
