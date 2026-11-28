#!/usr/bin/env node
/**
 * Build an instance's library from its `library/seed.json`, over the API.
 *
 * Runs inside the seed stage of the image build, against a server started with
 * writes open. The published runtime refuses them, so everything the demo holds
 * exists because it was written here.
 *
 * **Why a manifest rather than a committed store.** The N-Quads store is
 * regenerated whole and carries a fresh timestamp on every entity, so a diff of
 * it says nothing. `seed.json` and the files beside it diff one line at a time,
 * which is the same reason the SRL instance vendors suite files rather than its
 * store.
 *
 * Which ids are ours and which the server mints is settled below, at the
 * `minted` map.
 *
 * Usage: seed-demo-library.mjs --api URL --library DIR [--token-url URL]
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && process.argv[at + 1]) return process.argv[at + 1];
  console.error(`seed-demo-library: --${name} is required`);
  process.exit(2);
}

const api = arg('api').replace(/\/$/, '');
const libraryDir = arg('library');
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
/*
 * Where the runtime image keeps the CSV files an ETL job reads, and the issuer
 * whose people and groups an access rule names. Both are build-time settings:
 * the ETL path is baked into a job's SQL, and a principal IRI is a hash of the
 * issuer and the name, so a different issuer needs a rebuilt store.
 */
const etlDir = option('etl-dir', process.env.DEMO_ETL_DIR || '/opt/sqlib-demo/etl');
const issuer = option('issuer', process.env.DEMO_ISSUER || 'urn:sqlib:demo');
// The manifest's `ogcServices` are seeded only when asked for, because only a
// sqlib with OGC services (`/ogc-services`) takes them.
const withOgc = process.argv.includes('--ogc') || process.env.DEMO_OGC === 'true';
// The demo's own Fuseki, for a backend endpoint written `{{fuseki}}/...`.
const fuseki = option('fuseki', process.env.DEMO_FUSEKI_URL || '').replace(/\/$/, '');

const manifest = JSON.parse(readFileSync(join(libraryDir, 'seed.json'), 'utf8'));
const text = relative => readFileSync(join(libraryDir, relative), 'utf8');

/*
 * sqlib's principal IRI: the issuer and the raw claim value, hashed, as
 * `principalIri` in sqlib's auth/principals.ts makes it. Kept in step by hand;
 * the Rail operations access rules are what break if it drifts.
 */
const principalIri = (kind, name) =>
  `urn:sqlib:principal:${kind}:${createHash('sha256').update(`${issuer}|${name}`).digest('hex').slice(0, 32)}`;

/*
 * `{{…}}` in a data graph, a notebook or an ETL job's SQL names something only
 * known at seeding time: `{{key}}` an entity the server minted an id for,
 * `{{group:hr}}` or `{{user:alice}}` a principal of the demo sign-in, and
 * `{{etlDir}}` where the CSV files are, and `{{csv:path}}` a CSV file beside
 * the manifest as an inline table.
 */
const expand = value => value.replace(/\{\{([^}]+)\}\}/g, (_, token) => {
  if (token === 'etlDir') return etlDir;
  if (token.startsWith('csv:')) return csvTable(token.slice(4));
  if (token === 'issuer') return issuer;
  if (token === 'fuseki') {
    if (!fuseki) throw new Error('the manifest names {{fuseki}}, and no --fuseki or DEMO_FUSEKI_URL is set');
    return fuseki;
  }
  const principal = /^(user|group):(.+)$/.exec(token);
  if (principal) return principalIri(principal[1], principal[2]);
  return resolve(token);
});

/*
 * A CSV file as a DuckDB subquery, `(SELECT * FROM (VALUES ...) AS t(columns))`,
 * for the SQL to name with its own alias.
 *
 * An ETL job that reads its rows from the SQL text needs no filesystem access,
 * so the deployment can run DuckDB with ETL_DUCKDB_ALLOW_FILESYSTEM=false. A
 * column's type follows its values, as read_csv would sniff it: all integers,
 * all decimals (as DOUBLE, so 115.77 does not print as 115.770), all
 * `HH:MM:SS` times, or text. The CSV is plain: a header row,
 * commas, no quoted fields.
 */
