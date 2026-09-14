/**
 * Normalizes an unknown thrown value (from a `catch (e: unknown)` clause) into an
 * `Error`. Error instances are returned as-is; anything else is wrapped so callers
 * can safely read `.message`/`.stack`. The optional `statusCode`/`code` fields carry
 * the ad-hoc properties that parts of this codebase attach to thrown errors, and the
 * index signature keeps access to any other custom field type-safe (as `unknown`).
 */
export type NormalizedError = Error & {
  statusCode?: number;
  code?: string | number;
  [key: string]: unknown;
};

export function toError(value: unknown): NormalizedError {
  if (value instanceof Error) {
    return value as NormalizedError;
  }
  return new Error(typeof value === 'string' ? value : String(value)) as NormalizedError;
}
