#!/usr/bin/env node
/**
 * Public-surface gate for the workspace packages that go to npm.
 *
 * `scripts/check-publishable.mjs` asks whether the manifest is right and
 * `scripts/check-installable.mjs` asks whether the tarball installs; this asks
 * what the tarball *is*. The two failures are different in kind: a broken
 * `exports` map breaks the first consumer immediately and loudly, whereas a
 * surface change is silent — it works for whoever wrote it, and shows up later
 * as somebody else's build error against a version range they thought was safe.
 * Before a first tag there is nothing to break; the point of writing it down
 * now is that the review of what to freeze (#258) has to happen against a list,
 * and after the tag the list is the contract.
 *
 * So it derives the surface from the built declarations — what a consumer sees
 * through the `exports` map, not what the source happens to say — and compares
 * it against a report checked in beside the package:
 *
 *     packages/<pkg>/public-api.md
 *
 * Every addition, removal, rename or signature change to a published package
 * then arrives as a diff in that file, in the same PR as the change, where a
 * reviewer reads it as English rather than inferring it from a `.d.ts`.
 *
 * It also reports **unnameable types**: a public signature whose parameter or
 * return type is declared inside the package and exported by no entry point. A
 * consumer can call such a function and can never write down what it returns,
 * so the type has to be inlined or `any`-ed at every call site. This is
 * invisible in the workspace, where every internal caller imports the declaring
 * module directly.
 *
 * Requires a build: the reports are generated from `dist/**\/*.d.ts`. CI runs
 * this from scripts/ci/publish-check.sh, after build.sh.
 *
 * Usage:
 *   node scripts/check-public-api.mjs            # verify, exit non-zero on drift
 *   node scripts/check-public-api.mjs --update   # rewrite the reports
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');
const REPORT_NAME = 'public-api.md';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Thrown for a defect in the package under inspection, not a bug in here. */
class SurfaceError extends Error {}

// --- declaration parsing ----------------------------------------------------
//
// The inputs are tsc's own declaration emit, so the grammar this has to survive
// is narrow: one statement per declaration, no expressions, no JSX. That is why
// a scanner is enough and the TypeScript compiler API is not reached for —
// typescript 7's JS API does not expose `createProgram` at all (#205 is the
// other place that bites), and a dependency that only the gate uses would be a
// dependency the gate can break on.

/** Drop comments, so braces and quotes inside prose cannot confuse the scanner. */
function stripComments(source) {
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end - 1;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new SurfaceError('unterminated block comment');
      // Keep the newlines: statement splitting is line-insensitive, but the
      // emitted text stays readable when a declaration follows a doc comment.
      out += source.slice(i, end + 2).replace(/[^\n]/g, '');
      i = end + 1;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const literal = readStringLiteral(source, i);
      out += literal;
      i += literal.length - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** The whole literal starting at `start`, quote included. */
function readStringLiteral(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return source.slice(start, i + 1);
    i += 1;
  }
  throw new SurfaceError('unterminated string literal');
}

/** The keywords a top-level declaration can start with, in a declaration file. */
const STATEMENT_START =
  /^\s*(?:export|declare|import|interface|type|class|abstract|function|const|let|var|enum|namespace|module|global)\b/;