function csvTable(path) {
  const [header, ...rows] = text(path).trim().split(/\r?\n/).map(line => line.split(','));
  const columns = header.map((_, index) => rows.map(row => row[index] ?? ''));
  const kinds = columns.map(values =>
    values.every(v => /^-?\d+$/.test(v)) ? 'integer'
      : values.every(v => /^-?\d+(\.\d+)?$/.test(v)) ? 'double'
        : values.every(v => /^\d{2}:\d{2}:\d{2}$/.test(v)) ? 'time'
          : 'text');
  const literal = (value, kind) =>
    kind === 'integer' ? value : kind === 'double' ? `${value}::DOUBLE` : kind === 'time' ? `TIME '${value}'` : `'${value.replaceAll("'", "''")}'`;
  const tuples = rows.map(row => `(${row.map((value, index) => literal(value, kinds[index])).join(', ')})`);
  return `(SELECT * FROM (VALUES\n  ${tuples.join(',\n  ')}\n) AS t(${header.join(', ')}))`;
}

/*
 * A description is either inline or, when it is prose worth reviewing as
 * prose, a Markdown file beside the manifest: the tutorial's lessons are
 * paragraphs and lists, and a paragraph in a JSON string diffs as one line.
 * Trailing whitespace is dropped so the stored text ends where the prose does.
 */
const describe = entity =>
  entity.descriptionFile ? text(entity.descriptionFile).trimEnd() : entity.description;
const withDescription = entity => {
  const { descriptionFile: _file, starterFile: _starter, author: _author, ...rest } = entity;
  const description = describe(entity);
  return description === undefined ? rest : { ...rest, description };
};

/*
 * Who each write is made as. sqlib stamps `createdBy` and `modifiedBy` from the
 * request's caller, and the runtime records no writes, so the names a visitor
 * sees in a library's activity are the ones set here.
 *
 * An entity's `author` names a demo person by id (`people.json`); without one,
 * the library's `author` is used. A history entry may name its own author, so
 * a query can be started by one person and changed by another. With no
 * `--token-url` (the SRL instance, which has no demo people), every write is
 * made with no token and records nobody.
 */
const tokenUrl = option('token-url', process.env.DEMO_TOKEN_URL || '').replace(/\/$/, '');
const libraryAuthor = manifest.library.author ?? null;
let actingAs = libraryAuthor;
const actAs = person => {
  actingAs = person ?? libraryAuthor;
};
// Tokens live 1 hour; one is asked for again after 50 minutes.
const tokens = new Map();
async function bearerFor(person) {
  const cached = tokens.get(person);
  if (cached && Date.now() - cached.at < 50 * 60 * 1000) return cached.token;
  const response = await fetch(`${tokenUrl}/token/${encodeURIComponent(person)}`);
  if (!response.ok) throw new Error(`no token for the demo person "${person}": ${response.status} ${await response.text()}`);
  const { token } = await response.json();
  tokens.set(person, { token, at: Date.now() });
  return token;
}

async function call(method, path, body) {
  const headers = {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(tokenUrl && actingAs ? { Authorization: `Bearer ${await bearerFor(actingAs)}` } : {}),
  };
  const response = await fetch(`${api}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${method} ${path} -> ${response.status} ${detail.slice(0, 400)}`);
  }
  return response.status === 204 ? null : response.json();
}

/*
 * A query's and an argument set's versions are at `/:id/versions` from sqlib
 * dbdbe6c, and were at `/:id/v` before it. The main instance and the SRL
 * instance pin different revisions and share this script, so it posts to the
 * new path and falls back to the old one when that route does not exist.
 */
async function createVersion(collection, id, body) {
  const base = `/${collection}/${encodeURIComponent(id)}`;
  try {
    const created = await call('POST', `${base}/versions`, body);
    versionRoute.set(collection, 'versions');
    return created;
  } catch (error) {
    if (!/ -> 404 /.test(error.message)) throw error;
    const created = await call('POST', `${base}/v`, body);
    versionRoute.set(collection, 'v');
    return created;
  }
}
// Which of the two spellings each collection answered on, for the routes under
// a version — a benchmark's freeze and run — that have no fallback of their own.
const versionRoute = new Map();

const libraryId = manifest.library.id;

/*
 * Ids are the API's for some of these kinds. `POST /libraries`, `/tags`,
 * `/backends`, `/queries`, `/query-groups` and `/benchmark-experiments` accept
 * a client-supplied `id` and refuse one that already exists; `/data-graphs`,
 * `/rule-sets`, `/argument-sets`, `/tests` and `/etl-jobs` mint
 * unconditionally. So the manifest spells the first six out — a rebuild lands
 * on the same ids, and a notebook naming a query keeps working — and gives the
 * rest a manifest-local `key` that this script resolves to whatever was
 * minted. A cross-reference in `seed.json` is one or the other,
 * never a guess at an id the server has not handed out.
 */
const minted = new Map();
const resolve = key => {
  const id = minted.get(key);
  if (!id) throw new Error(`seed.json references "${key}", which nothing above it creates`);
  return id;
};
// The summary is the only reader of these. The plural is given rather than
// derived, because "querys" is what deriving it produces.
const counts = new Map();
const tally = (one, many = `${one}s`) => {
  const seen = counts.get(one) ?? { one, many, count: 0 };
  seen.count += 1;
  counts.set(one, seen);
};

