/**
 * Every class a component writes, and what styles it.
 *
 * `designSystem.test.ts` guards one direction — a scoped rule nothing in the
 * file can match — and this guards the other, which is the one that shows: a
 * class in the template that no rule reaches, so the element renders bare.
 *
 * It is a real fault rather than a tidiness one, and it had four instances when
 * this was written. `SubjectTestsPanel`'s Run all inherited the pane's type and
 * became the largest thing on the tab. The query screen's focus mode drew its
 * outputs block as text between two styled panels. `ImportSparqlDialog`'s
 * buttons were bare `<button>`s. The group's delete dialog had an ordinary
 * button where a destructive one was meant. Three of the four borrowed a class
 * that *is* styled — in another component's scoped block, which cannot reach
 * across, and which is why "grep for the class" says it is fine.
 *
 * What counts as reaching it: the component's own `<style>` block, a global
 * stylesheet under `assets/css`, or one of the listed exceptions below. A
 * class passed to a child component is *not* enough on its own — the child
 * styles its own classes, not names its callers invent.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const SRC = resolve(import.meta.dirname, '../../src');

/**
 * Where the guard looks: the hand-written components.
 *
 * `components/ui/**` is generated shadcn source and `pages/**` holds mockups
 * and wireframes; both style themselves with Tailwind, and a prefix test for
 * "is this a utility?" cannot tell `grid-cols-2` from `grid-status-hint` — it
 * called the second one a utility and passed it. Narrowing the scope is what
 * lets the utility list below be short enough to be exact.
 */
const SCOPE = /^components\//;
const SKIP = /^components\/ui\//;

/**
 * The utilities the hand-written components do use, by name.
 *
 * Exact names rather than prefixes: `grid-cols-2` is a utility and
 * `grid-status-hint` is a class this repo owes a rule, and no prefix test
 * tells them apart — one that tried called the second a utility and passed it.
 */
const UTILITIES = new Set([
  'sr-only', 'break-all', 'shrink-0', 'transition-colors', 'bg-popover',
  'border-border', 'cursor-pointer', 'font-mono', 'gap-0', 'gap-2', 'h-3',
  'inline-flex', 'items-center', 'justify-between', 'justify-center', 'left-0',
  'max-w-2xl', 'mt-1', 'p-0', 'p-1', 'pb-1', 'px-1', 'px-2', 'py-1',
  'rounded-md', 'shadow-md', 'text-muted-foreground', 'text-sm', 'text-xs',
  'top-full', 'w-3', 'w-max', 'z-20',
]);

/**
 * Classes that are hooks rather than styling: a spec or a stylesheet elsewhere
 * selects on them, and nothing is meant to draw them.
 *
 * Listed rather than pattern-matched, on the same reasoning as the doors
 * guards: a new one fails here until someone says which of the two it is, and
 * saying so is where the thinking is.
 */
const HOOKS: Record<string, string> = {
  'scratch-row': 'EntityListSidebar: a marker beside `entity-row`, which carries the styling',
  'draft-row': 'EntityDetailsPanel styles it; the sidebar only marks the row',
  'set-menu': 'ArgumentSetSwitcher: width comes from the dropdown primitive',
  'settings-dialog': 'SettingsDialog: a handle for specs, the box is the dialog primitive',
  'dialog-flex': 'SelectQueriesAndGroupsDialog: layout comes from the dialog primitive',
  'dialog-large': 'SelectQueriesAndGroupsDialog: width comes from the dialog primitive',
  'section-title': 'NavigationSidebar: SectionLabel carries the type',
  'totals-label': 'RuleSetExecutionResults: SectionLabel carries the type',
  'expand-title': 'ExpandableEditor: SectionLabel carries the type',
  'strip-body': 'EditorStrip: sized inline by `bodyStyle`',
  'so-far': 'RuleSetExecutionReplay: a wrapper; `so-far-header` and its rows are styled',
  'diff-counts': 'TestCaseDetailPanel: inherits the row it sits in',
  'reference-pin': 'TupleSetReferenceList: `reference-pin--floating`/`--pinned` carry it',
  'grid-status-hint': 'ValuesGrid: inherits the status row',
  'col-var': 'ValuesGrid: a column marker for the grid template',
  'col-name': 'ArgumentScalarsPanel: a column marker for the grid template',
  'mapping-select': 'CanvasObjectEditor: `select` is styled by the shared control rule',
  'query-name-hit': 'ImportSparqlDialog: `mark` carries its own highlight',
  'data-body': 'RuleSetInputsPanel: a marker beside `block-body`, which carries the styling',
  'querygroup-work-area': 'QueryGroupWorkArea: the handle a dozen specs wait on; CanvasShell draws the pane',
};

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(vue|css)$/.test(entry.name) ? [path] : [];
  });

const all = files(SRC);

const globalClasses = new Set(
  all
    .filter((path) => path.endsWith('.css'))
    .flatMap((path) => [...readFileSync(path, 'utf8').matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])),
);

/** Kebab-case only: a single word is as likely to be a variable as a class. */
const BESPOKE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

/**
 * The markup, which is not simply "everything before `<script>`": plenty of
 * these files put the script block first, and a template read that way is
 * empty — which silently passed every class in it.
 */
function markupOf(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '');
}

function classesWritten(template: string): string[] {
  const written = new Set<string>();
  for (const [, value] of template.matchAll(/\sclass="([^"]*)"/g)) {
    // A bound class is an expression; its literals are checked where they are
    // written, and `:class` objects name modifiers this guard does not read.
    if (value.includes('{') || value.includes('$')) continue;
    for (const name of value.split(/\s+/)) {
      if (BESPOKE.test(name) && !UTILITIES.has(name)) written.add(name);
    }
  }
  return [...written];
}

describe('a class in a template is styled by the component that writes it', () => {
  const offenders: Array<{ file: string; classes: string[] }> = [];

  for (const path of all.filter((p) => p.endsWith('.vue'))) {
    const text = readFileSync(path, 'utf8');
    const name = relative(SRC, path).split(/[\\/]/).join('/');
    if (!SCOPE.test(name) || SKIP.test(name)) continue;

    const template = markupOf(text);
    const own = new Set(
      [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
        .flatMap(([, block]) => [...block.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])),
    );

    const unstyled = classesWritten(template)
      .filter((cls) => !own.has(cls) && !globalClasses.has(cls) && !(cls in HOOKS));
    if (unstyled.length) offenders.push({ file: name, classes: unstyled.sort() });
  }

  it('leaves no element drawn by a rule that cannot reach it', () => {
    expect(offenders, 'classes written in a template that nothing styles').toEqual([]);
  });

  it('keeps the hook list honest — every entry is still written somewhere', () => {
    const written = new Set(
      all
        .filter((p) => p.endsWith('.vue'))
        .filter((p) => SCOPE.test(relative(SRC, p).split(/[\\/]/).join('/')))
        .flatMap((p) => classesWritten(markupOf(readFileSync(p, 'utf8')))),
    );
    const stale = Object.keys(HOOKS).filter((cls) => !written.has(cls));
    expect(stale, 'listed as a hook but no longer written').toEqual([]);
  });
});
