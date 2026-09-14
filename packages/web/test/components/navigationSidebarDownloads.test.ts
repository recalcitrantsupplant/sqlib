/**
 * The sidebar's download menus, and which of their entries do anything.
 *
 * Six controls in `NavigationSidebar.vue` were written as a `console.log` and a
 * `TODO`, and two more have a working arm and a placeholder one. Clicking any
 * of them has always done nothing at all: no file, no error, no toast. The
 * trace was the only record that this was the case, and it was written to a
 * console the user never opens — so when the trace sweep (#47) deleted it, the
 * record had to go somewhere that a reader and a build can both see.
 *
 * This is that somewhere. It is an inventory rather than a pattern, for the
 * reason the `save as test` guard gives one file over: a list of the doors that
 * lead nowhere is a thing a reviewer can rank, and a seventh added quietly
 * fails here until someone adds it to the list and says so.
 *
 * What this deliberately does **not** assert is that an unbuilt control should
 * exist. Absent, disabled, or built is a decision about the product — the same
 * question `docs/reference/feature-flags.md` answers one way for a
 * switched-off feature — and taking it as a side effect of deleting a log
 * line would be taking it by accident.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(import.meta.dirname, '../../src/components/NavigationSidebar.vue');
const source = readFileSync(FILE, 'utf8');

const scriptStart = source.indexOf('<script setup');
const template = source.slice(0, scriptStart);
const script = source.slice(scriptStart);

/**
 * Handlers whose whole body is "close the menu", wired to a live control.
 *
 * The value is where the control is drawn, so the list reads as an inventory of
 * the product's dead ends rather than of its functions.
 */
const UNBUILT: Record<string, string> = {
  handleDownloadAllLibraries: 'the Libraries header',
  handleDownloadAllBackends: 'the Backends header',
  handleDownloadLibraryRDF: 'a library row',
  handleDownloadAssets: "a category's download menu",
  handleDownloadQuery: "a query's download menu",
  handleDownloadBackendRDF: 'a backend row',
};

/**
 * Handlers with a working arm and a placeholder one, and the values they work
 * for. Everything else they are called with falls through to a closed menu and
 * no file — `queryGroups` and `ruleSets` items, and every category but these
 * two.
 */
const PARTIAL: Record<string, string[]> = {
  handleDownloadRDF: ['queries', 'ruleSets'],
  handleDownloadItemRDF: ['query'],
};

/** Comments carry the "unbuilt" note; what is under test is the code. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** `function name(args) { body }` at the top level of the script block. */
function functionBodies(text: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const signature = /\bfunction\s+([A-Za-z0-9_$]+)\s*\([^)]*\)[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = signature.exec(text)) !== null) {
    let depth = 1;
    let index = signature.lastIndex;
    while (index < text.length && depth > 0) {
      if (text[index] === '{') depth += 1;
      else if (text[index] === '}') depth -= 1;
      index += 1;
    }
    bodies.set(match[1], text.slice(signature.lastIndex, index - 1));
  }
  return bodies;
}

const bodies = functionBodies(script);

/** Nothing left once the comments go, or nothing but closing the menu. */
const doesNothing = (body: string): boolean => {
  const code = stripComments(body).replace(/\s+/g, '');
  return code === '' || code === 'openDownloadMenu.value=null;';
};

/**
 * `@click="handleX"` and `@click.stop="handleX(…)"` — the control, not the
 * name. Both spellings, because two of these are bound bare and a guard that
 * only saw the called form would report them as undrawn.
 */
const wired = new Set(
  [...template.matchAll(/@click(?:\.\w+)*="\s*([A-Za-z0-9_$]+)\s*(?:\(|")/g)].map((m) => m[1]),
);

describe('the sidebar download controls', () => {
  it('found the handlers to read', () => {
    // The parse is regex over a `.vue` file, so it says so when it stops
    // working rather than reporting an empty tree as a clean one.
    expect(bodies.size).toBeGreaterThan(10);
    expect(wired.size).toBeGreaterThan(10);
  });

  it('holds every do-nothing handler in the inventory', () => {
    const empty = [...bodies].filter(([, body]) => doesNothing(body)).map(([name]) => name);
    expect(
      empty.sort(),
      'a handler that does nothing is a control that does nothing: list it in UNBUILT with where it is drawn, or give it a body',
    ).toEqual(Object.keys(UNBUILT).sort());
  });

  it('lists only handlers that are drawn', () => {
    const undrawn = Object.keys(UNBUILT).filter((name) => !wired.has(name));
    expect(
      undrawn,
      'this handler is in UNBUILT but nothing calls it — delete it rather than recording it',
    ).toEqual([]);
  });

  it('pins what the two partial handlers actually download', () => {
    for (const [name, working] of Object.entries(PARTIAL)) {
      const body = bodies.get(name);
      expect(body, `${name} is gone or has been renamed`).toBeDefined();
      const branches = [...stripComments(body!).matchAll(/===\s*'([^']+)'/g)].map((m) => m[1]);
      expect(
        branches.sort(),
        `${name} gained or lost an arm: everything it does not name closes the menu and writes nothing`,
      ).toEqual([...working].sort());
    }
  });
});
