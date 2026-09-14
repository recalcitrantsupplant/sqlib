/** A SPARQL update this package cannot turn into a quad diff (yet). */
export class UnsupportedUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedUpdateError';
  }
}

/**
 * Enumerating a graph operation would have materialised more triples than the
 * caller allowed.
 *
 * A subclass, because every caller that already refuses an unsupported update
 * should refuse this too — but the counts are carried so a caller that wants to
 * offer "enumerate anyway" can say what it would cost.
 */
export class EnumerationCapExceededError extends UnsupportedUpdateError {
  readonly count: number;
  readonly cap: number;

  constructor(message: string, count: number, cap: number) {
    super(message);
    this.name = 'EnumerationCapExceededError';
    this.count = count;
    this.cap = cap;
  }
}
