import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * The visual lane's inventory, checked where the lane itself cannot run.
 *
 * `@visual` specs are excluded from CI on purpose: the baselines carry the
 * authoring machine's font rasterisation and a runner's differs
 * (`scripts/ci/e2e.sh`). The cost of that exclusion is that nothing notices
 * when a shot and its baseline part company — and they had. Renaming the three
 * playground screens to sections left `sparql-playground`, `rules-playground`
 * and `etl-playground` on disk with no spec that reads them, and left
 * `rules-section`, `etl-section` and `bench-section` as shots with nothing to
 * compare against. Both halves were found by hand, twice, months apart.
 *
 * Comparing names needs no browser, so it can run here every time:
 *
 * - a shot with no committed baseline fails, unless it is listed as pending
 * - a committed baseline no shot produces fails — it is dead weight, and it
 *   also hides the shot it used to belong to
 * - a pending entry that has since been baselined fails, so the list empties
 *   itself rather than rotting
 *
 * "Pending" exists because a baseline can only be made on the machine that owns
 * the others: a shot added from a container is legitimately unbaselined until
 * that machine runs the lane once. Recording it is the difference between a
 * debt and a hole.
 */

const WEB_ROOT = resolve(import.meta.dirname, '..');
const E2E_DIR = join(WEB_ROOT, 'tests/e2e');
const PENDING_FILE = join(E2E_DIR, 'visual-baselines-pending.txt');

/** `sidebar-light.png` is stored as `sidebar-light-chromium-linux.png`. */
const PROJECT_SUFFIX = '-chromium-linux';

const specFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(path);
    return entry.name.endsWith('.spec.ts') ? [path] : [];
  });

/** A `for (const … of [...] as const)` block, and the strings its header binds. */
type Loop = { start: number; end: number; bindings: Map<string, string[]> };

/**
 * The end of the block a loop header opens.
 *
 * Scoping matters rather than being tidy: `visual-regression.spec.ts` binds
 * `name` twice, once over the dialogs and once over the galleries, and a
 * file-wide map crosses them — which reads `dialog-${name}` as a shot per
 * gallery and loses all three dialog baselines to the orphan list.
 */
const blockEnd = (source: string, from: number): number => {
  const open = source.indexOf('{', from);
  if (open === -1) return source.length;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return source.length;
};

/**
 * Two header shapes appear in the suite and both are used to write shot names:
 * `for (const theme of ['light', 'dark'] as const)` binds one name to every
 * string, and `for (const [name, route] of [[…], […]] as const)` binds each
 * identifier to that position of every tuple. A header without `as const` is
 * not a source of shot names and is deliberately not matched — the body pattern
 * stops at `{`, `}` or `;` so a plain `for (const category of [...])` cannot
 * swallow the header of the next loop looking for its `] as const)`.
 */
const loops = (source: string): Loop[] => {
  const header =/for \(const (\[[^\]]*\]|[A-Za-z_$][\w$]*) of \[([^{};]*?)\] as const\)/g;

  return [...source.matchAll(header)].map((match) => {
    const [full, target, body] = match;
    const bindings = new Map<string, string[]>();
    const tuples = [...body.matchAll(/\[([^[\]]*)\]/g)].map(([, tuple]) =>
      [...tuple.matchAll(/'([^']*)'/g)].map(([, value]) => value),
    );
    const flat = [...body.matchAll(/'([^']*)'/g)].map(([, value]) => value);

    if (target.startsWith('[')) {
      const names = [...target.matchAll(/[A-Za-z_$][\w$]*/g)].map(([name]) => name);
      names.forEach((name, index) => {
        const values = tuples.map((tuple) => tuple[index]).filter((value): value is string => value !== undefined);
        if (values.length) bindings.set(name, values);
      });
    } else if (flat.length) {
      bindings.set(target, flat);
    }

    const start = match.index!;
    return { start, end: blockEnd(source, start + full.length), bindings };
  });
};

