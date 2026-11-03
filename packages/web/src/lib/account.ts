/**
 * Who the account button at the foot of the rail says you are.
 *
 * Kept out of the component so the four states and the initials rule can be
 * tested without mounting a menu. The server is still the authority on what a
 * caller may do; this only decides what the rail shows.
 */

/**
 * - `signed-in`: a token we can use.
 * - `expired`: we had a token and it lapsed; the button offers to sign in again.
 * - `guest`: an `anonymous` deployment, where nobody signs in and the anonymous
 *   principal's grants are what a visitor holds.
 * - `none`: auth is off, or sign-in has not happened; there is no account to show.
 */
export type AccountState = 'signed-in' | 'expired' | 'guest' | 'none';

export interface AccountIdentity {
  name: string | null;
  email: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Name and email from the ID token's profile claims, falling back to the label
 * the server recorded from the access token when the profile has neither.
 */
export function identityFrom(
  profile: Record<string, unknown> | null | undefined,
  serverLabel?: string | null
): AccountIdentity {
  const email = text(profile?.email) ?? (text(serverLabel)?.includes('@') ? text(serverLabel) : null);
  const name =
    text(profile?.name) ??
    ([text(profile?.given_name), text(profile?.family_name)].filter(Boolean).join(' ') || null) ??
    text(profile?.preferred_username) ??
    (text(serverLabel) && text(serverLabel) !== email ? text(serverLabel) : null);
  return { name, email };
}

/** Up to two letters: first and last word of the name, else the email's first letter. */
export function initialsOf(identity: AccountIdentity): string {
  const words = (identity.name ?? '').split(/\s+/).filter((word) => /\p{L}|\p{N}/u.test(word));
  if (words.length >= 2) return (firstLetter(words[0]) + firstLetter(words[words.length - 1])).toUpperCase();
  if (words.length === 1) return firstLetter(words[0]).toUpperCase();
  return firstLetter(identity.email ?? '').toUpperCase();
}

function firstLetter(word: string): string {
  return word.match(/\p{L}|\p{N}/u)?.[0] ?? '';
}

export function accountStateOf(input: {
  mode: string;
  signedIn: boolean;
  lapsed: boolean;
}): AccountState {
  if (input.mode === 'anonymous') return 'guest';
  if (input.signedIn) return 'signed-in';
  if (input.lapsed) return 'expired';
  return 'none';
}

/** The issuer's host, which is how people know their identity provider. */
export function issuerHost(issuer: string | null | undefined): string | null {
  if (!issuer) return null;
  try {
    return new URL(issuer).host;
  } catch {
    return issuer;
  }
}
