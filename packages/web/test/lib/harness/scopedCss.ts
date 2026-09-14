/**
 * Which scoped rules a component's own template can still reach.
 *
 * The eighth pass and the two before it each found the same leftover a file at
 * a time: markup moves out into a component of its own, and the CSS that
 * styled it stays behind, scoped to a file that no longer renders anything it
 * can match. `EtlPlayground`'s was not merely untidy — a `.panel-header` rule
 * the `InspectorPanel` extraction left behind was re-padding a live
 * `<PanelHeader>` (see docs/reference/ui-design-tokens.md, seventh
 * pass). So this is the audit that finds them by rule rather than by eye.
 *
 * The proof rests on where Vue puts the scope attribute. In a scoped block it
 * lands on the LAST compound of the selector — `.a .b` compiles to
 * `.a .b[data-v-x]` — and only three kinds of element carry that attribute:
 * elements this component's template writes, the ROOT element of a child
 * component it renders, and content it passes into a child's slot (compiled in
 * this component's scope, and written in this file either way). So a rule is
 * unreachable when a class in its last compound appears nowhere in the file
 * outside the style block and is not a child's root class.
 *
 * Deliberately incomplete rather than wrong. Five things are never called
 * dead, because each is a way for a class to arrive that the file does not
 * spell out:
 *
 *  - anything reaching past the scope (`:deep()`, `::v-deep`, `:slotted()`),
 *    which is how `v-html` output and a library's internals are styled;
 *  - a BEM family built by interpolation — `` `status-badge--${tone}` ``
 *    names every modifier without writing one;
 *  - the classes Vue mints for a `<Transition name="x">` — `x-enter-from` and
 *    its siblings are written by the runtime, and only the *name* is in the
 *    file. Spelled out from Vue's own list rather than taken as an `x-`
 *    prefix, so a genuinely dead `.x-anything-else` is still caught;
 *  - the root classes of the components this file renders, imported or
 *    auto-imported;
 *  - a compound with no class in it at all (`.panel > span`).
 *
 * An ancestor compound is judged differently, because it does not carry the
 * scope attribute: it may name a class the template never writes. It was once
 * judged repo-wide — dead only if the class appeared nowhere in `src` at all —
 * and that is too weak by exactly the margin that matters. `QueryGroupWorkArea`
 * styled `.variable-field label`, and `.variable-field` exists: in
 * `TupleValuesEditor`, a component it does not render. An ancestor class living
 * in somebody else's file is the normal state of a rule left behind by an
 * extraction, which is the defect this whole audit is for, so the repo-wide
 * question spared the very shape it was written to catch.
 *
 * So an ancestor is judged in this file too, and the three ways one legitimately
 * arrives from outside it are enumerated instead:
 *
 *  - a class the DOCUMENT carries, put on `<html>` or `<body>` from script
 *    (`useTheme` toggles `dark` there). Read from the `classList` calls rather
 *    than listed, so a second one needs no edit here;
 *  - a class a PARENT puts on this component when it renders it — `<Child
 *    class="x">` lands on the child's root, which the child's own scoped rules
 *    can then use as an ancestor;
 *  - anything already reachable in the file, by the same test the last compound
 *    gets: written in the template, a child's root class, a transition or an
 *    interpolated family.
 *
 * And the question is asked of the COMPOUND, not of each class in it:
 * `.feed-status.idle` is reachable because `.feed-status` is written here, even
 * though `idle` arrives from a `:class` binding whose values live elsewhere. A
 * compound is dead only when nothing in it can be reached — which is what
 * `.variable-field`, `.variable-field-full` and `QueryWorkArea`'s leftover
 * `.with-overlay` all were.
 *
 * The one shape this rejects that a stricter reading would allow: an ancestor
 * from a third-party DOM (CodeMirror's `.cm-*`, VueFlow's `.vue-flow__*`) with
 * this component's own markup underneath it. There is none in the tree today,
 * and one would be written with `:deep()` anyway, which is skipped outright.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface UnreachableRule {
  /** Path relative to `src`. */
  file: string;
  /** The single selector, as written. */
  selector: string;
  /** The classes in it that nothing can carry. */
  classes: string[];
}

interface StyleBlock {
  attrs: string;
  css: string;
}

function styleBlocks(source: string): StyleBlock[] {
  return [...source.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map(([, attrs, css]) => ({ attrs, css }));
}

const isScoped = (block: StyleBlock) => /\bscoped\b/.test(block.attrs);

/** The file with every scoped block's CSS removed: what the component actually says. */
function withoutScopedCss(source: string): string {
  return styleBlocks(source).reduce((acc, b) => (isScoped(b) ? acc.replace(b.css, '') : acc), source);
}

export function vueFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) vueFilesUnder(full, out);
    else if (entry.name.endsWith('.vue')) out.push(full);
  }
  return out;
}