// 1. The library. `defaultBackend` waits for the backends to exist.
const libraryDescription = describe(manifest.library);
const publishing = {
  ...(manifest.library.slug ? { slug: manifest.library.slug } : {}),
  ...(manifest.library.publishAll ? { publishAll: true } : {}),
};
await call('POST', '/libraries', {
  id: libraryId,
  name: manifest.library.name,
  description: libraryDescription,
  ...publishing,
});
tally('library', 'libraries');

// 2. Tags, which the entities below reference by id.
for (const tag of manifest.tags ?? []) {
  actAs(tag.author);
  await call('POST', '/tags', { ...withDescription(tag), isPartOf: libraryId });
  tally('tag');
}

// 3. Data graphs, each with its one version. A backend sourced from a graph
//    needs the graph first, and so does a test case that seeds a store from it.
const dataGraphVersions = new Map();
for (const graph of manifest.dataGraphs ?? []) {
  actAs(graph.author);
  const created = await call('POST', '/data-graphs', {
    name: graph.name,
    description: describe(graph),
    isPartOf: [libraryId],
  });
  minted.set(graph.key, created.id);
  const version = await call('POST', `/data-graphs/${encodeURIComponent(created.id)}/versions`, {
    contentString: expand(text(graph.file)),
    contentFormat: graph.contentFormat,
  });
  dataGraphVersions.set(graph.key, version.id);
  tally('data graph');
}

// 4. Backends. `oxigraphConfig` is a JSON *string* on the wire — the store
//    round-trips it as a literal — so the manifest holds an object and it is
//    serialised here rather than being escaped by hand in the JSON.
for (const backend of manifest.backends ?? []) {
  actAs(backend.author);
  // The graph policy names a query that does not exist yet; see 6a.
  const { oxigraphConfig, graphPolicy: _policy, author: _author, ...rest } = backend;
  const resolved = oxigraphConfig && {
    ...oxigraphConfig,
    sources: (oxigraphConfig.sources ?? []).map(source => ({
      ...source,
      ...(source.dataGraphId ? { dataGraphId: resolve(source.dataGraphId) } : {}),
    })),
  };
  await call('POST', '/backends', {
    ...rest,
    ...(rest.endpoint ? { endpoint: expand(rest.endpoint) } : {}),
    ...(resolved ? { oxigraphConfig: JSON.stringify(resolved) } : {}),
  });
  tally('backend');
}

// 5. Now the library can name the backend its queries run against by default.
//    Which backends a visitor may use is not a library field (sqlib#108 removed
//    `allowedBackends`): it is a grant per backend, seeded from the instance's
//    grants.ttl. The demo's point is that a visitor can re-run a query
//    somewhere else, so grants.ttl names every backend the manifest declares.
actAs();
await call('PUT', `/libraries/${encodeURIComponent(libraryId)}`, {
  name: manifest.library.name,
  description: libraryDescription,
  ...(manifest.library.defaultBackend ? { defaultBackend: manifest.library.defaultBackend } : {}),
  ...publishing,
});

// The expanded current version of each query, by query id. A query group node
// runs a query *version* and wires to that version's ports, so the groups below
// read both from here rather than asking for them again.
const queryVersions = new Map();

// 6. Queries. The text lives on the version, never on the query, and the
//    version body is a wrapper: the version's own fields go inside
//    `queryVersion`.
//
//    A `starterFile` is saved first, so it is version 1 and `file` is the
//    current version. That is the tutorial's convention for an exercise: the
//    first version is where a learner starts, the current one a solution —
//    versions a visitor can already browse, rather than a field sqlib has no
//    notion of.
for (const query of manifest.queries ?? []) {
  // A query with a history was started by whoever wrote its first version.
  actAs(query.history?.[0]?.author ?? query.author);
  await call('POST', '/queries', {
    id: query.id,
    name: query.name,
    description: describe(query),
    isPartOf: [libraryId],
    ...(query.tags ? { tags: query.tags } : {}),
    ...(query.defaultBackend ? { defaultBackend: query.defaultBackend } : {}),
  });
  if (query.starterFile) {
    await createVersion('queries', query.id, {
      queryVersion: { queryString: text(query.starterFile), comment: 'Starting point.' },
    });
  }
  // Earlier versions, oldest first, so a query has a history to compare and an
  // environment has an older version to point at.
  for (const earlier of query.history ?? []) {
    actAs(earlier.author ?? query.author);
    await createVersion('queries', query.id, {
      queryVersion: {
        queryString: text(earlier.file),
        comment: earlier.comment,
        ...(earlier.tool !== undefined ? { tool: earlier.tool } : {}),
      },
    });
  }
  actAs(query.author);
  const current = await createVersion('queries', query.id, {
    queryVersion: {
      queryString: text(query.file),
      comment: query.comment,
      ...(query.tool !== undefined ? { tool: query.tool } : {}),
    },
    // A parameter the query must be given, named by its variables.
    ...(query.inputPolicies ? { inputPolicies: query.inputPolicies } : {}),
  });
  queryVersions.set(query.id, current);
  tally('query', 'queries');
}

