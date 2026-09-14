/**
 * Call-time errors, kept apart from the modules that raise them.
 *
 * A query call and a group walk are both "the payload does not fit what the
 * bundle carries", so they raise the same error — and they live in different
 * modules that each need the class, which is the whole reason it is here rather
 * than in either of them.
 */

/** Raised when a call does not fit the query or group it names. */
export class QueryCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryCallError';
  }
}