/** Every file name `expect(...).toHaveScreenshot(...)` in one spec can write. */
const shotsIn = (source: string, file: string): string[] => {
  const scopes = loops(source);
  const calls = [...source.matchAll(/toHaveScreenshot\(\s*(`[^`]*`|'[^']*')/g)];

  return calls.flatMap((call) => {
    const template = call[1].slice(1, -1);
    const at = call.index!;
    // Innermost first, so the nearest `for (const [name, …])` wins.
    const enclosing = scopes
      .filter((scope) => at > scope.start && at < scope.end)
      .sort((left, right) => right.start - left.start);
    const bindings = new Map<string, string[]>();
    for (const scope of enclosing) {
      for (const [name, values] of scope.bindings) if (!bindings.has(name)) bindings.set(name, values);
    }

    const placeholders = [...new Set([...template.matchAll(/\$\{([^}]*)\}/g)].map(([, name]) => name.trim()))];

    /*
     * A placeholder this parser cannot resolve is a failure rather than a skip.
     * Skipping it would let a shot disappear from the inventory silently, which
     * is the exact failure this file exists to stop.
     */
    for (const placeholder of placeholders) {
      if (!bindings.has(placeholder)) {
        throw new Error(
          `${file}: cannot resolve \${${placeholder}} in screenshot name "${template}". ` +
            `Name the shot with a literal, or bind the value in a \`for (const … of [...] as const)\` header.`,
        );
      }
    }

    return placeholders.reduce<string[]>(
      (names, placeholder) =>
        names.flatMap((name) =>
          bindings.get(placeholder)!.map((value) => name.replaceAll(`\${${placeholder}}`, value)),
        ),
      [template],
    );
  });
};

/** Shot name -> the baseline path it is compared against, relative to `tests/e2e`. */
const baselinePath = (specFile: string, shot: string) => {
  const dir = `${specFile.slice(E2E_DIR.length + 1)}-snapshots`;
  return `${dir}/${shot.replace(/\.png$/, `${PROJECT_SUFFIX}.png`)}`;
};

const expectedBaselines = (): Set<string> => {
  const expected = new Set<string>();
  for (const file of specFiles(E2E_DIR)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('toHaveScreenshot')) continue;
    for (const shot of shotsIn(source, file.slice(WEB_ROOT.length + 1))) {
      expected.add(baselinePath(file, shot));
    }
  }
  return expected;
};

const committedBaselines = (): Set<string> => {
  const committed = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.png')) committed.add(path.slice(E2E_DIR.length + 1));
    }
  };
  walk(E2E_DIR);
  return committed;
};

const pendingBaselines = (): string[] =>
  existsSync(PENDING_FILE)
    ? readFileSync(PENDING_FILE, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter(Boolean)
    : [];

describe('visual regression baselines', () => {
  const expected = expectedBaselines();
  const committed = committedBaselines();
  const pending = pendingBaselines();

  it('takes shots the parser can account for', () => {
    // A guard that resolved nothing would pass everything below it.
    expect(expected.size).toBeGreaterThan(40);
  });

  it('has a committed baseline for every shot, or a pending entry saying why not', () => {
    const missing = [...expected].filter((path) => !committed.has(path) && !pending.includes(path));
    expect(missing, `no baseline committed, and not listed in ${PENDING_FILE.slice(WEB_ROOT.length + 1)}`).toEqual([]);
  });

  it('has no baseline that no shot reads', () => {
    const orphans = [...committed].filter((path) => !expected.has(path));
    expect(orphans, 'committed baseline that no spec compares against — rename or deletion left it behind').toEqual([]);
  });

  it('lists nothing as pending that is already baselined, or that no shot takes', () => {
    expect(pending.filter((path) => committed.has(path)), 'baselined now — drop the pending entry').toEqual([]);
    expect(pending.filter((path) => !expected.has(path)), 'no shot writes this — drop the pending entry').toEqual([]);
  });
});