// 6c. OGC services. Each collection file is a collection of the service: the
//     query it runs, the `ogc` mapping, and the JSON-LD terms. A service is
//     served at `/ogc/{slug}`.
for (const service of withOgc ? manifest.ogcServices ?? [] : []) {
  actAs(service.author);
  const created = await call('POST', '/ogc-services', {
    ...(service.id ? { id: service.id } : {}),
    name: service.name,
    description: describe(service),
    slug: service.slug,
    isPartOf: [libraryId],
  });
  await call('POST', `/ogc-services/${encodeURIComponent(created.id)}/versions`, {
    collections: service.collections.map(file => JSON.parse(text(file))),
    ...(service.comment ? { comment: service.comment } : {}),
  });
  tally('OGC service');
}

// 6a. A backend's graph policy: a policy query, pinned at its current version,
//     run on an auth backend. Set once the policy query exists.
for (const backend of manifest.backends ?? []) {
  actAs(backend.author);
  if (!backend.graphPolicy) continue;
  const version = queryVersions.get(backend.graphPolicy.query);
  if (!version) throw new Error(`the backend "${backend.name}" names the policy ${backend.graphPolicy.query}, which the manifest does not create`);
  await call('PUT', `/backends/${encodeURIComponent(backend.id)}`, {
    graphPolicyQueryVersion: version.queryVersion.id,
    graphPolicyBackend: backend.graphPolicy.backend,
  });
  tally('graph policy', 'graph policies');
}

// 6b. Tuple sets: a table of RDF terms, imported from a CSV beside the
//     manifest. They take a client-supplied id, so a notebook can name one.
for (const tupleSet of manifest.tupleSets ?? []) {
  actAs(tupleSet.author);
  await call('POST', '/tuple-sets', {
    id: tupleSet.id,
    name: tupleSet.name,
    description: describe(tupleSet),
    isPartOf: [libraryId],
    ...(tupleSet.tags ? { tags: tupleSet.tags } : {}),
  });
  await call('POST', `/tuple-sets/${encodeURIComponent(tupleSet.id)}/versions`, {
    contentString: text(tupleSet.file),
    sourceFormat: tupleSet.sourceFormat ?? 'csv',
    ...(tupleSet.columnTypes ? { columnTypes: tupleSet.columnTypes } : {}),
    ...(tupleSet.comment ? { comment: tupleSet.comment } : {}),
  });
  tally('tuple set');
}

const ruleSetVersions = new Map();

// 7. Rule sets, imported as SRL documents. The import parses the document and
//    writes a version holding the rules and data blocks it found, so the file
//    beside this manifest is the authored form and the entities are derived.
//    A `starterFile` is imported first, as for queries above.
for (const ruleSet of manifest.ruleSets ?? []) {
  actAs(ruleSet.author);
  const created = await call('POST', '/rule-sets', {
    name: ruleSet.name,
    description: describe(ruleSet),
    isPartOf: [libraryId],
    ...(ruleSet.tags ? { tags: ruleSet.tags } : {}),
  });
  minted.set(ruleSet.key, created.id);
  if (ruleSet.starterFile && ruleSet.starterIsNotSrl) {
    /*
     * A starting point that is deliberately not SRL — SPARQL pasted into a rule
     * set, for the learner to port. The SRL import parses, so it cannot store
     * one; this is the route sqlib's own suite seeder takes for the documents
     * the spec says must be rejected: the whole document as one rule version
     * the grammar refused, and a rule-set version holding it, both under the
     * invalid-save override. That override needs
     * FEATURE_RULES_ALLOW_INVALID_SAVE on the seeding server, and a sqlib whose
     * rule-set version route accepts `allowInvalidSave`.
     */
    const rule = await call('POST', '/rules', {
      name: `${ruleSet.name} (starting point)`,
      description: 'The exercise as the learner receives it: SPARQL spellings in a rule set, which SRL rejects.',
      isPartOf: [libraryId],
    });
    const ruleVersion = await call('POST', `/rules/${encodeURIComponent(rule.id)}/versions`, {
      ruleString: text(ruleSet.starterFile),
      comment: 'Starting point.',
      allowInvalidSave: true,
    });
    await call('POST', `/rule-sets/${encodeURIComponent(created.id)}/versions`, {
      hasRule: [ruleVersion.id],
      comment: 'Starting point.',
      allowInvalidSave: true,
    });
  } else if (ruleSet.starterFile) {
    await call('POST', `/rule-sets/${encodeURIComponent(created.id)}/srl`, {
      srl: text(ruleSet.starterFile),
      comment: 'Starting point.',
    });
  }
  await call('POST', `/rule-sets/${encodeURIComponent(created.id)}/srl`, {
    srl: text(ruleSet.file),
    comment: ruleSet.comment,
  });
  if (ruleSet.browserDefaultDataGraph) {
    await setBrowserDefaultDataGraph(created.id, ruleSet);
  }
  // A rule set node and a benchmark both name a rule set *version*.
  const { currentVersion } = await call('GET', `/rule-sets/${encodeURIComponent(created.id)}`);
  ruleSetVersions.set(ruleSet.key, currentVersion);
  tally('rule set');
}