/** Selectors, with comments and nested at-rules dropped. */
function selectorsIn(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  const stack: string[] = [];
  let buffer = '';
  for (const ch of clean) {
    if (ch === '{') {
      stack.push(buffer.trim());
      buffer = '';
    } else if (ch === '}') {
      const prelude = stack.pop();
      // `@media`, `@supports`, `@keyframes` and the frames inside them are not
      // selectors; the rules nested under the first two are, and come round
      // again on their own.
      if (prelude && !prelude.startsWith('@') && !stack.some((p) => p.startsWith('@keyframes'))) {
        for (const selector of prelude.split(',')) {
          const trimmed = selector.trim().replace(/\s+/g, ' ');
          if (trimmed) out.push(trimmed);
        }
      }
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  return out;
}

/**
 * The compounds of a selector, split on combinators outside any parentheses —
 * so `.a:not(.b .c) > .d` is two, not three.
 */
function compoundsIn(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && ' >+~'.includes(ch)) {
      const piece = selector.slice(start, i).trim();
      if (piece) out.push(piece);
      start = i + 1;
    }
  }
  const last = selector.slice(start).trim();
  if (last) out.push(last);
  return out;
}

function classesIn(fragment: string): string[] {
  // `:not(.x)` narrows a match, it does not name the element that carries it.
  const bare = fragment.replace(/:(?:not|is|where|has)\([^)]*\)/g, '');
  return [...bare.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]);
}

/**
 * The class list on a component's root element, which inherits its parent's scope.
 *
 * Every word in the root's `class` and `:class` bindings, object keys and the
 * expressions between them alike. That over-approximates — a `:class="{ error:
 * level === 'error' }"` contributes `level` too — and deliberately so: the set
 * is only ever used to spare a rule, so a word too many costs a finding and a
 * word too few would cost a wrong deletion.
 */
function rootClasses(file: string): string[] {
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const at = source.indexOf('<template>');
  if (at < 0) return [];
  const tag = source.slice(at + '<template>'.length).match(/<[A-Za-z][^>]*>/);
  if (!tag) return [];
  return [...tag[0].matchAll(/(?::class|class)="([^"]*)"/g)].flatMap(([, value]) =>
    [...value.matchAll(/[\w-]+/g)].map((m) => m[0]),
  );
}

/*
 * Vue's transition class list. `<Transition name="x">` puts `x-enter-from`,
 * `x-enter-active`, `x-enter-to`, `x-leave-from`, `x-leave-active` and
 * `x-leave-to` on the element as it moves; `<TransitionGroup>` adds `x-move`.
 * None of them is written anywhere in the file — only the name is.
 */
const TRANSITION_CLASS_SUFFIXES = [
  'enter-from',
  'enter-active',
  'enter-to',
  'leave-from',
  'leave-active',
  'leave-to',
  'move',
];

/** The classes a file's `<Transition name="x">` elements have Vue mint for them. */
function transitionClasses(text: string): string[] {
  const out: string[] = [];
  for (const [, name] of text.matchAll(/<Transition(?:Group)?\b[^>]*\sname="([A-Za-z][\w-]*)"/g)) {
    for (const suffix of TRANSITION_CLASS_SUFFIXES) out.push(`${name}-${suffix}`);
  }
  return out;
}

