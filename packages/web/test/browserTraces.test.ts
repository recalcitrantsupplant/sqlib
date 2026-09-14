import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';

/**
 * What the built app is allowed to say to a stranger's console.
 *
 * `console.log` is how a composable gets written and, unless something removes
 * it, how the composable stays. Nothing here removed it: `useApiClient`
 * narrated every request and response with the payload, `useLibrariesStore`
 * printed nine lines for one library rename, `parseCsv` printed a 200-character
 * slice of whatever was pasted, and `buildVersionCreatePayload` printed the
 * whole execution-node list on every save — all of it unconditional, so all of
 * it in the production bundle.
 *
 * The channel is `src/lib/debug.ts`: `console.debug`, silent outside
 * development. `console.warn` and `console.error` are deliberately untouched
 * and are not what this checks — a warning names something the user's console
 * should carry, and an error is the last record of a failure. Only the running
 * commentary is disallowed.
 *
 * The guard was a bargain per directory, the way the design-system passes make
 * theirs: `src/composables`, `src/lib` and `src/plugins` were **closed** — a
 * `console.log` there fails, full stop — while `src/components` and `src/pages`
 * were held at a per-file count that emptied itself as the screens converted.
 * That list is now empty, so those two are closed as well and the bargain is
 * over: **no directory in `src` may write a raw trace.**
 *
 * The count is gone with the debt it tracked, and the third check below has
 * taken its place rather than being deleted. What it holds now is the thing the
 * per-directory list could never say: a directory nobody has thought about. The
 * closed list names five directories, and `src` may grow a sixth — the check
 * fails on a trace anywhere the five do not reach, so a new `src/widgets/` is
 * guarded from its first file rather than from whenever someone remembers to
 * add it here.
 */

const SRC = resolve(import.meta.dirname, '../src');

/** Directories where a raw trace is an error rather than a debt: all of them. */
const CLOSED = ['composables', 'lib', 'plugins', 'components', 'pages'];

/** The channel itself, which is the one place the call may be written. */
const CHANNEL = 'lib/debug.ts';

/**
 * The history of the count this check used to carry, kept because the passes
 * are the argument for closing the directories rather than a changelog.
 *
 * The second pass took the four the first pass listed and did not hold for a
 * reason of its own — `pages/index.vue` (21), `AddLibraryDialog` (15),
 * `SparqlDiffViewer` (4) and the rule-viewer mockup (1). None of the 41 said
 * anything a network trace does not: the two dialogs narrated their own props
 * and form state, the diff viewer measured its own boxes, and `index.vue`'s
 * four "load failed, clearing selection" lines restated a failure the work
 * area that emitted the event had already put on the console as an error and
 * in front of the user as a toast.
 *
 * The third pass took two of the three the second held — `QueryWorkArea` (23)
 * and `NavigationSidebar` (19) — the branches that had claimed them having
 * landed. `QueryWorkArea` narrated its own load: which watcher fired, that it
 * was about to fetch, that the fetch returned, which media type it picked.
 * `useApiClient` already traces the request and the response through the
 * channel, so the loud half of a load was the half that crossed nothing.
 *
 * The fourth pass took the last, `QueryGroupWorkArea` (6), held twice because
 * #448 and #449 were rewriting the file. Both landed. All six were inside the
 * rule-set assignment flow, narrating a handler either side of guards that
 * already `console.error` and toast — the entry, the node lookup, the dialog
 * opening, and one line per edge whose ports the assignment filled in.
 */

/** `console.log(` and `console.debug(` — the call, not a mention in prose. */
const TRACE = /console\.(log|debug)\s*\(/g;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|vue)$/.test(entry.name) ? [path] : [];
  });

/** Posix-style, so the keys above read the same on any machine. */
const key = (path: string) => relative(SRC, path).split(sep).join('/');

const counted = new Map<string, number>();
for (const path of sourceFiles(SRC)) {
  const hits = readFileSync(path, 'utf8').match(TRACE)?.length ?? 0;
  if (hits > 0) counted.set(key(path), hits);
}

describe('traces in the built app', () => {
  it.each(CLOSED)('src/%s writes no raw console.log', (dir) => {
    const offenders = [...counted.keys()].filter(
      (file) => file.startsWith(`${dir}/`) && file !== CHANNEL,
    );
    expect(
      offenders,
      `${offenders.join(', ')}: this directory is closed — trace through src/lib/debug.ts instead`,
    ).toEqual([]);
  });

  it('writes the console.debug calls in the channel and nowhere else', () => {
    // Two: the message alone, and the message with its detail. If this number
    // moves, the channel has grown a case and the closed-directory rule above
    // is checking a different thing than it was written to check.
    expect(counted.get(CHANNEL)).toBe(2);
  });

  it('leaves nowhere in src that the closed list does not reach', () => {
    const unreached = [...counted.keys()].filter(
      (file) => file !== CHANNEL && !CLOSED.some((dir) => file.startsWith(`${dir}/`)),
    );
    expect(
      unreached,
      `${unreached.join(', ')}: a trace outside every closed directory — trace through src/lib/debug.ts, and if this is a new directory of src, add it to CLOSED`,
    ).toEqual([]);
  });
});
