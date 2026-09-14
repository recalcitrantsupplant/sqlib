/**
 * The library page, rendered as one self-contained HTML file.
 *
 * This is the *export* half of a design that has two hosts: the same document —
 * contents rail, per-query cells, argument builder, template beside substituted
 * query, results — appears in the app as the Library tab, and here as a file you
 * can email. Everything the page needs is inlined, so it works from `file://`
 * with no server and no assets; the only thing it talks to is the SPARQL
 * endpoint whoever opens it types in.
 *
 * It is deliberately plain: vanilla DOM, no framework, no build step. That is
 * the point rather than a shortcut. Its second audience is a language model
 * asked to fold the library into a Vue or Angular app, and plain
 * `fetch`-and-render code is the easiest thing in the world to transliterate.
 *
 * What is *not* duplicated is anything that could drift: substitution, term
 * validation and the `<sqlib-args>` builder all come from
 * `@sparql-query-lib/runtime`, inlined as its built browser bundle. Only layout
 * is written twice, and layout is the cheap half.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fromBundle } from '@sparql-query-lib/runtime';
import type { ExportBundle, ExportedGroup, ExportedQuery } from '@sparql-query-lib/runtime';

export interface DemoPageOptions {
  /**
   * The runtime's browser CommonJS build, inlined into the page. Defaults to
   * reading it from the installed package; tests inject their own.
   */
  runtimeSource?: string;
  /** Queries and tests left out of the export, listed on the page. */
  skipped?: Array<{ name: string; reason: string }>;
  /** Prefills the endpoint box. */
  endpoint?: string;
}

/**
 * Read the runtime's browser bundle from the installed package.
 *
 * The built artifact, never a copy of the source: the page's whole claim is that
 * it substitutes exactly as the server does, and it can only make that claim by
 * running the same code. A missing build is a hard error for the same reason —
 * a stale vendored copy would be worse than no page at all.
 */
export function loadRuntimeSource(): string {
  const require = createRequire(import.meta.url);

  // Resolve the *manifest*, not the entry point. Under tsx the entry resolves to
  // the package's TypeScript source, which would inline `export` statements into
  // the page and break it in the browser — a failure no unit test running under
  // vitest would reproduce, because vitest resolves it differently. The package
  // root is unambiguous; the path from there to the build is ours to state.
  let manifest: string;
  try {
    manifest = require.resolve('@sparql-query-lib/runtime/package.json');
  } catch {
    throw new Error(
      'Could not resolve @sparql-query-lib/runtime. Install dependencies before exporting a demo page.',
    );
  }

  // `browser.cjs` is the runtime and the argument element in one file, so the
  // page carries a single copy of the term serialiser rather than two.
  const cjs = join(dirname(manifest), 'dist', 'browser.cjs');
  if (!existsSync(cjs)) {
    throw new Error(
      `The runtime is not built: ${cjs} does not exist. Run \`pnpm --filter @sparql-query-lib/runtime build\` and export again.`,
    );
  }

  const source = readFileSync(cjs, 'utf8');
  // The page evaluates this with a module/exports pair, so ES module syntax
  // would be a syntax error in the browser. Fail here, where the message can say
  // why, rather than shipping a page that dies on load.
  if (/^\s*(export|import)\s/m.test(source)) {
    throw new Error(
      `${cjs} is not CommonJS. The demo page inlines the runtime's CJS build; rebuild the runtime and export again.`,
    );
  }
  return source;
}

/** Escape text for an HTML text node or a double-quoted attribute. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialise a value for embedding inside a `<script>` element.
 *
 * `</script>` inside a string would close the element early — and a bundle is
 * full of attacker-adjacent text: query bodies, test names, expected results.
 * Escaping `<` at the JSON level makes that impossible without changing what
 * `JSON.parse` yields. U+2028/29 are legal in JSON but not in JS source.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const SPARQL_KEYWORDS = [
  'PREFIX', 'BASE', 'SELECT', 'CONSTRUCT', 'DESCRIBE', 'ASK', 'WHERE', 'FROM', 'NAMED',
  'ORDER', 'GROUP', 'HAVING', 'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'DISTINCT', 'REDUCED',
  'OPTIONAL', 'UNION', 'MINUS', 'FILTER', 'BIND', 'VALUES', 'UNDEF', 'SERVICE', 'GRAPH',
  'AS', 'NOT', 'EXISTS', 'IN', 'A',
];

/**
 * Colour a SPARQL query for reading.
 *
 * Runs over *already-escaped* text and only ever inserts spans, so a query
 * containing `<` or `"` cannot reach the markup: by the time this sees it, those
 * are entities. One pass, alternation ordered so strings and IRIs win over the
 * keyword rule — otherwise `LIMIT` inside a literal would light up.
 */
function highlightSparql(escaped: string): string {
  const pattern = new RegExp(
    [
      '(#[^\\n]*)', // comment
      '(&quot;(?:[^&\\\\]|\\\\.|&(?!quot;))*&quot;)', // string literal
      '(&lt;[^&\\s]*&gt;)', // IRI
      '([?$][A-Za-z_][A-Za-z0-9_]*)', // variable
      `\\b(${SPARQL_KEYWORDS.join('|')})\\b`, // keyword
      '\\b(\\d+)\\b', // number
    ].join('|'),
    'gi',
  );

  return escaped.replace(pattern, (match, comment, str, iri, variable, keyword, num) => {
    if (comment !== undefined) return `<span class="tok-comment">${match}</span>`;
    if (str !== undefined) return `<span class="tok-string">${match}</span>`;
    if (iri !== undefined) return `<span class="tok-iri">${match}</span>`;
    if (variable !== undefined) return `<span class="tok-var">${match}</span>`;
    if (keyword !== undefined) return `<span class="tok-kw">${match}</span>`;
    if (num !== undefined) return `<span class="tok-num">${match}</span>`;
    return match;
  });
}

/**
 * Render the template for a human to read.
 *
 * `template.text` fills each parameter slot with a marker IRI, because that is
 * how the compiler located the slot's span. Shown raw it reads as noise. Putting
 * the slot back in the all-UNDEF form the author actually wrote costs nothing,
 * stays valid SPARQL, and is the spelling anyone who has written a parameterised
 * query in sqlib already recognises.
 */
