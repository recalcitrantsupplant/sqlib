/**
 * The line "Copy token" puts on the clipboard, and how its expiry reads.
 *
 * Every snippet reads its token from `SQLIB_TOKEN` (`codeSnippets.ts`), so the
 * person pastes this line into their terminal once and every copied snippet
 * then runs unchanged. The snippets themselves never carry a token, so they
 * stay safe to share.
 */
import { TOKEN_ENV } from './codeSnippets';

/**
 * A POSIX shell `export` line. A JWT holds only base64url characters and dots,
 * so single quotes need no escaping; anything else is refused rather than
 * quoted, because a value that needs quoting is not a token.
 */
export function tokenExportLine(token: string): string {
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(token)) {
    throw new Error('Token holds characters a bearer token cannot hold.');
  }
  return `export ${TOKEN_ENV}='${token}'`;
}

/** The expiry as a local clock time, such as "6:31 PM". */
export function formatExpiry(expiresAt: Date, locale?: string): string {
  return expiresAt.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}