/** `` `foo--${x}` `` names a family: every class on that prefix is written by it. */
function familyPrefixes(text: string): string[] {
  return [...text.matchAll(/`([A-Za-z][\w-]*)\$\{/g)].map((m) => m[1]).filter((p) => p.includes('-'));
}

/**
 * The classes script puts on `<html>` or `<body>`, which every component in the
 * tree has as an ancestor and none of them writes. Read rather than listed, so
 * a second theme-like class costs no edit here.
 */
function documentClasses(dir: string, out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      documentClasses(full, out);
      continue;
    }
    if (!/\.(vue|ts|js|mjs)$/.test(entry.name)) continue;
    const text = readFileSync(full, 'utf8');
    const calls = /document\.(?:documentElement|body)\.classList\.(?:add|toggle|remove)\(\s*['"]([\w-]+)['"]/g;
    for (const [, name] of text.matchAll(calls)) out.add(name);
  }
  return out;
}

/**
 * For each component file, the classes some parent writes on it — `<Child
 * class="x">`. They land on the child's root element, so the child's own scoped
 * rules may use them as an ancestor without ever writing them.
 *
 * Every word in the attribute, as `rootClasses` does and for the same reason:
 * the set only ever spares a rule, so a word too many costs a finding and a word
 * too few would cost a wrong deletion.
 */
function classesAppliedByParents(files: string[], byBasename: Map<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const scriptAt = source.search(/<script[^>]*>/);
    const template = scriptAt < 0 ? source : source.slice(0, scriptAt);
    const tags = /<([A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b([^>]*)>/g;
    for (const [, tag, attrs] of template.matchAll(tags)) {
      // Both spellings, as the child-root pass does: `<my-child>` is `MyChild`.
      const pascal = tag.includes('-')
        ? tag.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')
        : tag;
      const child = byBasename.get(pascal);
      if (!child) continue;
      let set = out.get(child);
      if (!set) {
        set = new Set<string>();
        out.set(child, set);
      }
      for (const [, value] of attrs.matchAll(/(?::class|class)="([^"]*)"/g)) {
        for (const word of value.matchAll(/[\w-]+/g)) set.add(word[0]);
      }
    }
  }
  return out;
}

/**
 * Audit every `<style scoped>` block under `src` for rules nothing can match.
 *
 * One call reads the tree once, for the two questions no single file can answer:
 * which classes the document carries, and which ones a parent hands each child.
 */
export function unreachableScopedRules(src: string): UnreachableRule[] {
  const files = vueFilesUnder(src);
  const byBasename = new Map(files.map((f) => [f.split('/').pop()!.replace(/\.vue$/, ''), f]));
  const onDocument = documentClasses(src);
  const fromParents = classesAppliedByParents(files, byBasename);

  const out: UnreachableRule[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const blocks = styleBlocks(source).filter(isScoped);
    if (!blocks.length) continue;
    const outsideCss = withoutScopedCss(source);
    const prefixes = familyPrefixes(outsideCss);
    const transitions = new Set(transitionClasses(outsideCss));

    // Every component this file renders — by import, and by the Nuxt
    // auto-import that needs none — contributes its root element's classes.
    const childRoots = new Set<string>();
    for (const [, spec] of source.matchAll(/from\s+'([^']*\.vue)'/g)) {
      const path = spec.startsWith('.')
        ? resolve(dirname(file), spec)
        : resolve(src, spec.replace(/^@\//, ''));
      for (const c of rootClasses(path)) childRoots.add(c);
    }
    const scriptAt = source.search(/<script[^>]*>/);
    const template = scriptAt < 0 ? source : source.slice(0, scriptAt);
    for (const [, tag] of template.matchAll(/<([A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)[\s/>]/g)) {
      const pascal = tag.includes('-')
        ? tag.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')
        : tag;
      const child = byBasename.get(pascal);
      if (child) for (const c of rootClasses(child)) childRoots.add(c);
    }

    const parentApplied = fromParents.get(file) ?? new Set<string>();

    const writesClass = (name: string) =>
      childRoots.has(name)
      || transitions.has(name)
      || prefixes.some((p) => name.startsWith(p))
      // Delimited, so `.grid-row` is not found inside `grid-row-name`.
      || new RegExp(`[\\s"'\`.{:(,]${name.replace(/-/g, '\\-')}[\\s"'\`}:,)\\]]`).test(outsideCss);

    // An ancestor also reaches this file from the document or from a parent.
    const reachesAsAncestor = (name: string) =>
      writesClass(name) || onDocument.has(name) || parentApplied.has(name);

    for (const block of blocks) {
      for (const selector of selectorsIn(block.css)) {
        if (/:deep\(|::v-deep|>>>|:slotted\(|:global\(/.test(selector)) continue;
        const compounds = compoundsIn(selector);
        const compound = compounds[compounds.length - 1] ?? selector;

        // Asked of the compound: one reachable class makes the whole of it
        // reachable, since they name one element together.
        const orphans: string[] = [];
        for (const ancestor of compounds.slice(0, -1)) {
          const classes = classesIn(ancestor);
          if (!classes.length || classes.some(reachesAsAncestor)) continue;
          orphans.push(...classes);
        }
        if (orphans.length) {
          out.push({ file: file.slice(src.length + 1), selector, classes: orphans });
          continue;
        }
        const unwritten = classesIn(compound).filter((c) => !writesClass(c));
        if (unwritten.length) out.push({ file: file.slice(src.length + 1), selector, classes: unwritten });
      }
    }
  }
  return out;
}
