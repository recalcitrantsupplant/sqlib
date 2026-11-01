/**
 * The caller a saved query reads through its identity slots.
 *
 * A query declares `VALUES ?authUser { UNDEF }` or `VALUES ?authGroup { UNDEF }`
 * and sqlib fills them from the sign-in (`SubstitutionOptions` in
 * `@sparql-query-lib/runtime`). This module answers "who is that?" for a
 * request, and says when the answer is "no one".
 *
 * No one is signed in when:
 *
 * - the context has full access: `disabled` mode, `dry-run` without a valid
 *   token, and sqlib's own identity. Their subject is a placeholder;
 * - the mode is `anonymous`: every visitor is the one anonymous principal, so
 *   it identifies nobody;
 * - the run is sqlib's own work (`InternalExecution`).
 *
 * "No one" fills both slots with zero rows. A door that runs a query declaring
 * a slot refuses first (`requireCallerForSlots`), so the zero rows are a safety
 * net, not the answer a caller sees.
 */
import type { FastifyRequest } from 'fastify';
import { isReservedSlotVariable, mayDeclareReservedSlot, type CallerIdentity } from '@sparql-query-lib/runtime';
import { authOf } from './enforce.js';
import { isGroupPrincipal } from './principals.js';
import type { AuthContext } from './types.js';
import { isInternalExecution, type ExecutionAuthScope, type InternalExecution } from './executionScope.js';
import { SparqlQueryParser } from '../lib/parser.js';

export type { CallerIdentity };

/** The caller a context names, or null when it names no one. */
export function callerIdentityOf(context: AuthContext): CallerIdentity | null {
  if (context.fullAccess) return null;
  if (context.mode === 'anonymous') return null;
  if (context.tokenType === 'system') return null;
  return {
    user: context.subject,
    groups: context.principals.filter(isGroupPrincipal),
  };
}

/** The caller of a request. A request that skipped the auth plugin is no one. */
export function callerOfRequest(request: FastifyRequest | null | undefined): CallerIdentity | null {
  return callerIdentityOf(authOf(request));
}

/** The caller an execution scope runs for. sqlib's own work is no one. */
export function callerOfScope(scope: ExecutionAuthScope | InternalExecution | null | undefined): CallerIdentity | null {
  if (!scope || isInternalExecution(scope)) return null;
  return callerOfRequest(scope.request);
}

const defaultParser = new SparqlQueryParser();

/** The identity slots a text declares, by variable name. Empty when it declares none. */
export function declaredReservedSlots(queryString: string | null | undefined, parser = defaultParser): string[] {
  if (!queryString || !mayDeclareReservedSlot(queryString)) return [];
  let groups: string[][];
  try {
    groups = parser.detectInputs(queryString).valuesInputs;
  } catch {
    return [];
  }
  return [...new Set(groups.flat().filter(isReservedSlotVariable))];
}

/**
 * Refused because a query reads the caller and no one is signed in.
 *
 * `401` where a token could have been sent (`required`, `dry-run`), `403`
 * where sign-in does not exist (`disabled`, `anonymous`).
 */
export class CallerRequiredError extends Error {
  constructor(readonly statusCode: 401 | 403, slots: readonly string[]) {
    super(
      statusCode === 401
        ? `This query reads the signed-in caller (${slots.map(s => `?${s}`).join(', ')}). Sign in to run it.`
        : `This query reads the signed-in caller (${slots.map(s => `?${s}`).join(', ')}), and this server has no sign-in.`,
    );
    this.name = 'CallerRequiredError';
  }
}

/**
 * Throws `CallerRequiredError` when a run needs a caller and has none.
 *
 * `dry-run` does not refuse: it logs what it would have refused and runs, with
 * the slots empty. That is what the mode means everywhere else.
 */
export function requireCallerForSlots(request: FastifyRequest, slots: readonly string[]): void {
  if (slots.length === 0) return;
  const context = authOf(request);
  if (callerIdentityOf(context)) return;
  if (context.mode === 'dry-run') {
    request.log.warn(
      { audit: true, wouldRefuse: 'caller-required', slots, requestId: request.id },
      'A query that reads the caller ran with no one signed in (dry-run: allowed, slots empty)',
    );
    return;
  }
  throw new CallerRequiredError(context.mode === 'required' ? 401 : 403, slots);
}

/** `requireCallerForSlots` as a value: the refusal, or null to go on. */
export function callerRefusal(request: FastifyRequest, slots: readonly string[]): CallerRequiredError | null {
  try {
    requireCallerForSlots(request, slots);
    return null;
  } catch (error) {
    if (error instanceof CallerRequiredError) return error;
    throw error;
  }
}

/** The identity slots any query in a group declares. */
export function groupReservedSlots(queryStrings: Iterable<string | null | undefined>, parser = defaultParser): string[] {
  const slots = new Set<string>();
  for (const text of queryStrings) for (const slot of declaredReservedSlots(text, parser)) slots.add(slot);
  return [...slots];
}
