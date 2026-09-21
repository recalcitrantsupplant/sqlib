/**
 * What an agent is told before it sees a single tool.
 *
 * MCP carries a server-level `instructions` string in the initialize result,
 * and the clients that matter (Claude Code, Claude Desktop, Cursor) put it in
 * the model's system prompt. It is the one place a concept that spans many
 * tools can be stated once — which is what the catalogue's descriptions cannot
 * do, since each is read on its own while the model picks a tool.
 *
 * The two mistakes this exists to prevent, seen in real sessions:
 *
 *  - Putting SPARQL text on the *query*. A `Query` is metadata; the text lives
 *    on a `QueryVersion`, and `queries.create` rejects a `queryString` outright.
 *  - Not knowing how a query declares parameters, so either the agent invents
 *    a `?param` convention or never supplies `arguments` at all.
 *
 * The text is written for a model, not a person: terse, concrete, one example
 * of every shape it must produce. It is deliberately short — it is sent once
 * per session but read against everything else in the context — so anything
 * a single tool can say for itself stays in that tool's description.
 *
 * Tool names are written with the catalogue's dots. `catalogueGuide(publicName)`
 * rewrites them for a door that renames (MCP sanitises to underscores), so the
 * model reads the names it can actually call. A test asserts every name here
 * exists in the catalogue, so a renamed tool cannot leave a stale mention.
 */
import { rewriteToolNames } from './registry.js';
import { tools } from './tools.js';

const GUIDE = `sqlib is a library of saved, parameterised SPARQL queries that run against registered backends.

Entities
- Library: everything belongs to one (\`isPartOf\`). Backend: a SPARQL endpoint or in-memory store that queries run against.
- Query: metadata only — name, description, library, tags, defaultBackend. It holds NO SPARQL text; \`queries.create\` rejects a \`queryString\`.
- QueryVersion: the SPARQL text. \`queries.createVersion\` with body \`{"queryVersion": {"queryString": "...", "comment": "..."}}\` saves an immutable snapshot and makes it the query's \`currentVersion\`. To change the text, create another version. \`queries.update\` edits metadata or repoints \`currentVersion\`.
- Ids are server-minted IRIs (\`urn:...\`). Version numbers are integers; \`queries.getVersion\` takes the number, not the version IRI.

Parameters
- A query declares a parameter with a VALUES clause whose only row is all UNDEF: \`VALUES ?city { UNDEF }\` or \`VALUES (?a ?b) { (UNDEF UNDEF) }\`. Every other VALUES clause is plain data and is never substituted.
- \`LIMIT 0001\` / \`OFFSET 0002\` (three leading zeros, then a number) are named LIMIT/OFFSET parameters; their names are "1" and "2".
- \`detection.detectInputs\` returns what a query declares (\`valuesInputs\` as groups of variable names, \`limitParameters\`, \`offsetParameters\`). Call it rather than guessing.

Running
- \`execute.run\` with \`targetId\` = a query id (runs its currentVersion), a version id, or a query group id. \`backendId\` is required for a query and must be omitted for a query group.
- \`arguments\` is an array with exactly one entry per parameter slot, in order of appearance, in SPARQL-results-JSON shape: \`{"head": {"vars": ["city"]}, "arguments": {"bindings": [{"city": {"type": "uri", "value": "http://example.org/Perth"}}, {"city": {"type": "literal", "value": "Hobart", "xml:lang": "en"}}]}}\`. \`head.vars\` must match the slot's variables; leave a variable out of a row to bind it UNDEF.
- \`limits\` / \`offsets\`: \`[{"name": "1", "value": 20}]\`.
- Saved argument sets (\`queries.listArgumentSets\`, \`argumentSets.get\`) hold reusable arguments; pass their ids as \`argumentSetIds\` instead of inline \`arguments\`.
- \`sparql.proxyQuery\` runs ad-hoc SPARQL text against a backend without saving anything, with the same \`arguments\` mechanism.

Rendered results
- \`execute.run\` and \`sparql.proxyQuery\` return an interactive result table, and \`app.bench.open\` an editable query bench, in clients that render MCP Apps. Which tools do this is not visible to you — hosts strip the metadata that says so before you see a result — so it is stated here and in those three descriptions. When one renders, the user is already looking at the rows; summarise, do not reprint them.

Typical flow: \`libraries.list\` → \`backends.list\` → \`detection.validateQuery\` → \`detection.detectInputs\` → \`queries.create\` → \`queries.createVersion\` → \`execute.run\`.`;

/** Every backticked dotted token in the guide — tool names, and the odd non-tool. */
const TOOL_NAME_MENTION = /`([a-z][A-Za-z]*\.[a-z][A-Za-z]*)`/g;

/**
 * The guide with tool names rendered the way a door publishes them — the same
 * rewrite the registry applies to descriptions, so the two cannot disagree.
 * A dotted token that is not a tool (`head.vars`) is left as it is.
 */
export function catalogueGuide(publicName: (name: string) => string = (name) => name): string {
  return rewriteToolNames(GUIDE, tools.map((tool) => tool.name), publicName);
}

/** The dotted tool names the guide refers to — what the drift test checks. */
export function guideToolMentions(): string[] {
  return Array.from(GUIDE.matchAll(TOOL_NAME_MENTION), (match) => match[1]!);
}
