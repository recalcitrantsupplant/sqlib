/**
 * Emitting a declaration file for an export bundle.
 *
 * The bundle itself is plain JSON so a CDN-hosted copy needs no build step. This
 * declaration is the optional other half: drop it next to the JSON and
 * `lib.query('...')` autocompletes, a misspelt query name is a compile error, and
 * each query's parameters are documented where the caller is looking.
 *
 * It is a declaration file — `queries.d.json.ts` for `queries.json` — so it emits
 * nothing at runtime and is safe to delete. `scripts/check-generated-typings.mjs`
 * compiles what this writes in a project shaped like a consumer's, because
 * nothing else here does: a declaration that does not typecheck is invisible in
 * this repository and is the whole of the artifact at a consumer's site.
 */

import type { ExportBundle, ExportedQuery } from '@sparql-query-lib/runtime';

/** Escape a string for use inside a single-quoted TypeScript literal. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** A union of string literals, or `never` when there are none. */
function union(values: readonly string[]): string {
  return values.length > 0 ? values.map(quote).join(' | ') : 'never';
}

/** `readonly [readonly ['city'], readonly ['from', 'to']]` — the call signature. */
function inputsTuple(inferredInputs: readonly string[][]): string {
  if (inferredInputs.length === 0) return 'readonly []';
  const slots = inferredInputs.map((vars) => `readonly [${union(vars)}]`);
  return `readonly [${slots.join(', ')}]`;
}

function docComment(name: string, query: ExportedQuery): string {
  const lines: string[] = [`\`${name}\` — ${query.queryType}.`];
  // `*/` inside a description would close the comment early.
  if (query.description) lines.push('', query.description.replace(/\*\//g, '*\\/'));

  if (query.inferredInputs.length > 0) {
    lines.push('', 'Parameter slots, in the order arguments must be supplied:');
    query.inferredInputs.forEach((vars, index) => {
      lines.push(`  ${index + 1}. ${vars.map((v) => `?${v}`).join(', ')}`);
    });
  } else {
    lines.push('', 'Takes no arguments.');
  }
  if (query.limitParameters.length > 0) {
    lines.push('', `Accepts \`limits\`: ${query.limitParameters.join(', ')}`);
  }
  if (query.offsetParameters.length > 0) {
    lines.push(`Accepts \`offsets\`: ${query.offsetParameters.join(', ')}`);
  }
  if (query.sourceVersion) lines.push('', `Compiled from ${query.sourceVersion}`);

  return ['  /**', ...lines.map((line) => `   * ${line}`.trimEnd()), '   */'].join('\n');
}

function catalogueEntry(name: string, query: ExportedQuery): string {
  return [
    docComment(name, query),
    `  ${quote(name)}: {`,
    `    readonly queryType: ${quote(query.queryType)};`,
    `    readonly inputs: ${inputsTuple(query.inferredInputs)};`,
    `    readonly limits: ${union(query.limitParameters)};`,
    `    readonly offsets: ${union(query.offsetParameters)};`,
    '  };',
  ].join('\n');
}

/** A JSON module's named exports are its top-level keys, so only spellable ones. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Where the declaration for `moduleSpecifier` has to be written.
 *
 * TypeScript types an import of a non-JS file through a sibling declaration
 * named `<base>.d.<ext>.ts` — `./queries.json` is typed by `queries.d.json.ts`.
 * That naming is the whole binding between the two files: there is no directive
 * a consumer can write to point one at the other, so the writer and this
 * generator have to agree, which is why the rule lives here rather than in the
 * script that saves the file.
 */
export function bundleTypingsFileName(moduleSpecifier: string): string {
  const file = moduleSpecifier.split('/').pop() ?? moduleSpecifier;
  const dot = file.lastIndexOf('.');
  // No extension to re-spell: nothing resolves it, but a name is still needed.
  if (dot <= 0) return `${file}.d.ts`;
  return `${file.slice(0, dot)}.d${file.slice(dot)}.ts`;
}

/**
 * Generate the declaration file for a bundle.
 *
 * `moduleSpecifier` is how the JSON will be imported (`./queries.json`, say).
 * The declaration does not name it: it is bound to the JSON by its own file
 * name — {@link bundleTypingsFileName} — so the specifier is here to tell the
 * reader which file this describes, and to spell that name in the header.
 *
 * The shape is what a consumer's tsc expects of a JSON module: the top-level
 * fields as named exports, plus a default. `import bundle from './queries.json'`
 * is typed by the *namespace*, not by the default export — a JSON module has no
 * real default, so TypeScript synthesises one from the module — which is why
 * every field is declared rather than only `export default`.
 */
export function generateBundleTypings(bundle: ExportBundle, moduleSpecifier: string): string {
  const names = Object.keys(bundle.queries).sort();
  const entries = names.map((name) => catalogueEntry(name, bundle.queries[name]));
  const fields = Object.keys(bundle)
    .filter((field) => IDENTIFIER.test(field))
    .map((field) => `export declare const ${field}: Bundle[${quote(field)}];`);

  return `// Generated by \`sqlib export\` from library ${bundle.library.id}.
// Do not edit: regenerate it alongside the bundle, or the two will disagree.
//
// This types ${moduleSpecifier}. Two things make it apply, both on the consumer:
// keep it beside the JSON named \`${bundleTypingsFileName(moduleSpecifier)}\`, and set
// \`"allowArbitraryExtensions": true\` in the tsconfig that compiles the import.
//
//   import bundle from '${moduleSpecifier}' with { type: 'json' };
//   const lib = fromBundle(bundle);            // query names are checked
//   type Name = keyof typeof bundle.queries;   // and nameable
//
// The types below are importable from '${moduleSpecifier}' under bundler
// resolution; NodeNext forbids a named import from a JSON module, so reach them
// through \`typeof bundle\` there.
import type { TypedExportBundle } from '@sparql-query-lib/runtime';

/** What each exported query expects, for editors and for review. */
export interface QueryCatalogue {
${entries.join('\n\n')}
}

/** Every query this bundle carries. */
export type QueryName = ${names.length > 0 ? 'keyof QueryCatalogue' : 'never'};

/** The bundle itself, with its query names known to the compiler. */
export type Bundle = TypedExportBundle<QueryName>;

${fields.join('\n')}

declare const bundle: Bundle;
export default bundle;
`;
}
