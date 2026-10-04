/**
 * The caller sent something this server will not store, and can fix it.
 *
 * The one error class a route answers with 400 and the error's own message.
 * Anything else a writer throws is a server fault: logged, answered 500 and
 * masked, because its message was written for an operator rather than a
 * caller. Writers used to throw a plain `Error` for both, and each route
 * decided by module which kind it was — rules and data blocks answered 400 for
 * anything, queries 500 for anything — so the same failure had a different
 * status depending on the entity.
 *
 * Domain errors that are the caller's to fix extend this rather than restating
 * the status (`DataGraphContentError`, `TupleContentError`, `TestVersionError`).
 */
export class ValidationError extends Error {
  readonly statusCode: number = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
