/**
 * The display name the server records for a person, from their token's
 * claims. It is what every reader of a library sees beside the entities that
 * person created or changed, so it must never be an email address.
 */
import { describe, it, expect } from 'vitest';
import { displayNameOf } from '../../src/auth/principals.js';

describe('displayNameOf', () => {
  it('takes `name` first', () => {
    expect(displayNameOf({ name: 'Alice Ng', preferred_username: 'alice', given_name: 'Alice' })).toBe('Alice Ng');
  });

  it('falls back to `preferred_username` when the token has no `name`, as Rauthy tokens do', () => {
    expect(displayNameOf({ preferred_username: 'alice', email: 'alice@example.org' })).toBe('alice');
  });

  it('falls back to `given_name` and `family_name` after that', () => {
    expect(displayNameOf({ given_name: 'Alice', family_name: 'Ng' })).toBe('Alice Ng');
    expect(displayNameOf({ given_name: 'Alice' })).toBe('Alice');
  });

  it('skips a `preferred_username` that is the email', () => {
    expect(
      displayNameOf({ preferred_username: 'alice@example.org', email: 'alice@example.org', given_name: 'Alice' }),
    ).toBe('Alice');
    expect(displayNameOf({ preferred_username: 'Alice@Example.org', email: 'alice@example.org' })).toBeUndefined();
  });

  it('skips any claim in the form of an email address, with or without an `email` claim', () => {
    expect(displayNameOf({ name: 'bo@example.org', preferred_username: 'bo' })).toBe('bo');
    expect(displayNameOf({ preferred_username: 'bo@example.org' })).toBeUndefined();
  });

  it('gives nothing when the token names nobody, so the person shows as unknown', () => {
    expect(displayNameOf({ email: 'alice@example.org' })).toBeUndefined();
    expect(displayNameOf({ name: '  ', preferred_username: '' })).toBeUndefined();
  });
});