/*
 * The data graph the web application selects when the rule set opens, named
 * by the manifest key of a graph above. It floats: the graph's current version
 * is selected, which is the one version the manifest creates. Runs over the API
 * and MCP ignore it, so the route is not needed to seed a working library.
 * sqlib has it from de36aaa; against an older API the rule set is seeded
 * without a default rather than not at all.
 */
async function setBrowserDefaultDataGraph(ruleSetId, ruleSet) {
  try {
    await call('PUT', `/rule-sets/${encodeURIComponent(ruleSetId)}/browser-defaults`, {
      dataGraphs: [resolve(ruleSet.browserDefaultDataGraph)],
    });
    tally('browser default data graph');
  } catch (error) {
    if (!/ -> 404 /.test(error.message)) throw error;
    console.warn(`seed-demo-library: no browser default for "${ruleSet.name}": this sqlib has no /browser-defaults route`);
  }
}

// 8. Query groups. A group's content is one flat write, `POST …/versions`,
//    whose ids for things it is minting begin `urn:ui-temp:`. The manifest
//    describes the graph by node key and variable name, and this builds the
//    payload: every port is a real IRI from the query version it belongs to, or
//    a temporary one declared here for a rule set node's two graphs.
for (const group of manifest.queryGroups ?? []) {
  actAs(group.author);
  await call('POST', '/query-groups', {
    id: group.id,
    name: group.name,
    description: describe(group),
    isPartOf: libraryId,
    ...(group.tags ? { tags: group.tags } : {}),
  });
  await createVersion('query-groups', group.id, queryGroupPayload(group));
  tally('query group');
}