export function renderTemplateForDisplay(query: ExportedQuery): string {
  let out = '';
  let cursor = 0;
  for (const slot of query.template.slots) {
    const vars = slot.vars.map((name) => `?${name}`);
    const block =
      vars.length === 1
        ? `VALUES ${vars[0]} { UNDEF }`
        : `VALUES( ${vars.join(' ')} ){ ( ${vars.map(() => 'UNDEF').join(' ')} ) }`;
    out += query.template.text.slice(cursor, slot.start) + block;
    cursor = slot.end;
  }
  return out + query.template.text.slice(cursor);
}

/** The signature, as one line: what to supply, and what may be paged. */
function signatureParts(query: ExportedQuery): string[] {
  const parts = query.inferredInputs.map(
    (vars, index) => `slot ${index + 1}: ${vars.map((v) => `?${v}`).join(', ')}`,
  );
  if (parts.length === 0) parts.push('no arguments');
  if (query.limitParameters.length > 0) parts.push(`limit ${query.limitParameters.join(', ')}`);
  if (query.offsetParameters.length > 0) parts.push(`offset ${query.offsetParameters.join(', ')}`);
  return parts;
}

/**
 * One step of a group's walk: a node, the query it runs, and its wiring.
 *
 * `from` is what feeds this node, `inputs` what it leaves to the caller. Both
 * are per node rather than per group because that is how the cell reads them
 * out: a chain is worth showing as a chain, not as a set of slots.
 */
interface GroupStep {
  node: string;
  /** Key into the bundle's queries. */
  query: string;
  queryType: string;
  /** Inbound chaining edges: which upstream node fills which variables. */
  from: Array<{ node: string; mappings: Array<{ source: string; target: string }> }>;
  /** This node's slots that no edge fills, in slot order. */
  inputs: string[][];
}

/**
 * What the runtime's walker makes of a group, computed once at export time.
 *
 * Everything here is the walker's answer rather than this file's: execution
 * order, which slots an edge fills and which fall to the caller, and the page
 * parameters the nodes accept. Deriving it a second time in the page — or a
 * third time in this file, for the static markup — is exactly the drift the
 * export exists to avoid, so it is derived once and both halves read it.
 */
interface GroupPlan {
  /** Nodes in the order a run executes them. */
  steps: GroupStep[];
  /**
   * The external slots, deduplicated by their variables in order.
   *
   * Two nodes declaring the same variables are filled by *one* argument set —
   * the walker matches a set to a slot by its variables — so offering two grids
   * would leave the second one silently unread.
   */
  inputs: string[][];
  limits: string[];
  offsets: string[];
  /** The node whose result is the group's, and the query it runs. */
  resultNode: string;
  resultQuery: string;
}

/**
 * Ask the runtime what each group's walk looks like.
 *
 * Loaded with validation off: the bundle came from this server's own builder a
 * moment ago, and the page loads it the same way. A bundle the runtime refuses
 * outright — a cyclic group is the only way in, and one the bundle validator
 * rejects for every consumer — leaves the map empty rather than failing the
 * export: the queries still export, and each group cell says it could not be
 * read instead of shipping a Run button with nothing behind it.
 */
export function buildGroupPlans(bundle: ExportBundle): Record<string, GroupPlan> {
  const groups = bundle.groups ?? {};
  const slugs = Object.keys(groups);
  if (slugs.length === 0) return {};

  let library: ReturnType<typeof fromBundle>;
  try {
    library = fromBundle(bundle, { validate: false });
  } catch {
    return {};
  }

  const plans: Record<string, GroupPlan> = {};
  for (const slug of slugs) {
    try {
      plans[slug] = planFor(bundle, slug, library);
    } catch {
      // One group the walker cannot describe — a node naming a query the bundle
      // does not carry is the way in — leaves that cell unrunnable and the rest
      // of the page intact.
    }
  }
  return plans;
}

/** One group's plan, straight from the walker that will run it. */
function planFor(
  bundle: ExportBundle,
  slug: string,
  library: ReturnType<typeof fromBundle>,
): GroupPlan {
  const group = bundle.groups![slug];
  const handle = library.group(slug);
  const signature = handle.signature();

  const byNode = new Map<string, string[][]>();
  for (const input of signature.inputs) {
    const forNode = byNode.get(input.node) ?? [];
    forNode.push([...input.vars]);
    byNode.set(input.node, forNode);
  }

  const seen = new Set<string>();
  const inputs: string[][] = [];
  for (const input of signature.inputs) {
    const key = input.vars.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    inputs.push([...input.vars]);
  }

  return {
    steps: handle.nodes().map((node) => ({
      node,
      query: handle.queryOf(node),
      queryType: bundle.queries[handle.queryOf(node)].queryType,
      from: group.edges
        .filter((edge) => edge.to === node)
        .map((edge) => ({
          node: edge.from,
          mappings: edge.mappings.map(({ source, target }) => ({ source, target })),
        })),
      inputs: byNode.get(node) ?? [],
    })),
    inputs,
    limits: signature.limitParameters,
    offsets: signature.offsetParameters,
    resultNode: group.resultNode,
    resultQuery: group.nodes[group.resultNode].query,
  };
}

/** The signature, as one line: how long the chain is and what to supply. */
function groupSignatureParts(plan: GroupPlan): string[] {
  const steps = plan.steps.length;
  const parts = [`${steps} step${steps === 1 ? '' : 's'}`];
  plan.inputs.forEach((vars, index) => {
    parts.push(`slot ${index + 1}: ${vars.map((name) => `?${name}`).join(', ')}`);
  });
  if (plan.inputs.length === 0) parts.push('no arguments');
  if (plan.limits.length > 0) parts.push(`limit ${plan.limits.join(', ')}`);
  if (plan.offsets.length > 0) parts.push(`offset ${plan.offsets.join(', ')}`);
  return parts;
}

