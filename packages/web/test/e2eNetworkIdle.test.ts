/**
 * No functional e2e spec may wait for the network to fall idle.
 *
 * `networkidle` resolves when no request has been in flight for 500ms, which
 * makes every spec that waits for it hostage to any request that never
 * finishes. One request left pending — an HMR websocket, a poll, a service on
 * the machine that answers slowly — and the wait cannot resolve, so the spec
 * burns its whole 60s timeout and reports as a timeout rather than as the
 * environment problem it is.
 *
 * That is not hypothetical. It took out 132 of 377 specs on the self-hosted
 * runner in one run and again in its re-run, with the two attempts agreeing to
 * the spec: every failure was a `networkidle` waiter, and nothing that did not
 * wait for it failed. The same tree passed 377/377 locally in 3.3 minutes,
 * because the pending request was on that machine and not in the code — which
 * is exactly what makes the wait a bad gate. It fails where nobody can debug it
 * and passes where everybody can.
 *
 * Two specs had already been bitten and carry comments saying so
 * (`ruleset-execution`, `ruleset-srl-authoring`, both against a dev server's
 * HMR socket). A comment in two files does not stop the pattern being copied
 * into the next twenty, which is what happened. Hence a guard.
 *
 * The replacement is what those two already do: navigate with
 * `waitUntil: 'domcontentloaded'` and then wait for a concrete element. With
 * `ssr: false` the shell is client-rendered, so `.app-layout` appearing *is*
 * the "app has mounted" signal — a real milestone rather than a guess about
 * traffic. Everything after it can lean on Playwright's own auto-waiting.
 *
 * `perf/` is exempt: those specs measure how long a full cold load takes, so
 * "the network has gone quiet" is the thing being measured rather than an
 * incidental wait. They are excluded from CI (`--grep-invert @perf`) and run on
 * a machine whose state their author controls.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const E2E = resolve(import.meta.dirname, '../tests/e2e');

/** Measuring a cold load is the one job `networkidle` is the right tool for. */
const EXEMPT_DIRS = ['perf'];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return EXEMPT_DIRS.includes(entry.name) ? [] : walk(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });

/**
 * A mention is not a use.
 *
 * The two specs that learned this the hard way explain themselves in comments
 * that name `networkidle`, and those comments are the reason the next person
 * does not reintroduce it. A guard that failed them would delete its own
 * documentation, so only code counts: comment bodies are stripped first.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('e2e specs do not wait for network idle', () => {
  it('no functional spec or helper uses networkidle', () => {
    const offenders = walk(E2E)
      .filter((file) => stripComments(readFileSync(file, 'utf8')).includes('networkidle'))
      .map((file) => relative(E2E, file));

    expect(
      offenders,
      offenders.length
        ? `Waiting for networkidle makes a spec hostage to any request that never settles.\n`
          + `Navigate with { waitUntil: 'domcontentloaded' } and wait for a concrete\n`
          + `element instead — \`.app-layout\` is the app-mounted signal:\n`
          + offenders.map((file) => `  - ${file}`).join('\n')
        : '',
    ).toEqual([]);
  });

  /* The guard is worthless if it cannot see a violation, so prove that it can. */
  it('sees a use, and ignores a mention in a comment', () => {
    expect(stripComments("await page.goto('/', { waitUntil: 'networkidle' });")).toContain('networkidle');
    expect(stripComments('// deliberately not waitForLoadState(\'networkidle\')')).not.toContain('networkidle');
    expect(stripComments('/* not networkidle: the HMR socket never settles */')).not.toContain('networkidle');
  });
});
