import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FEATURE_FLAG_ENV_VARS } from '@sparql-query-lib/types';

import { parseDockerfile, productionStage } from './dockerfile.js';

/**
 * `docker run <image>` and a bare `just` start sqlib with the same defaults:
 * the SQLite library store, every feature flag on, and auth disabled.
 *
 * Both lists of flags are written out by hand, in the Dockerfile's ENV and in
 * the Justfile's `all_features`. A flag added to `FEATURE_FLAG_ENV_VARS` and
 * not to them stays at its code default in both, and nothing else reports it.
 * The Justfile missed FEATURE_OGC that way.
 *
 * The state directories are pinned too. Their defaults are relative to the
 * working directory, which is packages/mcp-server in the image's default mode.
 * That directory is root-owned, so a container without these settings could
 * not create its store.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const STORAGE_IN_IMAGE = '/app/packages/api/storage';

/** Every `KEY=value` that an ENV instruction of the production stage sets. */
function imageEnv(): Map<string, string> {
  const source = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
  const env = new Map<string, string>();
  for (const instruction of productionStage(parseDockerfile(source))) {
    if (instruction.keyword !== 'ENV') continue;
    for (const pair of instruction.text.split(/\s+/).slice(1)) {
      const eq = pair.indexOf('=');
      if (eq > 0) env.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  return env;
}

/** The `KEY=value` pairs of the Justfile's `all_features` variable. */
function justfileAllFeatures(): Map<string, string> {
  const source = fs.readFileSync(path.join(repoRoot, 'Justfile'), 'utf8');
  const match = /^all_features := "([^"]*)"/m.exec(source);
  expect(match, 'the Justfile has no all_features variable').toBeTruthy();
  return new Map(match![1].split(/\s+/).filter(Boolean).map((pair) => {
    const [key, value] = pair.split('=');
    return [key, value] as [string, string];
  }));
}

const flagVars = Object.values(FEATURE_FLAG_ENV_VARS);

describe('the defaults of docker run and just', () => {
  it('turns every feature flag on in the image', () => {
    const env = imageEnv();
    const notOn = flagVars.filter((name) => env.get(name) !== 'true');
    expect(notOn, 'Dockerfile ENV does not set these to true').toEqual([]);
  });

  it('turns every feature flag on in the Justfile', () => {
    const features = justfileAllFeatures();
    const notOn = flagVars.filter((name) => features.get(name) !== 'true');
    expect(notOn, 'all_features does not set these to true').toEqual([]);
  });

  it('runs the image on SQLite with auth disabled', () => {
    const env = imageEnv();
    expect(env.get('INTERNAL_BACKEND_TYPE')).toBe('sqlite');
    expect(env.get('SQLIB_AUTH_MODE')).toBe('disabled');
  });

  it('puts every state directory of the image under its volume', () => {
    const env = imageEnv();
    for (const name of ['LIBRARY_STORAGE_DIR', 'SQLIB_AUTH_STORE_DIR', 'OXIGRAPH_STORAGE_DIR', 'ETL_OUTPUT_DIR']) {
      expect(env.get(name), `${name} is not under ${STORAGE_IN_IMAGE}`)
        .toMatch(new RegExp(`^${STORAGE_IN_IMAGE}/`));
    }
  });
});