/** Split a declaration file into top-level statements. */
function splitStatements(source) {
  const statements = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i += readStringLiteral(source, i).length - 1;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1;
      if (depth < 0) throw new SurfaceError('unbalanced brackets');
      if (depth === 0 && ch === '}') {
        // `interface X { … }` and `class X { … }` end here; `type X = { … };`
        // and `const x: { … };` carry a semicolon that belongs to the statement.
        //
        // A closing brace is *not* the end when the declaration continues past
        // it — `export { … } from './x.js'`, or a type literal inside a generic
        // constraint, which closes to depth 0 before the parameter list even
        // opens. Declarations always start with a keyword, so the question
        // "does a new statement start here?" answers it without a parser.
        const rest = source.slice(i + 1);
        const endsHere = /^\s*;/.test(rest) || rest.trim() === '' || STATEMENT_START.test(rest);
        if (!endsHere) continue;
        let end = i;
        while (end + 1 < source.length && /\s/.test(source[end + 1])) end += 1;
        if (source[end + 1] === ';') end += 1;
        const text = source.slice(start, end + 1).trim();
        if (text) statements.push(text);
        i = end;
        start = i + 1;
      }
      continue;
    }
    if (ch === ';' && depth === 0) {
      const text = source.slice(start, i + 1).trim();
      if (text) statements.push(text);
      start = i + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

const DECLARATION_PATTERNS = [
  [/^export\s+declare\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class', true],
  [/^declare\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class', false],
  [/^export\s+declare\s+function\s+([A-Za-z_$][\w$]*)/, 'function', true],
  [/^declare\s+function\s+([A-Za-z_$][\w$]*)/, 'function', false],
  [/^export\s+declare\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, 'const', true],
  [/^declare\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, 'const', false],
  [/^export\s+declare\s+enum\s+([A-Za-z_$][\w$]*)/, 'enum', true],
  [/^declare\s+enum\s+([A-Za-z_$][\w$]*)/, 'enum', false],
  [/^export\s+declare\s+namespace\s+([A-Za-z_$][\w$]*)/, 'namespace', true],
  [/^declare\s+namespace\s+([A-Za-z_$][\w$]*)/, 'namespace', false],
  [/^export\s+interface\s+([A-Za-z_$][\w$]*)/, 'interface', true],
  [/^interface\s+([A-Za-z_$][\w$]*)/, 'interface', false],
  [/^export\s+type\s+([A-Za-z_$][\w$]*)/, 'type', true],
  [/^type\s+([A-Za-z_$][\w$]*)/, 'type', false],
];

/** One `{ a, type b as c }` clause, as `{local, exported, typeOnly}` entries. */
function parseNamedBindings(clause, clauseIsTypeOnly) {
  const inner = clause.slice(clause.indexOf('{') + 1, clause.lastIndexOf('}'));
  return inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const typeOnly = clauseIsTypeOnly || /^type\s+/.test(part);
      const body = part.replace(/^type\s+/, '');
      const [local, exported] = body.split(/\s+as\s+/).map((s) => s.trim());
      return { local, exported: exported ?? local, typeOnly };
    });
}

/**
 * Read one declaration file into what a re-exporter needs to know about it:
 * the declarations it makes, the names it exports, and where it forwards from.
 */
function parseDeclarationFile(file) {
  const statements = splitStatements(stripComments(readFileSync(file, 'utf8')));
  const declarations = new Map();
  const exportsList = [];
  const stars = [];

  for (const statement of statements) {
    const fromMatch = statement.match(/from\s+('[^']*'|"[^"]*")\s*;?$/);
    const from = fromMatch ? fromMatch[1].slice(1, -1) : null;

    if (/^export\s+\*\s+from\s/.test(statement)) {
      stars.push(from);
      continue;
    }
    if (/^export\s+\*\s+as\s/.test(statement)) {
      throw new SurfaceError(`namespace re-export is not supported: ${statement}`);
    }
    if (/^export\s+default\b/.test(statement)) {
      throw new SurfaceError(`default export is not supported: ${statement}`);
    }
    if (/^export\s+(?:type\s+)?\{/.test(statement)) {
      const clauseIsTypeOnly = /^export\s+type\s*\{/.test(statement);
      for (const binding of parseNamedBindings(statement, clauseIsTypeOnly)) {
        exportsList.push({ ...binding, from });
      }
      continue;
    }
    if (/^(?:import|export\s+import)\b/.test(statement)) continue;

    for (const [pattern, kind, exported] of DECLARATION_PATTERNS) {
      const match = statement.match(pattern);
      if (!match) continue;
      const name = match[1];
      declarations.set(name, { kind, text: statement.replace(/^export\s+/, '') });
      if (exported) exportsList.push({ local: name, exported: name, typeOnly: false, from: null });
      break;
    }
  }

  return { declarations, exportsList, stars };
}

/** Resolve a relative `./x.js` specifier against the declaration next to it. */
function resolveDeclaration(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null; // a bare specifier is somebody else's surface
  const target = path.resolve(path.dirname(fromFile), specifier).replace(/\.js$/, '.d.ts');
  if (!existsSync(target)) throw new SurfaceError(`${specifier} resolves to missing ${target}`);
  return target;
}

/**
 * Every name an entry point exports, as `{name, kind, text, module}`.
 *
 * `seen` guards the cycle a `export * from` pair can make; the depth limit is
 * belt and braces for a graph this shallow.
 */
function collectExports(file, cache, seen = new Set()) {
  if (cache.has(file)) return cache.get(file);
  if (seen.has(file)) return new Map();
  seen.add(file);

  const parsed = parseDeclarationFile(file);
  const collected = new Map();

  for (const specifier of parsed.stars) {
    const target = resolveDeclaration(file, specifier);
    if (!target) continue;
    for (const [name, entry] of collectExports(target, cache, seen)) collected.set(name, entry);
  }

  for (const binding of parsed.exportsList) {
    if (binding.from) {
      const target = resolveDeclaration(file, binding.from);
      if (!target) continue; // re-exported from a dependency: not ours to report
      const upstream = collectExports(target, cache, seen);
      const entry = upstream.get(binding.local);
      if (!entry) {
        throw new SurfaceError(
          `${path.basename(file)} re-exports "${binding.local}" from ${binding.from}, which does not export it`,
        );
      }
      collected.set(binding.exported, { ...entry, name: binding.exported });
      continue;
    }
    const declaration = parsed.declarations.get(binding.local);
    if (!declaration) {
      throw new SurfaceError(
        `${path.basename(file)} exports "${binding.local}" but declares nothing by that name`,
      );
    }
    collected.set(binding.exported, {
      name: binding.exported,
      kind: declaration.kind,
      text: declaration.text,
      module: path.basename(file).replace(/\.d\.ts$/, ''),
    });
  }

  cache.set(file, collected);
  return collected;
}

/** Every name declared anywhere under a package's `dist`, for the leak check. */
function declaredNames(distDir) {
  const names = new Map();
  for (const entry of readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;
    const file = path.join(distDir, entry.name);
    for (const [name, declaration] of parseDeclarationFile(file).declarations) {
      names.set(name, { module: entry.name.replace(/\.d\.ts$/, ''), kind: declaration.kind });
    }
  }
  return names;
}

/** Identifiers a declaration's text mentions, minus the words TypeScript owns. */
const KEYWORDS = new Set([
  'abstract', 'any', 'as', 'asserts', 'async', 'bigint', 'boolean', 'class', 'const', 'constructor',
  'declare', 'default', 'enum', 'export', 'extends', 'false', 'from', 'function', 'get', 'implements',
  'import', 'in', 'infer', 'interface', 'is', 'keyof', 'let', 'namespace', 'never', 'new', 'null',
  'number', 'object', 'of', 'out', 'override', 'private', 'protected', 'public', 'readonly', 'return',
  'satisfies', 'set', 'static', 'string', 'symbol', 'this', 'true', 'type', 'typeof', 'undefined',
  'unique', 'unknown', 'var', 'void', 'while', 'yield',
]);

function referencedIdentifiers(text) {
  const found = new Set();
  for (const match of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (!KEYWORDS.has(match[0])) found.add(match[0]);
  }
  return found;
}

/**
 * A declaration as the report prints it.
 *
 * Private and protected members go: a consumer cannot reach them, and their
 * names would make a refactor look like a surface change. Blank lines go with
 * them — they are where the doc comments were.
 */
function forReport(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '' && !/^\s+(?:private|protected)\s/.test(line))
    .join('\n')
    .replace(LONG_STRING_LITERAL, '"…"');
}

/**
 * A `const` keeps its literal type in the emit, so `ARGS_ELEMENT_STYLES` would
 * put its whole stylesheet in the report and make a CSS tweak a surface change.
 * What a consumer can rely on is that it is a string; the bytes are the source's
 * business.
 */
const LONG_STRING_LITERAL = /"(?:[^"\\]|\\.){120,}"/g;

// --- the report -------------------------------------------------------------

/** Entry subpaths whose `types` condition names a declaration inside the package. */
function entryPoints(manifest, dir) {
  const entries = [];
  for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
    if (typeof entry !== 'object' || entry === null) continue;
    const types = entry.import?.types ?? entry.types;
    if (typeof types !== 'string' || !types.endsWith('.d.ts')) continue;
    entries.push({ subpath, file: path.join(dir, types.replace(/^\.\//, '')) });
  }
  return entries;
}

function renderReport(pkg, surfaces) {
  const total = surfaces.reduce((sum, s) => sum + s.exports.length, 0);
  const lines = [
    `# Public API — \`${pkg.manifest.name}\``,
    '',
    '<!-- GENERATED by scripts/check-public-api.mjs — do not edit by hand.',
    '     Regenerate after a deliberate surface change:',
    '         pnpm --filter <pkg> build && node scripts/check-public-api.mjs --update',
    '     CI fails when this file and the built declarations disagree, so every',
    '     addition, removal or signature change arrives as a reviewable diff. -->',
    '',
    `Version \`${pkg.manifest.version}\`. ${surfaces.length} entry ${
      surfaces.length === 1 ? 'point' : 'points'
    }, ${total} exported ${total === 1 ? 'name' : 'names'}.`,
    '',
    'Private and protected class members are omitted: a consumer cannot reach them.',
    'Doc comments are omitted too — they are in the source, and repeating them here',
    'would make every wording change a surface diff.',
    '',
  ];

  // A subpath that re-exports another one — `./browser` is `.` plus the element
  // — would otherwise print every declaration twice, and a reader would have to
  // compare two long lists to see that they are the same list.
  const printed = new Map();

  for (const surface of surfaces) {
    const specifier =
      surface.subpath === '.' ? pkg.manifest.name : `${pkg.manifest.name}/${surface.subpath.slice(2)}`;
    lines.push(`## \`${specifier}\``, '');
    lines.push(`${surface.exports.length} exports, from \`${path.basename(surface.file)}\`.`, '');

    const shared = surface.exports.filter((entry) => printed.get(entry.name) === forReport(entry.text));
    const own = surface.exports.filter((entry) => !shared.includes(entry));

    if (shared.length > 0) {
      const where = shared
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => `\`${name}\``)
        .join(', ');
      lines.push(
        `${shared.length} of them are re-exported unchanged from an entry point above: ${where}.`,
        '',
      );
      if (own.length > 0) lines.push(`The rest are its own:`, '');
    }

    for (const entry of own) {
      lines.push(`### \`${entry.name}\` — ${entry.kind}, from \`${entry.module}\``, '');
      lines.push('```ts', forReport(entry.text), '```', '');
      printed.set(entry.name, forReport(entry.text));
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Public signatures naming a type no entry point exports.
 *
 * Only names the package declares itself are candidates: anything else is a
 * dependency's export, which the consumer resolves through that dependency.
 * Nameable from *any* entry point counts as nameable — a consumer holding one
 * subpath can import a type from another, and asking each subpath to be closed
 * over its own types would make every shared type a duplicate export.
 */
function unnameableTypes(surface, declared, exportedAnywhere) {
  const leaks = [];
  for (const entry of surface.exports) {
    for (const identifier of referencedIdentifiers(forReport(entry.text))) {
      if (identifier === entry.name || exportedAnywhere.has(identifier)) continue;
      const declaration = declared.get(identifier);
      if (!declaration) continue;
      leaks.push({ used: entry.name, missing: identifier, module: declaration.module });
    }
  }
  return leaks;
}

// --- driver -----------------------------------------------------------------

function workspacePackages() {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(PACKAGES_DIR, e.name, 'package.json')))
    .map((e) => ({
      dir: path.join(PACKAGES_DIR, e.name),
      relDir: path.posix.join('packages', e.name),
      manifest: readJson(path.join(PACKAGES_DIR, e.name, 'package.json')),
    }));
}

const update = process.argv.includes('--update');
const publishable = workspacePackages().filter((p) => p.manifest.private !== true);

// The same discipline as the other gates: a check that inspected nothing must
// fail rather than report success.
if (publishable.length === 0) {
  console.error('check-public-api: no publishable packages found in packages/*.');
  console.error('If every package is private again, delete this gate deliberately.');
  process.exit(1);
}

let failed = false;
const fail = (message) => {
  failed = true;
  console.error(message);
};

for (const pkg of publishable) {
  const entries = entryPoints(pkg.manifest, pkg.dir);
  if (entries.length === 0) {
    fail(`${pkg.relDir}: no entry point declares types — nothing to report on.`);
    continue;
  }

  let surfaces;
  let declared;
  try {
    const cache = new Map();
    surfaces = entries.map(({ subpath, file }) => {
      if (!existsSync(file)) {
        throw new SurfaceError(`${subpath} points at missing ${path.relative(pkg.dir, file)} — build first?`);
      }
      const exportsMap = collectExports(file, cache);
      return {
        subpath,
        file,
        exports: [...exportsMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
    declared = declaredNames(path.join(pkg.dir, 'dist'));
  } catch (error) {
    if (!(error instanceof SurfaceError)) throw error;
    fail(`${pkg.relDir}: ${error.message}`);
    continue;
  }

  const empty = surfaces.find((surface) => surface.exports.length === 0);
  if (empty) {
    fail(`${pkg.relDir}: entry "${empty.subpath}" exports nothing — a build that emitted no declarations reads the same as a package with no API.`);
    continue;
  }

  const exportedAnywhere = new Set(surfaces.flatMap((s) => s.exports.map((entry) => entry.name)));
  for (const surface of surfaces) {
    for (const leak of unnameableTypes(surface, declared, exportedAnywhere)) {
      fail(
        `${pkg.relDir}: "${surface.subpath}" exports ${leak.used}, whose signature names ${leak.missing} ` +
          `(declared in ${leak.module}, exported by no entry point) — a consumer cannot write that type down. ` +
          `Export it or keep it out of the signature.`,
      );
    }
  }

  const report = renderReport(pkg, surfaces);
  const reportFile = path.join(pkg.dir, REPORT_NAME);
  const current = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : null;

  if (update) {
    if (current !== report) {
      writeFileSync(reportFile, report);
      console.log(`check-public-api: wrote ${path.posix.join(pkg.relDir, REPORT_NAME)}`);
    }
    continue;
  }

  if (current === null) {
    fail(`${pkg.relDir}: no ${REPORT_NAME}. Run \`node scripts/check-public-api.mjs --update\` and review it.`);
    continue;
  }
  if (current !== report) {
    fail(
      `${pkg.relDir}: ${REPORT_NAME} does not match the built declarations.\n` +
        `  The public surface changed. If that was deliberate, run \`node scripts/check-public-api.mjs --update\`\n` +
        `  and let the diff carry the change into review.`,
    );
    continue;
  }
  const total = surfaces.reduce((sum, s) => sum + s.exports.length, 0);
  const entryCount = `${surfaces.length} entry ${surfaces.length === 1 ? 'point' : 'points'}`;
  console.log(`check-public-api: ${pkg.manifest.name} — ${total} exports across ${entryCount}, unchanged`);
}

if (failed) process.exit(1);
