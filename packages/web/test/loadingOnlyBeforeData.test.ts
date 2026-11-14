/**
 * A template shows loading text only before the data has arrived.
 *
 * Every create, update or delete reloads its list. The backends sidebar showed
 * "Loading backends…" above its rows during each reload, so the rows moved
 * down and back each time a backend's query method changed. A list that hides
 * its rows during a reload, or an empty state that goes away during a reload,
 * flickers the same way.
 *
 * `useLoadState` (`src/composables/useLoadState.ts`) gives two flags. `loading`
 * is true during every load. `initialLoading` is true only while the current
 * subject has not loaded yet. This test reads every `v-if`, `v-else-if` and
 * `v-show` in `src/**\/*.vue` and fails on a raw flag: a name that contains
 * "loading", "fetching" or "refreshing", other than `initialLoading` or a name
 * that ends in `InitialLoading`.
 *
 * To fix a failure, render on `initialLoading` from `useLoadState`, from a
 * store, or from a prop of that name. `loading` stays correct for `:disabled`
 * and for holding off a second request.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'vue/compiler-sfc';

/** `NodeTypes` from `@vue/compiler-core`, which this package does not depend on directly. */
const ELEMENT = 1;
const SIMPLE_EXPRESSION = 4;
const DIRECTIVE = 7;

interface TemplateNode {
  type: number;
  props?: Array<{ type: number; name: string; loc: { start: { line: number } }; exp?: { type: number; content: string } }>;
  children?: unknown[];
}

const SRC = resolve(import.meta.dirname, '../src');

const RAW_FLAG = /loading|fetching|refreshing/i;
/** `initialLoading`, or a name for one subject such as `envInitialLoading`. */
const ALLOWED = /^(initialLoading|\w+InitialLoading)$/;

/**
 * Conditions that render on a raw flag on purpose, with the reason. The key
 * is `file: v-directive="expression"`, so it survives a moved line.
 */
const EXCEPTIONS: Record<string, string> = {
  'components/QueryResultsViewer.vue: v-if="loading"':
    'Shows "Running query…" while a query runs. A run replaces the results, so the old rows are not current data.',
};

const vueFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return vueFiles(path);
    return entry.name.endsWith('.vue') ? [path] : [];
  });

interface Condition {
  file: string;
  line: number;
  directive: string;
  expression: string;
}

function conditions(path: string): Condition[] {
  const file = relative(SRC, path).split(/[\\/]/).join('/');
  const { descriptor } = parse(readFileSync(path, 'utf8'), { filename: path });
  const root = descriptor.template?.ast as TemplateNode | undefined;
  if (!root) return [];
  const found: Condition[] = [];
  const walk = (node: TemplateNode) => {
    if (node.type === ELEMENT) {
      for (const prop of node.props ?? []) {
        if (
          prop.type === DIRECTIVE &&
          ['if', 'else-if', 'show'].includes(prop.name) &&
          prop.exp?.type === SIMPLE_EXPRESSION
        ) {
          found.push({ file, line: prop.loc.start.line, directive: `v-${prop.name}`, expression: prop.exp.content });
        }
      }
    }
    for (const child of node.children ?? []) {
      if (typeof child === 'object' && child !== null && 'type' in child) walk(child as TemplateNode);
    }
  };
  walk(root);
  return found;
}

/** The identifiers in an expression, without the text inside string literals. */
function identifiers(expression: string): string[] {
  const code = expression.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
  return code.match(/[A-Za-z_$][\w$]*/g) ?? [];
}

const rawFlags = (expression: string) =>
  identifiers(expression).filter((name) => RAW_FLAG.test(name) && !ALLOWED.test(name));

describe('loading text in templates', () => {
  const all = vueFiles(SRC).flatMap(conditions);

  it('renders only on initialLoading', () => {
    const offenders = all
      .filter((condition) => rawFlags(condition.expression).length > 0)
      .filter((condition) => !(`${condition.file}: ${condition.directive}="${condition.expression}"` in EXCEPTIONS))
      .map((condition) => `${condition.file}:${condition.line} ${condition.directive}="${condition.expression}"`);
    expect(
      offenders,
      'render loading text on `initialLoading` from useLoadState, so a reload keeps the data in place',
    ).toEqual([]);
  });

  it('has no stale exceptions', () => {
    const present = new Set(all.map((condition) => `${condition.file}: ${condition.directive}="${condition.expression}"`));
    expect(Object.keys(EXCEPTIONS).filter((key) => !present.has(key))).toEqual([]);
  });

  it('finds the conditions it reads', () => {
    // A parser change that found nothing would pass the first test silently.
    expect(all.length).toBeGreaterThan(200);
    expect(rawFlags('loading && rows.length === 0')).toEqual(['loading']);
    expect(rawFlags('store.isLoading.value')).toEqual(['isLoading']);
    expect(rawFlags('initialLoading')).toEqual([]);
    expect(rawFlags('!envInitialLoading && rows.length === 0')).toEqual([]);
    expect(rawFlags("mode === 'loading'")).toEqual([]);
  });
});