function queryGroupPayload(group) {
  const where = `the query group "${group.name}"`;
  const nodes = new Map();
  const rdfOutputs = [];

  const executionNodes = group.nodes.map(node => {
    const id = `urn:ui-temp:${node.key}`;
    if (node.query) {
      const version = queryVersions.get(node.query);
      if (!version) throw new Error(`${where} runs ${node.query}, which the manifest does not create`);
      // An input tuple is named for its variables, which is what the manifest
      // spells an edge's target with: `"input": "country"`.
      const inputs = new Map((version.inputTuples ?? []).map(tuple => [tuple.name, tuple.id]));
      const output = version.queryVersion.inferredOutputs[0];
      const rdf = /^(CONSTRUCT|DESCRIBE)$/i.test(version.queryVersion.queryType ?? '');
      nodes.set(node.key, { id, inputs, output, rdf });
      return {
        id,
        nodeType: 'QueryNode',
        queryId: version.queryVersion.id,
        backendId: node.backend,
        inputs: [...inputs.values()],
        outputs: [output],
      };
    }
    if (node.ruleSet) {
      // A rule set node's ports are its base graph in and its inference graph
      // out. Nothing has minted them yet, so they are declared here.
      const graphIn = `urn:ui-temp:${node.key}-base`;
      const graphOut = `urn:ui-temp:${node.key}-inferred`;
      rdfOutputs.push({ id: graphIn, name: 'Base graph' }, { id: graphOut, name: 'Inference graph' });
      nodes.set(node.key, { id, inputs: new Map(), graphIn, output: graphOut, rdf: true });
      return {
        id,
        nodeType: 'RuleSetNode',
        ruleSetVersion: ruleSetVersions.get(node.ruleSet) ?? resolve(node.ruleSet),
        inputs: [graphIn],
        outputs: [graphOut],
      };
    }
    throw new Error(`${where} has a node "${node.key}" naming neither a query nor a rule set`);
  });

  const node = key => {
    const found = nodes.get(key);
    if (!found) throw new Error(`${where} has an edge naming "${key}", which is not one of its nodes`);
    return found;
  };
  const input = (key, name) => {
    const port = node(key).inputs.get(name);
    if (!port) {
      const names = [...node(key).inputs.keys()].join(', ') || 'none';
      throw new Error(`${where}: node "${key}" has no input "${name}" (it has: ${names})`);
    }
    return port;
  };

  // The start node re-exports one node's input tuple as the group's own
  // parameter, and an edge from it carries that tuple, unchanged, to every
  // input it fans out to.
  const startPort = group.start ? input(group.start.node, group.start.input) : null;

  const edges = group.edges.map((edge, index) => {
    const id = `urn:ui-temp:edge-${index + 1}`;
    const sourceNodeId = edge.from === 'start' ? 'urn:__START__' : node(edge.from).id;
    const targetNodeId = edge.to === 'end' ? 'urn:__END__' : node(edge.to).id;

    // From the start with no input named: ordering only, for a group whose
    // first node takes no parameter from the caller.
    if (edge.from === 'start' && !edge.input) {
      return { id, sourceNodeId, targetNodeId, dataFlowType: 'CONTROL_FLOW' };
    }
    const source = edge.from === 'start' ? startPort : node(edge.from).output;
    if (!source) throw new Error(`${where} has an edge from the start, but no "start" declaring what it carries`);

    if (edge.to === 'end') {
      // The end node takes the port it is handed as its own input.
      const rdf = edge.from !== 'start' && node(edge.from).rdf;
      return {
        id, sourceNodeId, targetNodeId,
        dataFlowType: rdf ? 'RDF_GRAPH' : 'VARIABLE_BINDINGS',
        sourceOutputId: source, targetInputId: source,
      };
    }
    const target = node(edge.to);
    if (target.graphIn) {
      return {
        id, sourceNodeId, targetNodeId,
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: source, targetInputId: target.graphIn,
      };
    }
    // What the edge does when its source hands it no rows, and which source
    // column fills which variable. Both are the author's, so both live on the
    // edge.
    const policy = {
      ...(edge.whenEmpty ? { whenEmpty: edge.whenEmpty } : {}),
      ...(edge.variableMappings ? { variableMappings: JSON.stringify(edge.variableMappings) } : {}),
    };
    // A column of graph IRIs that becomes the target's dataset, in place of
    // FROM and FROM NAMED. It fills no input port.
    if (edge.dataset) {
      return {
        id, sourceNodeId, targetNodeId,
        dataFlowType: 'DATASET',
        sourceOutputId: source,
        datasetPart: edge.dataset,
        ...policy,
      };
    }
    if (!edge.input) throw new Error(`${where}: the edge into "${edge.to}" names no input`);
    return {
      id, sourceNodeId, targetNodeId,
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: source, targetInputId: input(edge.to, edge.input),
      ...policy,
    };
  });

  return {
    queryGroupVersion: {},
    ...(startPort ? { startNode: { outputs: [startPort] } } : {}),
    endNode: { mediaType: group.end?.mediaType ?? 'application/sparql-results+json' },
    ...(rdfOutputs.length ? { rdfOutputs } : {}),
    executionNodes,
    edges,
  };
}

// 9. Argument sets — one call's worth of input, which the tests below pin.
const argumentSetVersions = new Map();
for (const set of manifest.argumentSets ?? []) {
  actAs(set.author);
  const { key, name, description, targetId, scope, ...bindings } = set;
  const created = await call('POST', '/argument-sets', {
    name,
    description,
    libraryId,
    targetId,
    scope,
    ...bindings,
  });
  minted.set(key, created.id);
  const version = await createVersion('argument-sets', created.id, bindings);
  argumentSetVersions.set(key, version.id);
  tally('argument set');
}

// 9a. The argument set the web application selects when a query or a group
//     opens. Execution never applies it; see sqlib's docs/concepts.md.
for (const [collection, entities] of [['queries', manifest.queries ?? []], ['query-groups', manifest.queryGroups ?? []]]) {
  for (const entity of entities) {
    actAs(entity.author);
    if (!entity.browserDefaultArgumentSet) continue;
    await call('PUT', `/${collection}/${encodeURIComponent(entity.id)}/browser-defaults`, {
      argumentSet: resolve(entity.browserDefaultArgumentSet),
      dataGraphs: (entity.browserDefaultDataGraphs ?? []).map(resolve),
    });
    tally('browser default argument set');
  }
}