/** A tag IRI's readable tail, for a chip. */
function tagLabel(tag: string): string {
  const tail = tag.split(/[#/:]/).filter(Boolean).pop();
  return tail ?? tag;
}

const PAGE_STYLES = `
:root {
  color-scheme: light dark;
  --bg:#ffffff; --fg:#16181d; --muted:#6b7280; --faint:#8a919e;
  --line:#dfe3ea; --line-soft:#eceef2; --panel:#f7f8fa; --panel-2:#f2f4f7;
  --accent:#2159c9; --accent-soft:#eef4ff; --accent-line:#cfe0ff;
  --warn:#8a5a11; --warn-bg:#fdf3e3; --danger:#a8341f; --danger-bg:#fdecec;
  --ok:#1f7a4d;
  --mono:ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  --sqlib-line:var(--line); --sqlib-panel:var(--panel); --sqlib-bg:var(--bg);
  --sqlib-muted:var(--muted); --sqlib-accent:var(--accent); --sqlib-mono:var(--mono);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#16181d; --fg:#e8e8e8; --muted:#9aa0a6; --faint:#7d838d;
    --line:#333842; --line-soft:#262a32; --panel:#1e2128; --panel-2:#232730;
    --accent:#7aa7d9; --accent-soft:#1c2637; --accent-line:#2c3c56;
    --warn:#d6a961; --warn-bg:#2a2418; --danger:#e08b7a; --danger-bg:#2c1d1b; --ok:#5fbf8f;
  }
}
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font-size:13px; line-height:1.5;
  font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  -webkit-font-smoothing:antialiased; }
a { color:var(--accent); text-decoration:none; }
a:hover { text-decoration:underline; }
button { font-family:inherit; }

.topbar { position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:10px;
  min-height:44px; padding:6px 16px; border-bottom:1px solid var(--line); background:var(--bg); flex-wrap:wrap; }
.topbar__title { font-size:13px; font-weight:600; }
.topbar__meta { font-size:11px; color:var(--muted); }
.topbar__spacer { margin-left:auto; }
.endpoint { display:flex; align-items:center; gap:6px; }
.endpoint input { width:min(26rem, 46vw); height:28px; padding:0 8px; border:1px solid var(--line);
  border-radius:5px; background:var(--bg); color:var(--fg); font-family:var(--mono); font-size:11px; }
.chip-button { height:26px; padding:0 9px; border:1px solid var(--line); border-radius:5px;
  background:var(--bg); color:var(--fg); font-size:11px; cursor:pointer; }
.chip-button:hover { background:var(--panel); }
.anon { font-size:11px; color:var(--warn); background:var(--warn-bg); border-radius:4px; padding:2px 7px; }

.layout { display:flex; align-items:flex-start; }
.rail { position:sticky; top:51px; width:250px; flex-shrink:0; height:calc(100vh - 51px);
  overflow:auto; border-right:1px solid var(--line); padding:14px 12px 40px; background:var(--bg); }
.rail__title { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.06em;
  color:var(--faint); margin:0 0 8px; }
.rail__group { margin-bottom:14px; }
.rail__group-head { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:600;
  color:var(--muted); margin-bottom:4px; }
.rail__count { font-size:10px; color:var(--faint); }
.rail__link { display:block; padding:4px 7px; border-radius:5px; color:var(--fg); font-size:12px; }
.rail__link:hover { background:var(--panel); text-decoration:none; }
.rail__link[data-hidden="true"] { opacity:.35; }
.rail__link-name { font-family:var(--mono); font-size:11.5px; }
.rail__link-desc { display:block; font-size:10.5px; color:var(--faint); overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.rail__filters { margin-bottom:14px; }
.rail__filters input { width:100%; height:26px; padding:0 8px; border:1px solid var(--line);
  border-radius:5px; background:var(--bg); color:var(--fg); font-size:11.5px; }

main { flex:1; min-width:0; padding:18px 20px 80px; max-width:1100px; }
.lede { margin-bottom:18px; }
.lede h1 { font-size:19px; margin:0 0 4px; }
.lede p { margin:0 0 8px; color:var(--muted); max-width:62ch; }
.lede__stats { font-size:11.5px; color:var(--faint); }

.tagbar { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin-top:10px; }
.tagbar__label { font-size:11px; color:var(--faint); }
.tag { height:22px; padding:0 8px; border:1px solid var(--line); border-radius:999px;
  background:var(--bg); color:var(--muted); font-size:11px; cursor:pointer; display:inline-flex; align-items:center; }
.tag[aria-pressed="true"] { background:var(--accent-soft); border-color:var(--accent-line); color:var(--accent); }

.cell { border:1px solid var(--line); border-radius:6px; margin-bottom:14px; background:var(--bg); }
.cell[hidden] { display:none; }
.cell__head { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line-soft); flex-wrap:wrap; }
.cell__name { font-family:var(--mono); font-size:13px; font-weight:600; }
.kind { height:18px; padding:0 6px; border-radius:3px; background:var(--panel-2); color:var(--muted);
  font-size:10px; font-weight:600; letter-spacing:.04em; display:inline-flex; align-items:center; }
.cell__body { padding:12px; }
.cell__desc { margin:0 0 8px; color:var(--muted); max-width:70ch; }
.sig { font-family:var(--mono); font-size:11.5px; color:var(--muted); margin-bottom:10px; }
.sig span + span::before { content:' · '; color:var(--line); }

.section-label { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.05em;
  color:var(--faint); margin:12px 0 5px; }
.examples { display:flex; gap:5px; flex-wrap:wrap; }
.example { height:24px; padding:0 9px; border:1px solid var(--line); border-radius:5px;
  background:var(--bg); color:var(--fg); font-size:11.5px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
.example:hover { background:var(--panel); }
.example[aria-pressed="true"] { background:var(--accent-soft); border-color:var(--accent-line); color:var(--accent); }
.badge { padding:0 5px; border-radius:3px; background:var(--warn-bg); color:var(--warn); font-size:9.5px; font-weight:600; }

.panes { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px; }
@media (max-width:900px) { .panes { grid-template-columns:1fr; } .rail { display:none; } }
.pane__head { display:flex; align-items:center; gap:6px; height:26px; padding:0 10px;
  background:var(--panel); border:1px solid var(--line); border-bottom:none; border-radius:5px 5px 0 0; }
.pane__title { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
pre { margin:0; padding:9px 10px; border:1px solid var(--line); border-radius:0 0 5px 5px;
  background:var(--panel); font-family:var(--mono); font-size:11.5px; line-height:1.55;
  overflow:auto; max-height:20rem; white-space:pre-wrap; word-break:break-word; }
pre.error { border-color:var(--danger); background:var(--danger-bg); color:var(--danger); }
.tok-kw { color:#7c3aed; font-weight:600; }
.tok-iri { color:var(--accent); }
.tok-string { color:var(--ok); }
.tok-var { color:var(--fg); }
.tok-num { color:var(--warn); }
.tok-comment { color:var(--faint); font-style:italic; }
@media (prefers-color-scheme: dark) { .tok-kw { color:#b18cff; } .tok-string { color:#7fd6a6; } }

.runbar { display:flex; align-items:center; gap:8px; margin-top:12px; flex-wrap:wrap; }
.run { height:28px; padding:0 12px; border:1px solid transparent; border-radius:5px;
  background:var(--accent); color:#fff; font-size:12px; font-weight:600; cursor:pointer; }
.run:disabled { opacity:.55; cursor:default; }
.runbar__status { font-size:11px; color:var(--faint); }

.result { margin-top:10px; border:1px solid var(--line); border-radius:5px; overflow:hidden; }
.result__head { display:flex; align-items:center; gap:8px; height:28px; padding:0 10px;
  background:var(--panel); border-bottom:1px solid var(--line); }
.result__title { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.result__count { font-size:11px; color:var(--faint); }
.result__body { overflow:auto; max-height:26rem; }
.result table { width:100%; border-collapse:collapse; font-size:12px; }
.result th { position:sticky; top:0; text-align:left; padding:6px 10px; background:var(--bg);
  font-size:10.5px; font-weight:600; color:var(--muted); border-bottom:1px solid var(--line-soft); cursor:pointer; white-space:nowrap; }
.result td { padding:5px 10px; border-bottom:1px solid var(--line-soft); font-family:var(--mono);
  vertical-align:top; word-break:break-word; }
.result td.is-iri { color:var(--accent); }
.result td.is-absent { color:var(--faint); }
.term-meta { margin-left:.35rem; color:var(--faint); font-size:.9em; }
.result pre { border:none; border-radius:0; max-height:none; }

.chain { list-style:none; margin:0 0 4px; padding:0; }
.chain__step { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:5px 0;
  border-bottom:1px solid var(--line-soft); font-size:11.5px; }
.chain__step:last-child { border-bottom:none; }
.chain__node { font-family:var(--mono); font-size:11.5px; font-weight:600; }
.chain__query { font-family:var(--mono); font-size:11.5px; }
.chain__wire, .chain__asks { font-family:var(--mono); font-size:11px; color:var(--muted); }
.chain__asks { color:var(--accent); }
.chain__result { margin-left:auto; padding:0 6px; border-radius:3px; background:var(--accent-soft);
  color:var(--accent); font-size:10px; font-weight:600; }

.note { font-size:11.5px; color:var(--muted); }
.callout { padding:9px 11px; border-left:3px solid var(--warn); background:var(--warn-bg);
  color:var(--warn); font-size:11.5px; border-radius:0 4px 4px 0; margin-bottom:14px; }
.callout ul { margin:5px 0 0; padding-left:18px; }
details { margin-top:8px; }
summary { font-size:11.5px; color:var(--muted); cursor:pointer; }
.empty { color:var(--muted); font-size:12.5px; }
`;

/**
 * The page's own script.
 *
 * Written without template literals so it can live inside one here, and without
 * `innerHTML` for anything derived from the bundle or a response — a query name
 * or a result cell is data, and building the DOM node by node keeps it that way.
 */
const PAGE_SCRIPT = `
var BUNDLE = window.SQLIB_BUNDLE;
var SQLIB = window.SQLIB;
// What the runtime's own walker made of each group at export time: execution
// order, the slots no edge fills, the page parameters its nodes accept. Derived
// once, by the same code that walks the group here, rather than twice.
var GROUP_PLANS = window.SQLIB_GROUP_PLANS || {};
var ENDPOINT_KEY = 'sqlib-demo-endpoint:' + BUNDLE.library.id;
var preview = SQLIB.fromBundle(BUNDLE);
var endpointInput = document.getElementById('endpoint');

SQLIB.defineArgsElement();

try {
  var saved = window.localStorage.getItem(ENDPOINT_KEY);
  if (saved && !endpointInput.value) endpointInput.value = saved;
} catch (e) { /* private window or blocked storage: the box just starts empty */ }
endpointInput.addEventListener('change', function () {
  try { window.localStorage.setItem(ENDPOINT_KEY, endpointInput.value); } catch (e) {}
});

function el(tag, text, className) {
  var node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function copyToClipboard(text, button) {
  var done = function () {
    var was = button.textContent;
    button.textContent = 'Copied';
    setTimeout(function () { button.textContent = was; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () {});
    return;
  }
  var area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  try { document.execCommand('copy'); done(); } catch (e) {}
  document.body.removeChild(area);
}

document.getElementById('copy-bundle').addEventListener('click', function () {
  copyToClipboard(JSON.stringify(BUNDLE, null, 2), this);
});

function skeletonPayload(query) {
  // One all-UNDEF row per slot: that is the wildcard, and the runtime drops the
  // slot entirely for it, so a query with no examples opens ready to run and
  // actually returns something. Zero rows would be the *other* empty — a
  // zero-row VALUES block, which joins to nothing — and opening on a query that
  // can only return nothing is a poor introduction to it.
  var payload = { arguments: [] };
  for (var i = 0; i < query.inferredInputs.length; i++) {
    payload.arguments.push({
      head: { vars: query.inferredInputs[i].slice() },
      arguments: { bindings: [{}] }
    });
  }
  return payload;
}

function examplePayload(example) {
  var payload = { arguments: example.arguments };
  var toMap = function (list) {
    var map = {};
    for (var i = 0; i < list.length; i++) map[list[i].name] = list[i].value;
    return map;
  };
  if (example.limits && example.limits.length) payload.limits = toMap(example.limits);
  if (example.offsets && example.offsets.length) payload.offsets = toMap(example.offsets);
  return payload;
}

function describeError(error) {
  if (error && error.name === 'SparqlEndpointError') {
    return 'Endpoint returned ' + error.status + '.' + String.fromCharCode(10, 10) + (error.body || '');
  }
  if (error instanceof TypeError) {
    return String(error.message) + String.fromCharCode(10, 10) +
      'A network-level TypeError here usually means the endpoint refused the browser request - ' +
      'most often CORS (the endpoint must send Access-Control-Allow-Origin), or a mixed-content ' +
      'block when an https page calls an http endpoint.';
  }
  return error && error.message ? error.message : String(error);
}

function renderSelect(target, results, prefixes) {
  var vars = (results.head && results.head.vars) || [];
  var rows = (results.results && results.results.bindings) || [];
  if (!rows.length) { target.appendChild(el('p', 'No rows.', 'note')); return 0; }
  // The same description the app's result table works from, so an IRI reads the
  // same way here as it does in sqlib — abbreviated against the query's own
  // prefixes, which are the prefixes the substituted query above used.
  var abbreviate = SQLIB.prefixTableAbbreviator(prefixes || []);

  var sort = { column: null, dir: 1 };
  var table = el('table');
  var thead = document.createElement('thead');
  var headRow = el('tr');
  vars.forEach(function (name) {
    var th = el('th', name);
    th.title = 'Sort by ' + name;
    th.addEventListener('click', function () {
      sort.dir = sort.column === name ? -sort.dir : 1;
      sort.column = name;
      draw();
    });
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  table.appendChild(tbody);

  function draw() {
    var ordered = rows.slice();
    if (sort.column) {
      ordered.sort(function (a, b) {
        var x = (a[sort.column] || {}).value || '';
        var y = (b[sort.column] || {}).value || '';
        var bothNumeric = x !== '' && y !== '' && !isNaN(Number(x)) && !isNaN(Number(y));
        var cmp = bothNumeric ? Number(x) - Number(y) : String(x).localeCompare(String(y));
        return cmp * sort.dir;
      });
    }
    tbody.textContent = '';
    ordered.forEach(function (row) {
      var tr = el('tr');
      vars.forEach(function (name) {
        var described = SQLIB.describeTerm(row[name], { abbreviate: abbreviate });
        var td = el('td', described.display);
        if (described.kind === 'uri') {
          td.className = 'is-iri';
          if (described.fullIri) td.title = described.fullIri;
        }
        if (described.kind === 'absent') td.className = 'is-absent';
        if (described.language) td.appendChild(el('span', '@' + described.language, 'term-meta'));
        if (described.datatype) td.appendChild(el('span', '^^' + described.datatype, 'term-meta'));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  draw();
  target.appendChild(table);
  return rows.length;
}

/**
 * Render one result into a panel: the table, the boolean or the RDF payload.
 *
 * Shared by the query cell and the group cell, because a group's answer is its
 * result node's answer — same three shapes, same reading of them. Returns the
 * row count for a SELECT and null otherwise, which is what the status line and
 * the panel's own count both want.
 */
function renderResult(target, response, queryType, prefixes) {
  var panel = el('div', null, 'result');
  var head = el('div', null, 'result__head');
  head.appendChild(el('span', 'Result', 'result__title'));
  var count = el('span', '', 'result__count');
  head.appendChild(count);
  var copy = el('button', 'Copy', 'chip-button');
  copy.style.marginLeft = 'auto';
  head.appendChild(copy);
  panel.appendChild(head);
  var body = el('div', null, 'result__body');
  panel.appendChild(body);
  target.appendChild(panel);

  var rowCount = null;
  if (queryType === 'SELECT') {
    rowCount = renderSelect(body, response, prefixes);
    count.textContent = rowCount + (rowCount === 1 ? ' row' : ' rows');
    copy.addEventListener('click', function () { copyToClipboard(JSON.stringify(response, null, 2), copy); });
  } else if (queryType === 'ASK') {
    body.appendChild(el('pre', String(response.boolean)));
    copy.addEventListener('click', function () { copyToClipboard(String(response.boolean), copy); });
  } else {
    body.appendChild(el('pre', response.data));
    copy.addEventListener('click', function () { copyToClipboard(response.data, copy); });
  }
  return rowCount;
}

function wireQuery(slug) {
  var query = BUNDLE.queries[slug];
  var args = document.getElementById('args-' + slug);
  var out = document.getElementById('sub-' + slug);
  var results = document.getElementById('res-' + slug);
  var status = document.getElementById('status-' + slug);
  var runButton = document.getElementById('run-' + slug);

  args.signature = {
    inputs: query.inferredInputs,
    limits: query.limitParameters,
    offsets: query.offsetParameters
  };

  function refresh() {
    out.className = '';
    try {
      out.textContent = preview.query(slug).text(args.payload);
    } catch (error) {
      out.className = 'error';
      out.textContent = describeError(error);
    }
    // The element already says which cell is wrong and why; Run just stops
    // offering to send something that cannot be substituted.
    var ready = args.valid && out.className !== 'error';
    runButton.disabled = !ready;
    runButton.title = ready ? '' : 'Fix the arguments above first.';
  }

  args.addEventListener('change', refresh);

  var buttons = document.querySelectorAll('[data-example-for="' + slug + '"]');
  function selectExample(index) {
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].setAttribute('aria-pressed', String(Number(buttons[b].getAttribute('data-example-index')) === index));
    }
  }
  for (var b = 0; b < buttons.length; b++) {
    (function (button) {
      button.addEventListener('click', function () {
        var index = Number(button.getAttribute('data-example-index'));
        args.payload = examplePayload(query.examples[index]);
        selectExample(index);
        refresh();
      });
    })(buttons[b]);
  }

  document.getElementById('reset-' + slug).addEventListener('click', function () {
    args.payload = query.examples && query.examples.length
      ? examplePayload(query.examples[0])
      : skeletonPayload(query);
    selectExample(query.examples && query.examples.length ? 0 : -1);
    refresh();
  });

  runButton.addEventListener('click', function () {
    var endpoint = endpointInput.value.trim();
    results.textContent = '';
    status.textContent = '';
    if (!endpoint) {
      results.appendChild(el('pre', 'Set a SPARQL endpoint URL at the top of the page first.', 'error'));
      return;
    }
    var payload = args.payload;
    runButton.disabled = true;
    status.textContent = 'running…';
    var started = Date.now();

    var lib = SQLIB.fromBundle(BUNDLE, { executor: SQLIB.httpExecutor(endpoint), validate: false });
    lib.query(slug).run(payload).then(function (response) {
      var ms = Date.now() - started;
      results.textContent = '';
      var rowCount = renderResult(results, response, query.queryType, query.template.prefixes);
      status.textContent = 'ran in ' + ms + ' ms' + (rowCount === null ? '' : ' · ' + rowCount + ' rows');
      runButton.disabled = false;
    }).catch(function (error) {
      results.textContent = '';
      results.appendChild(el('pre', describeError(error), 'error'));
      status.textContent = 'failed';
      runButton.disabled = false;
    });
  });

  // Start on the first example when there is one; otherwise on a skeleton built
  // from the signature, so the shape of a call is always on screen.
  args.payload = query.examples && query.examples.length
    ? examplePayload(query.examples[0])
    : skeletonPayload(query);
  if (query.examples && query.examples.length) selectExample(0);
  refresh();
}

/**
 * A group's call, as a payload.
 *
 * One all-UNDEF row per external slot, the same wildcard a query cell opens on.
 * A group has no examples of its own — a test names a query — so this is the
 * only starting payload there is.
 */
function groupSkeletonPayload(plan) {
  var payload = { arguments: [] };
  for (var i = 0; i < plan.inputs.length; i++) {
    payload.arguments.push({
      head: { vars: plan.inputs[i].slice() },
      arguments: { bindings: [{}] }
    });
  }
  return payload;
}

function wireGroup(slug) {
  var plan = GROUP_PLANS[slug];
  var args = document.getElementById('gargs-' + slug);
  var results = document.getElementById('gres-' + slug);
  var status = document.getElementById('gstatus-' + slug);
  var ran = document.getElementById('gran-' + slug);
  var runButton = document.getElementById('grun-' + slug);
  var resetButton = document.getElementById('greset-' + slug);

  // A group the walker could not read at export time is drawn but not offered:
  // its cell says so in the markup, and Run would have nothing to walk.
  if (!plan) {
    runButton.disabled = true;
    resetButton.disabled = true;
    return;
  }

  args.signature = { inputs: plan.inputs, limits: plan.limits, offsets: plan.offsets };

  function refresh() {
    // A group has no preview pane to go red — every node past the first takes
    // its rows from the node above, so there is no one substituted text to show
    // before the walk happens. The element still says which cell is wrong.
    runButton.disabled = !args.valid;
    runButton.title = args.valid ? '' : 'Fix the arguments above first.';
  }

  args.addEventListener('change', refresh);

  resetButton.addEventListener('click', function () {
    args.payload = groupSkeletonPayload(plan);
    refresh();
  });

  runButton.addEventListener('click', function () {
    var endpoint = endpointInput.value.trim();
    results.textContent = '';
    ran.textContent = '';
    status.textContent = '';
    if (!endpoint) {
      results.appendChild(el('pre', 'Set a SPARQL endpoint URL at the top of the page first.', 'error'));
      return;
    }
    var payload = args.payload;
    runButton.disabled = true;
    status.textContent = 'running…';
    var started = Date.now();

    var lib = SQLIB.fromBundle(BUNDLE, { executor: SQLIB.httpExecutor(endpoint), validate: false });
    // runDetailed rather than run: the texts are the group's answer to "what
    // did it send", which is the substituted pane a query cell shows before it
    // runs and a group can only show afterwards.
    lib.group(slug).runDetailed(payload).then(function (walk) {
      var ms = Date.now() - started;
      results.textContent = '';
      var resultQuery = BUNDLE.queries[plan.resultQuery];
      var rowCount = renderResult(results, walk.result, resultQuery.queryType, resultQuery.template.prefixes);
      status.textContent = 'ran in ' + ms + ' ms' + (rowCount === null ? '' : ' · ' + rowCount + ' rows');

      ran.appendChild(el('p', 'What each step ran', 'section-label'));
      plan.steps.forEach(function (step) {
        var text = walk.texts[step.node];
        if (text === undefined) return;
        var block = document.createElement('details');
        block.appendChild(el('summary', step.node + ' · ' + step.query));
        block.appendChild(el('pre', text));
        ran.appendChild(block);
      });
      runButton.disabled = false;
    }).catch(function (error) {
      results.textContent = '';
      results.appendChild(el('pre', describeError(error), 'error'));
      status.textContent = 'failed';
      runButton.disabled = false;
    });
  });

  args.payload = groupSkeletonPayload(plan);
  refresh();
}

var slugs = Object.keys(BUNDLE.queries);
for (var s = 0; s < slugs.length; s++) wireQuery(slugs[s]);

var groupSlugs = Object.keys(BUNDLE.groups || {});
for (var g = 0; g < groupSlugs.length; g++) wireGroup(groupSlugs[g]);

// --- filtering: tags and free text, over cells and their rail entries ---
var activeTags = {};
var textFilter = '';

function applyFilters() {
  var tags = Object.keys(activeTags).filter(function (t) { return activeTags[t]; });
  var needle = textFilter.trim().toLowerCase();
  var shown = 0;

  // Queries and groups filter by the same two rules and on the same fields, so
  // one pass over both: a tag chip that hides half a chain's queries while
  // leaving the chain itself on screen would be reading the library twice.
  function filterCell(prefix, slug, entry) {
    var carried = entry.tags || [];
    var tagOk = tags.length === 0 || tags.some(function (t) { return carried.indexOf(t) !== -1; });
    var haystack = (slug + ' ' + (entry.description || '')).toLowerCase();
    var textOk = needle === '' || haystack.indexOf(needle) !== -1;
    var visible = tagOk && textOk;
    if (visible) shown++;

    document.getElementById(prefix + slug).hidden = !visible;
    // The rail keeps every entry, dimmed: a filtered page should never look
    // like a smaller library than it is.
    var link = document.getElementById('rail-' + prefix + slug);
    if (link) link.setAttribute('data-hidden', String(!visible));
  }

  slugs.forEach(function (slug) { filterCell('q-', slug, BUNDLE.queries[slug]); });
  groupSlugs.forEach(function (slug) { filterCell('g-', slug, BUNDLE.groups[slug]); });

  var none = document.getElementById('no-matches');
  if (none) none.hidden = shown !== 0;
}

var tagButtons = document.querySelectorAll('[data-tag]');
for (var t = 0; t < tagButtons.length; t++) {
  (function (button) {
    button.addEventListener('click', function () {
      var tag = button.getAttribute('data-tag');
      activeTags[tag] = !activeTags[tag];
      button.setAttribute('aria-pressed', String(!!activeTags[tag]));
      applyFilters();
    });
  })(tagButtons[t]);
}

var clearTags = document.getElementById('clear-tags');
if (clearTags) {
  clearTags.addEventListener('click', function () {
    activeTags = {};
    for (var i = 0; i < tagButtons.length; i++) tagButtons[i].setAttribute('aria-pressed', 'false');
    applyFilters();
  });
}

var search = document.getElementById('filter-text');
if (search) {
  search.addEventListener('input', function () {
    textFilter = search.value;
    applyFilters();
  });
}
`;

/** One rail entry: the cell's id prefix decides where it points. */
function railEntry(prefix: string, slug: string, description?: string): string {
  const desc = description ? `<span class="rail__link-desc">${escapeHtml(description)}</span>` : '';
  return `        <a class="rail__link" id="rail-${prefix}${escapeHtml(slug)}" href="#${prefix}${escapeHtml(slug)}"><span class="rail__link-name">${escapeHtml(slug)}</span>${desc}</a>`;
}

function renderRail(bundle: ExportBundle, skippedCount: number): string {
  const slugs = Object.keys(bundle.queries);
  const entries = slugs
    .map((slug) => railEntry('q-', slug, bundle.queries[slug].description))
    .join('\n');

  const groupSlugs = Object.keys(bundle.groups ?? {});
  const groupEntries =
    groupSlugs.length === 0
      ? ''
      : `    <div class="rail__group">
      <div class="rail__group-head">Groups <span class="rail__count">${groupSlugs.length}</span></div>
${groupSlugs.map((slug) => railEntry('g-', slug, bundle.groups?.[slug].description)).join('\n')}
    </div>
`;

  const notIncluded =
    skippedCount === 0
      ? ''
      : `    <div class="rail__group">
      <div class="rail__group-head">Not included <span class="rail__count">${skippedCount} draft${skippedCount === 1 ? '' : 's'}</span></div>
      <a class="rail__link" href="#not-included"><span class="rail__link-name">see why</span></a>
    </div>
`;

  return `  <aside class="rail">
    <p class="rail__title">Contents</p>
    <div class="rail__filters">
      <input id="filter-text" type="search" placeholder="Filter by name or description" aria-label="Filter queries">
    </div>
    <div class="rail__group">
      <div class="rail__group-head">Queries <span class="rail__count">${slugs.length}</span></div>
${entries}
    </div>
${groupEntries}${notIncluded}  </aside>`;
}

function renderExamples(slug: string, query: ExportedQuery): string {
  const examples = query.examples ?? [];
  if (examples.length === 0) return '';
  const buttons = examples
    .map(
      (example, index) =>
        `        <button type="button" class="example" data-example-for="${escapeHtml(slug)}" data-example-index="${index}" aria-pressed="false">${escapeHtml(example.name)}${
          example.dataDependent
            ? '<span class="badge" title="From a test with its own seed data: the arguments are real, the recorded result does not hold against an arbitrary endpoint.">seeded</span>'
            : ''
        }</button>`,
    )
    .join('\n');
  return `      <p class="section-label">Examples</p>
      <div class="examples">
${buttons}
      </div>
`;
}

function renderExpected(query: ExportedQuery): string {
  const withExpected = (query.examples ?? []).filter((example) => example.expected);
  if (withExpected.length === 0) return '';
  const blocks = withExpected
    .map(
      (example) =>
        `        <details>
          <summary>${escapeHtml(example.name)}${example.dataDependent ? ' (against the test&#39;s own seed data)' : ''}</summary>
          <pre>${escapeHtml(example.expected as string)}</pre>
        </details>`,
    )
    .join('\n');
  return `      <p class="section-label">Recorded results from the library&#39;s tests — reference only, not assertions</p>
${blocks}
`;
}

function renderCell(slug: string, query: ExportedQuery): string {
  const tags = (query.tags ?? [])
    .map((tag) => `<span class="tag" aria-hidden="true">${escapeHtml(tagLabel(tag))}</span>`)
    .join('');
  const signature = signatureParts(query)
    .map((part) => `<span>${escapeHtml(part)}</span>`)
    .join('');

  return `    <section class="cell" id="q-${escapeHtml(slug)}">
      <div class="cell__head">
        <span class="cell__name">${escapeHtml(slug)}</span>
        <span class="kind">${escapeHtml(query.queryType)}</span>
        ${tags}
      </div>
      <div class="cell__body">
${query.description ? `        <p class="cell__desc">${escapeHtml(query.description)}</p>\n` : ''}        <p class="sig">${signature}</p>
${renderExamples(slug, query)}      <p class="section-label">Arguments</p>
      <sqlib-args id="args-${escapeHtml(slug)}"></sqlib-args>
      <div class="panes">
        <div>
          <div class="pane__head"><span class="pane__title">Template</span></div>
          <pre>${highlightSparql(escapeHtml(renderTemplateForDisplay(query)))}</pre>
        </div>
        <div>
          <div class="pane__head"><span class="pane__title">Substituted</span></div>
          <pre id="sub-${escapeHtml(slug)}"></pre>
        </div>
      </div>
      <div class="runbar">
        <button type="button" class="run" id="run-${escapeHtml(slug)}">Run</button>
        <button type="button" class="chip-button" id="reset-${escapeHtml(slug)}">Reset to example</button>
        <span class="runbar__status" id="status-${escapeHtml(slug)}"></span>
      </div>
      <div id="res-${escapeHtml(slug)}"></div>
${renderExpected(query)}      </div>
    </section>`;
}

/**
 * The chain, step by step.
 *
 * Each node names the query it runs and links to that query's own cell, which is
 * where its template already is — a group repeating four templates would be four
 * copies of text the page carries anyway, and they would be the copies that go
 * stale. What is only true here is the wiring: which upstream node fills which
 * variables, and which slots are left for the caller.
 */
function renderChain(plan: GroupPlan): string {
  const steps = plan.steps
    .map((step) => {
      const wiring = step.from
        .map(
          (edge) =>
            `<span class="chain__wire">${escapeHtml(
              edge.mappings.map(({ source, target }) => `?${source}→?${target}`).join(', '),
            )} from ${escapeHtml(edge.node)}</span>`,
        )
        .join('');
      const asks = step.inputs
        .map(
          (vars) =>
            `<span class="chain__asks">${escapeHtml(vars.map((name) => `?${name}`).join(', '))} from you</span>`,
        )
        .join('');
      const isResult = step.node === plan.resultNode;
      return `        <li class="chain__step">
          <span class="chain__node">${escapeHtml(step.node)}</span>
          <a class="chain__query" href="#q-${escapeHtml(step.query)}">${escapeHtml(step.query)}</a>
          <span class="kind">${escapeHtml(step.queryType)}</span>
          ${wiring}${asks}${isResult ? '<span class="chain__result">result</span>' : ''}
        </li>`;
    })
    .join('\n');

  return `      <p class="section-label">Steps</p>
      <ol class="chain">
${steps}
      </ol>
`;
}

/**
 * A group cell: the same document as a query cell, one altitude up.
 *
 * The differences are what a chain makes of the query cell's three parts. There
 * is no Template pane, because the templates belong to the queries the steps
 * link to; there is no Substituted pane *before* a run, because every node past
 * the first takes its rows from the node above it, so what a node will send is
 * not known until the walk reaches it — the page shows all of them afterwards
 * instead. Arguments, Run and the result table are the query cell's, unchanged.
 */
function renderGroupCell(slug: string, group: ExportedGroup, plan: GroupPlan | undefined): string {
  const tags = (group.tags ?? [])
    .map((tag) => `<span class="tag" aria-hidden="true">${escapeHtml(tagLabel(tag))}</span>`)
    .join('');

  const unreadable = `        <p class="sig">This group could not be read from the bundle, so it cannot be run here.</p>
`;
  const signature = plan
    ? `        <p class="sig">${groupSignatureParts(plan)
        .map((part) => `<span>${escapeHtml(part)}</span>`)
        .join('')}</p>
`
    : unreadable;

  return `    <section class="cell" id="g-${escapeHtml(slug)}">
      <div class="cell__head">
        <span class="cell__name">${escapeHtml(slug)}</span>
        <span class="kind">GROUP</span>
        ${tags}
      </div>
      <div class="cell__body">
${group.description ? `        <p class="cell__desc">${escapeHtml(group.description)}</p>\n` : ''}${signature}${plan ? renderChain(plan) : ''}      <p class="section-label">Arguments</p>
      <sqlib-args id="gargs-${escapeHtml(slug)}"></sqlib-args>
      <div class="runbar">
        <button type="button" class="run" id="grun-${escapeHtml(slug)}">Run</button>
        <button type="button" class="chip-button" id="greset-${escapeHtml(slug)}">Reset arguments</button>
        <span class="runbar__status" id="gstatus-${escapeHtml(slug)}"></span>
      </div>
      <div id="gres-${escapeHtml(slug)}"></div>
      <div id="gran-${escapeHtml(slug)}"></div>
      </div>
    </section>`;
}

/**
 * Render the whole page.
 *
 * One string, no assets, no network beyond the endpoint the viewer supplies.
 */
export function generateDemoPage(bundle: ExportBundle, options: DemoPageOptions = {}): string {
  const runtimeSource = options.runtimeSource ?? loadRuntimeSource();
  const slugs = Object.keys(bundle.queries);
  const groupSlugs = Object.keys(bundle.groups ?? {});
  const plans = buildGroupPlans(bundle);
  const title = bundle.library.name ?? bundle.library.id;
  const skipped = options.skipped ?? [];

  // A group carries its own library tags, and the chip that hides its queries
  // has to be able to hide it too — otherwise a filtered page shows a chain
  // whose every step is hidden.
  const allTags = [
    ...new Set([
      ...slugs.flatMap((slug) => bundle.queries[slug].tags ?? []),
      ...groupSlugs.flatMap((slug) => bundle.groups?.[slug].tags ?? []),
    ]),
  ].sort();
  const tagBar =
    allTags.length === 0
      ? ''
      : `    <div class="tagbar">
      <span class="tagbar__label">filter by tag</span>
${allTags
  .map(
    (tag) =>
      `      <button type="button" class="tag" data-tag="${escapeHtml(tag)}" aria-pressed="false" title="${escapeHtml(tag)}">${escapeHtml(tagLabel(tag))}</button>`,
  )
  .join('\n')}
      <button type="button" class="chip-button" id="clear-tags">clear</button>
    </div>`;

  const notIncluded =
    skipped.length === 0
      ? ''
      : `    <div class="callout" id="not-included">
      <strong>${skipped.length} ${skipped.length === 1 ? 'query is' : 'queries are'} in this library but not in this export.</strong>
      <ul>${skipped
        .map((entry) => `<li>${escapeHtml(entry.name)} — ${escapeHtml(entry.reason)}</li>`)
        .join('')}</ul>
    </div>`;

  const cells = [
    ...slugs.map((slug) => renderCell(slug, bundle.queries[slug])),
    ...groupSlugs.map((slug) =>
      renderGroupCell(slug, bundle.groups![slug], plans[slug]),
    ),
  ];
  const body =
    cells.length === 0
      ? '    <p class="empty">This export contains no queries.</p>'
      : cells.join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — sqlib library</title>
<style>${PAGE_STYLES}
${'/* argument builder, from @sparql-query-lib/runtime */'}
</style>
<style id="args-styles"></style>
</head>
<body>

<div class="topbar">
  <span class="topbar__title">${escapeHtml(title)}</span>
  <span class="topbar__meta">${slugs.length} quer${slugs.length === 1 ? 'y' : 'ies'}${
    groupSlugs.length === 0 ? '' : ` · ${groupSlugs.length} group${groupSlugs.length === 1 ? '' : 's'}`
  }${bundle.generatedAt ? ` · exported ${escapeHtml(bundle.generatedAt)}` : ''}</span>
  <span class="topbar__spacer"></span>
  <span class="endpoint">
    <label for="endpoint" class="topbar__meta">SPARQL endpoint</label>
    <input id="endpoint" type="url" placeholder="https://example.org/sparql" value="${escapeHtml(options.endpoint ?? '')}">
  </span>
  <span class="anon" title="This page carries no credentials and enforces no permissions of its own.">requests are anonymous — no authorization is sent</span>
  <button type="button" class="chip-button" id="copy-bundle">Copy bundle JSON</button>
</div>

<div class="layout">
${renderRail(bundle, skipped.length)}

<main>
  <div class="lede">
    <h1>${escapeHtml(title)}</h1>
${bundle.library.name ? `    <p class="lede__stats"><code>${escapeHtml(bundle.library.id)}</code></p>\n` : ''}    <p class="lede__stats">Runs entirely in this page — no sqlib server. Edit any argument and the substituted query updates beside its template.</p>
${tagBar}
  </div>

${notIncluded}
  <p class="empty" id="no-matches" hidden>Nothing matches those filters.</p>

${body}
</main>
</div>

<script>
(function () {
  var module = { exports: {} };
  var exports = module.exports;
${runtimeSource}
  window.SQLIB = module.exports;
  document.getElementById('args-styles').textContent = module.exports.ARGS_ELEMENT_STYLES || '';
})();
</script>
<script>window.SQLIB_BUNDLE = ${embedJson(bundle)};
window.SQLIB_GROUP_PLANS = ${embedJson(plans)};</script>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
}
