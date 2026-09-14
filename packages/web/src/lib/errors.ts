/**
 * Turn an unknown thrown value into something worth showing someone.
 *
 * `String(error)` is the obvious thing to reach for and it is wrong for the
 * case that matters: anything thrown that is not an `Error` and not a string
 * renders as "[object Object]", which tells the reader nothing and hides the
 * message that was sitting on the object all along. Rejected fetch payloads and
 * plugin errors both arrive in that shape.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;

  if (error && typeof error === 'object') {
    // The shapes an API or a provider actually rejects with, in order of preference.
    const candidate = error as { message?: unknown; error?: unknown; statusText?: unknown };
    for (const value of [candidate.message, candidate.error, candidate.statusText]) {
      if (typeof value === 'string' && value) return value;
    }
    try {
      const json = JSON.stringify(error);
      // `{}` is no better than "[object Object]", so do not dress it up as detail.
      if (json && json !== '{}') return json;
    } catch {
      // Circular, or a value JSON cannot hold. Fall through to the generic text.
    }
  }

  return 'Something failed, and it gave no reason.';
}
