/**
 * Reading an export bundle, and picking one entry out of it.
 *
 * A bundle comes from `sqlib pull` or the server's export. Each one is checked
 * on load twice over: its shape, then every template's and document's hash,
 * so a bundle someone edited by hand is refused before anything runs.
 */
import {
  InvalidBundleError,
  assertValidBundle,
  verifyBundleIntegrity,
  type ExportBundle,
} from '@sparql-query-lib/runtime';
import { CliError, readInput, type Io } from './io.js';

/** Read, validate and verify a bundle file. */
export async function readBundle(io: Io, file: string): Promise<ExportBundle> {
  let bundle: unknown;
  try {
    bundle = JSON.parse(await readInput(io, file));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`${file} is not JSON: ${(error as Error).message}`);
  }
  // The server's export route answers `{ bundle, skipped }`; accept that too,
  // so a saved response works as well as a pulled file.
  if (bundle && typeof bundle === 'object' && 'bundle' in bundle && !('version' in bundle)) {
    bundle = (bundle as { bundle: unknown }).bundle;
  }
  try {
    assertValidBundle(bundle);
    await verifyBundleIntegrity(bundle);
  } catch (error) {
    if (error instanceof InvalidBundleError) throw new CliError(`${file}: ${error.message}`);
    throw error;
  }
  return bundle;
}

/** One entry of a bundle map, or an error that lists what the bundle has. */
export function pick<T>(map: Record<string, T> | undefined, key: string, kind: string, file: string): T {
  // Own keys only: `--query toString` names nothing in the bundle.
  if (map && Object.hasOwn(map, key)) return map[key]!;
  const keys = Object.keys(map ?? {});
  throw new CliError(
    `${file} has no ${kind} '${key}'. ${keys.length > 0 ? `It has: ${keys.join(', ')}.` : `It has no ${kind}s.`}`,
  );
}