// 10. Tests. A case names *versions* — an argument set version and a data graph
//    version — because a test that floated would change verdict when something
//    under it was edited.
const testIds = [];
for (const test of manifest.tests ?? []) {
  actAs(test.author);
  // A query or query group subject is named by its own stable id; a rule set
  // subject by the key, because its id was minted a moment ago.
  const subject = ['query', 'queryGroup'].includes(test.subjectKind) ? test.subject : resolve(test.subject);
  const created = await call('POST', '/tests', {
    name: test.name,
    description: describe(test),
    subject,
    subjectKind: test.subjectKind,
    isPartOf: [libraryId],
    ...(test.tags ? { tags: test.tags } : {}),
  });
  await call('POST', `/tests/${encodeURIComponent(created.id)}/versions`, {
    expectationKind: test.expectationKind,
    comment: test.comment,
    // A query test either names a backend or gives every case a data graph.
    ...(test.backend ? { backend: test.backend } : {}),
    cases: test.cases.map(testCase => ({
      name: testCase.name,
      ...(testCase.argumentSet
        ? { argumentSetVersion: argumentSetVersions.get(testCase.argumentSet) }
        : {}),
      ...(testCase.dataGraph
        ? { dataGraphVersion: dataGraphVersions.get(testCase.dataGraph) }
        : {}),
      expected: text(testCase.expectedFile),
      expectedFormat: testCase.expectedFormat,
      ...(testCase.ordered === undefined ? {} : { ordered: testCase.ordered }),
    })),
  });
  testIds.push(created.id);
  tally('test');
}

// 11. Benchmarks, and one run of each.
//
//     A benchmark run records what it measured, so a read-only deployment
//     refuses one: sqlib's read-only allowlist does not name the run route. The
//     image would otherwise carry plans that nobody can ever see a result for.
//     So each is run here, while writes are open, and the runs and their
//     observations are serialised with everything else. The timings are the
//     build machine's, taken once, and that is what the descriptions say.
//
//     A version must be frozen to run, and freezing is its own call. The
//     runner reads `subjectSpecs`: each a version to time, the argument sets to
//     time it with, and for a query the backends to time it against.
const NO_ARGUMENTS = 'https://sparql-query-lib/NoArguments';

/*
 * A benchmark experiment belongs to a library from sqlib b99f12a, which
 * requires `isPartOf`; before it, the create schema is strict and refuses the
 * field. The main instance pins a revision on one side of that and may move to
 * the other, so this sends the library and, on the older schema's refusal,
 * sends the experiment without it.
 */
async function createBenchmark(body) {
  try {
    return await call('POST', '/benchmark-experiments', { ...body, isPartOf: libraryId });
  } catch (error) {
    if (!/ -> 400 .*(isPartOf|additional)/i.test(error.message)) throw error;
    return call('POST', '/benchmark-experiments', body);
  }
}
for (const benchmark of manifest.benchmarks ?? []) {
  actAs(benchmark.author);
  await createBenchmark({
    id: benchmark.id,
    name: benchmark.name,
    description: describe(benchmark),
  });
  const subjectSpecs = [];
  for (const subject of benchmark.subjects) {
    const inputs = [
      // sqlib's `BENCHMARK_NO_ARGUMENTS_IRI`: the call with nothing bound,
      // timed beside the argument sets named after it.
      ...(subject.includeNoArguments ? [NO_ARGUMENTS] : []),
      ...(subject.argumentSets ?? []).map(resolve),
    ];
    if (subject.query) {
      const version = queryVersions.get(subject.query);
      if (!version) throw new Error(`the benchmark "${benchmark.name}" times ${subject.query}, which the manifest does not create`);
      subjectSpecs.push({ subject: version.queryVersion.id, inputs, backends: subject.backends });
    } else if (subject.group) {
      const { currentVersion } = await call('GET', `/query-groups/${encodeURIComponent(subject.group)}`);
      subjectSpecs.push({ subject: currentVersion, inputs });
    } else if (subject.ruleSet) {
      subjectSpecs.push({
        subject: ruleSetVersions.get(subject.ruleSet) ?? resolve(subject.ruleSet),
        inputs,
        dataGraphs: (subject.dataGraphs ?? []).map(resolve),
      });
    } else {
      throw new Error(`the benchmark "${benchmark.name}" has a subject naming no query, group or rule set`);
    }
  }
  const version = await createVersion('benchmark-experiments', benchmark.id, {
    subjectSpecs,
    repeats: benchmark.repeats,
    warmupRuns: benchmark.warmupRuns,
  });
  const at = `/benchmark-experiments/${encodeURIComponent(benchmark.id)}/${versionRoute.get('benchmark-experiments')}/${version.version}`;
  await call('POST', `${at}/freeze`);
  const result = await call('POST', `${at}/run`);
  const failed = result.observations.filter(observation => !observation.success);
  if (result.run.runStatus !== 'Completed' || failed.length > 0) {
    throw new Error(
      `the benchmark "${benchmark.name}" ran ${result.run.runStatus} with ${failed.length} failed observation(s)`
      + (failed[0]?.errorMessage ? `: ${failed[0].errorMessage}` : ''),
    );
  }
  console.log(`ran the benchmark "${benchmark.name}": ${result.observations.length} observations`);
  tally('benchmark');
}

// 12. ETL jobs. The column mapping is posted against the version and becomes
//     that version's current one, so it is a third call rather than a field.
//     An ETL job takes no tags: `POST /etl-jobs` accepts a name, a description
//     and a library and refuses anything else.
const etlJobIds = [];
for (const job of manifest.etlJobs ?? []) {
  actAs(job.author);
  const created = await call('POST', '/etl-jobs', {
    name: job.name,
    description: job.description,
    libraryId,
  });
  if (job.key) minted.set(job.key, created.id);
  const version = await call('POST', `/etl-jobs/${encodeURIComponent(created.id)}/versions`, {
    sql: expand(job.sql),
    sparqlTemplate: job.sparqlTemplate,
    backendId: job.backendId,
    chunkSize: job.chunkSize,
  });
  await call('POST', `/etl-jobs/versions/${encodeURIComponent(version.id)}/column-mappings`, job.columnMapping);
  etlJobIds.push(created.id);
  tally('ETL job');
}

// 13. Notebooks: prose and runs, in the order a reader takes them. The file is
//     a `.sqlibnb` document; `{{key}}` in it names an entity minted above.
//     The server mints a notebook's id, so a notebook is named by `key`.
for (const notebook of manifest.notebooks ?? []) {
  actAs(notebook.author);
  const content = expand(text(notebook.file));
  const parsed = JSON.parse(content);
  const created = await call('POST', '/notebooks', {
    name: notebook.name ?? parsed.title,
    description: describe(notebook),
    isPartOf: [libraryId],
    ...(notebook.tags ? { tags: notebook.tags } : {}),
  });
  if (notebook.key) minted.set(notebook.key, created.id);
  await call('POST', `/notebooks/${encodeURIComponent(created.id)}/versions`, {
    contentString: JSON.stringify({ ...parsed, library: libraryId }, null, 2),
    comment: notebook.comment ?? null,
  });
  tally('notebook');
}

// 14. Environments: named version pointers. Each starts from the current
//     versions and then points some entities at an older one, so the board has
//     something to compare.
for (const environment of manifest.environments ?? []) {
  actAs(environment.author);
  await call('POST', '/environments', {
    id: environment.id,
    name: environment.name,
    description: describe(environment),
    isPartOf: libraryId,
    position: environment.position,
    ...(environment.defaultBackend ? { defaultBackend: environment.defaultBackend } : {}),
    startFrom: environment.startFrom ?? 'latest',
  });
  for (const pointer of environment.pointers ?? []) {
    const collection = pointer.queryGroup ? 'query-groups' : 'queries';
    const entity = pointer.queryGroup ?? pointer.query;
    let version = null;
    if (pointer.version !== null) {
      const versions = await call('GET', `/${collection}/${encodeURIComponent(entity)}/versions`);
      const found = versions.find(candidate => candidate.version === pointer.version);
      if (!found) throw new Error(`the environment "${environment.name}" points ${entity} at version ${pointer.version}, which does not exist`);
      version = found.id;
    }
    await call('PUT', `/environments/${encodeURIComponent(environment.id)}/pointers`, { entity, version });
  }
  tally('environment');
}

// 15. One recorded run of each test and ETL job, after everything they read
//     exists. sqlib in demo mode shows a visitor the latest recorded run, and a
//     read-only deployment records none, so these are the runs the visitor
//     sees. A test with a known gap fails here, and its run shows that.
actAs();
if (testIds.length > 0) {
  const run = await call('POST', '/tests/run', { tests: testIds });
  console.log(`recorded test runs in ${libraryId}: ${run.passed}/${run.requested} passed`);
}
for (const id of etlJobIds) {
  await call('POST', `/etl-jobs/${encodeURIComponent(id)}/execute`, {});
}
if (etlJobIds.length > 0) console.log(`recorded ${etlJobIds.length} ETL run(s) in ${libraryId}`);

const summary = [...counts.values()]
  .map(({ one, many, count }) => `${count} ${count === 1 ? one : many}`)
  .join(', ');
console.log(`seeded ${libraryId}: ${summary}`);
