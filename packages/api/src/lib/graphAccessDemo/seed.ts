/**
 * A library that shows backend graph policies at work: one backend of company
 * data split into three named graphs, an auth backend that says which group
 * may read which graph, and the policy query that joins the two.
 *
 * Sign in as different people and run the same saved query: each sees only
 * the graphs their groups are given. `Test as` on the Access screen answers
 * the same question without signing in. `just demo-graph-access` is what asks
 * for this, with Rauthy in front issuing the tokens and the groups.
 *
 * Both backends are in-process Oxigraph in `ephemeral` mode, hydrated from
 * data graphs, so a restart puts them back. Idempotent like the patch demo:
 * every id is minted from a stable slug and every step skips what is there.
 */

import { getAuthConfig } from '../../auth/config.js';
import { getAuthStore, type GrantResourceKind } from '../../auth/AuthStore.js';
import { principalIri } from '../../auth/principals.js';
import { PRINCIPAL_AUTHENTICATED } from '../../auth/types.js';
import { BackendTypeIri, type PersistedBackend } from '../../persistence/schemas/BackendSchema.js';
import type { PersistedDataGraph } from '../../persistence/schemas/DataGraphSchema.js';
import type { PersistedLibrary } from '../../persistence/schemas/LibrarySchema.js';
import type { PersistedQuery } from '../../persistence/schemas/QuerySchema.js';
import { QueryTypeIri } from '../../constants/queryTypes.js';
import { getEntityRepositories } from '../CacheCoordinatorProvider.js';
import { createDataGraphVersion } from '../DataGraphVersionWriter.js';
import { mintId } from '../id.js';
import { createQueryVersionFlat } from '../QueryVersionWriter.js';

export const GRAPH_ACCESS_DEMO_LIBRARY_ID = mintId('library', 'graph-access-demo');
/**
 * The data graphs the two backends are hydrated from. A data graph is readable
 * by anyone who may read its library, so they live in a library with no grants:
 * administrators only. Otherwise the finance graph would be one click away in
 * the Data graphs screen, whatever the policy says.
 */
export const GRAPH_ACCESS_DEMO_DATA_LIBRARY_ID = mintId('library', 'graph-access-demo-data');
export const GRAPH_ACCESS_DEMO_DATA_BACKEND_ID = mintId('backend', 'graph-access-demo-data');
export const GRAPH_ACCESS_DEMO_AUTH_BACKEND_ID = mintId('backend', 'graph-access-demo-rules');

const EX = 'https://example.org/';
export const DEMO_GRAPHS = {
  public: `${EX}graph/public`,
  finance: `${EX}graph/finance`,
  hr: `${EX}graph/hr`,
} as const;

/** The groups the demo users carry. Rauthy issues them in the `groups` claim. */
export const DEMO_GROUPS = ['analysts', 'hr'] as const;

/** Used when auth is off, so the rules still name stable group principals. */
const FALLBACK_ISSUER = 'http://localhost:8080/auth/v1/';

const POLICY_QUERY = `PREFIX acl: <${EX}acl#>

# Which graphs of "Company data" the caller may read.
# Everyone signed in reads the public graph; a group reads what a rule gives it.
SELECT DISTINCT ?graph WHERE {
  { ?rule acl:everyone true ; acl:graph ?graph . }
  UNION
  { VALUES ?authGroup { UNDEF } ?rule acl:group ?authGroup ; acl:graph ?graph . }
}`;

const QUERIES = [
  {
    slug: 'policy',
    name: 'Readable graphs (graph policy)',
    description: 'The graph policy of "Company data". It runs on the access rules backend, once per caller. '
      + 'Kept with the data, for administrators only.',
    backend: GRAPH_ACCESS_DEMO_AUTH_BACKEND_ID,
    library: GRAPH_ACCESS_DEMO_DATA_LIBRARY_ID,
    queryString: POLICY_QUERY,
  },
  {
    slug: 'everything',
    name: 'Everything I can see',
    description: 'Every triple in every named graph. Sign in as different people and compare.',
    backend: GRAPH_ACCESS_DEMO_DATA_BACKEND_ID,
    library: GRAPH_ACCESS_DEMO_LIBRARY_ID,
    queryString: `SELECT ?graph ?s ?p ?o WHERE { GRAPH ?graph { ?s ?p ?o } } ORDER BY ?graph ?s ?p`,
  },
  {
    slug: 'salaries',
    name: 'Salaries',
    description: 'Reads the finance graph by name. Without the analysts group it returns no rows.',
    backend: GRAPH_ACCESS_DEMO_DATA_BACKEND_ID,
    library: GRAPH_ACCESS_DEMO_LIBRARY_ID,
    queryString: `PREFIX ex: <${EX}>
SELECT ?person ?salary WHERE { GRAPH <${DEMO_GRAPHS.finance}> { ?person ex:salary ?salary } } ORDER BY ?person`,
  },
] as const;

const COMPANY_GRAPHS = [
  {
    slug: 'public',
    name: 'Graph access demo — public',
    graph: DEMO_GRAPHS.public,
    turtle: `@prefix ex: <${EX}> .
ex:widget ex:name "Widget" ; ex:price 10 .
ex:gadget ex:name "Gadget" ; ex:price 25 .`,
  },
  {
    slug: 'finance',
    name: 'Graph access demo — finance',
    graph: DEMO_GRAPHS.finance,
    turtle: `@prefix ex: <${EX}> .
ex:alice ex:salary 120000 .
ex:bob ex:salary 95000 .`,
  },
  {
    slug: 'hr',
    name: 'Graph access demo — hr',
    graph: DEMO_GRAPHS.hr,
    turtle: `@prefix ex: <${EX}> .
ex:bob ex:review "Exceeds expectations" .
ex:carol ex:review "New starter" .`,
  },
] as const;

export interface GraphAccessDemoSeedResult {
  libraryId: string;
  issuer: string;
  queriesCreated: number;
  grantsCreated: number;
}

function repos() {
  return getEntityRepositories();
}

/** The issuer the group principals are minted against: the first configured one. */
function demoIssuer(): string {
  return getAuthConfig().issuers[0]?.issuer ?? FALLBACK_ISSUER;
}

export function accessRulesTurtle(issuer: string): string {
  const group = (name: string) => `<${principalIri('group', issuer, name)}>`;
  return `@prefix acl: <${EX}acl#> .
# One rule per line: who, and which graph of "Company data" they may read.
[] acl:everyone true ; acl:graph <${DEMO_GRAPHS.public}> .
[] acl:group ${group('analysts')} ; acl:graph <${DEMO_GRAPHS.finance}> .
[] acl:group ${group('hr')} ; acl:graph <${DEMO_GRAPHS.hr}> .
[] acl:group ${group('hr')} ; acl:graph <${DEMO_GRAPHS.finance}> .`;
}

export async function seedGraphAccessDemo(log: (message: string) => void = () => {}): Promise<GraphAccessDemoSeedResult> {
  const issuer = demoIssuer();
  const result: GraphAccessDemoSeedResult = {
    libraryId: GRAPH_ACCESS_DEMO_LIBRARY_ID,
    issuer,
    queriesCreated: 0,
    grantsCreated: 0,
  };

  await ensureLibraries();

  const rulesGraphId = mintId('dataGraph', 'graph-access-demo-rules');
  await ensureDataGraph(rulesGraphId, 'Graph access demo — access rules', accessRulesTurtle(issuer));
  await ensureBackend(GRAPH_ACCESS_DEMO_AUTH_BACKEND_ID, {
    name: 'Access rules (auth backend)',
    description: 'Who may read which graph of "Company data". Only administrators can query it.',
    authBackend: true,
    sources: [{ dataGraphId: rulesGraphId }],
  });

  const sources = [];
  for (const graph of COMPANY_GRAPHS) {
    const id = mintId('dataGraph', `graph-access-demo-${graph.slug}`);
    await ensureDataGraph(id, graph.name, graph.turtle);
    sources.push({ dataGraphId: id, namedGraph: graph.graph });
  }
  await ensureBackend(GRAPH_ACCESS_DEMO_DATA_BACKEND_ID, {
    name: 'Company data',
    description: 'Three named graphs: public, finance and hr. Its graph policy decides who reads which.',
    sources,
  });

  for (const query of QUERIES) {
    if (await ensureQuery(query.slug, query.name, query.description, query.backend, query.library, query.queryString)) {
      result.queriesCreated += 1;
    }
  }

  // The policy pins the policy query's current version, as the Access screen does.
  const policyVersion = (repos().Query.get(queryIdFor('policy')) as PersistedQuery | null)?.currentVersion;
  const data = repos().Backend.get(GRAPH_ACCESS_DEMO_DATA_BACKEND_ID) as PersistedBackend | null;
  if (policyVersion && data && !data.graphPolicyQueryVersion) {
    await repos().Backend.update(GRAPH_ACCESS_DEMO_DATA_BACKEND_ID, {
      graphPolicyQueryVersion: policyVersion,
      graphPolicyBackend: GRAPH_ACCESS_DEMO_AUTH_BACKEND_ID,
    });
  }

  result.grantsCreated = await ensureGrants(issuer);

  log(
    `Graph access demo: ${result.queriesCreated} queries and ${result.grantsCreated} grants created, `
    + `group principals minted for issuer ${issuer}`,
  );
  return result;
}

async function ensureLibraries(): Promise<void> {
  if (!repos().Library.get(GRAPH_ACCESS_DEMO_LIBRARY_ID)) {
    await repos().Library.create({
      $id: GRAPH_ACCESS_DEMO_LIBRARY_ID,
      name: 'Graph access demo',
      description: 'One backend, three graphs, and a graph policy that decides who reads which. '
        + 'Sign in as alice (analysts), bob (hr) or carol (no group) and run "Everything I can see".',
    } as Partial<PersistedLibrary> & { $id: string });
  }
  if (!repos().Library.get(GRAPH_ACCESS_DEMO_DATA_LIBRARY_ID)) {
    await repos().Library.create({
      $id: GRAPH_ACCESS_DEMO_DATA_LIBRARY_ID,
      name: 'Graph access demo — data (administrators)',
      description: 'The data graphs behind "Company data", the access rules and the graph policy. '
        + 'No grants, so only administrators can read them: a data graph is as private as its library.',
    } as Partial<PersistedLibrary> & { $id: string });
  }
}

async function ensureDataGraph(id: string, name: string, content: string): Promise<void> {
  let graph = repos().DataGraph.get(id) as PersistedDataGraph | null;
  if (!graph) {
    graph = await repos().DataGraph.create({
      $id: id,
      name,
      isPartOf: [GRAPH_ACCESS_DEMO_DATA_LIBRARY_ID],
    } as Partial<PersistedDataGraph> & { $id: string });
  }
  if (!graph.currentVersion) {
    await createDataGraphVersion(id, { contentString: content, contentFormat: 'text/turtle' });
  }
}

async function ensureBackend(
  id: string,
  spec: { name: string; description: string; authBackend?: boolean; sources: Array<{ dataGraphId: string; namedGraph?: string }> },
): Promise<void> {
  // A JSON string, not an object: see the patch demo's `ensureBackend`.
  const oxigraphConfig = JSON.stringify({ storeType: 'ephemeral', mode: 'ephemeral', sources: spec.sources });
  if (repos().Backend.get(id)) return;
  await repos().Backend.create({
    $id: id,
    name: spec.name,
    description: spec.description,
    backendType: BackendTypeIri.oxigraphMemory,
    oxigraphConfig,
    ...(spec.authBackend ? { authBackend: true } : {}),
  } as Partial<PersistedBackend> & { $id: string });
}

const queryIdFor = (slug: string) => mintId('query', `graph-access-demo-${slug}`);

async function ensureQuery(
  slug: string,
  name: string,
  description: string,
  backend: string,
  library: string,
  queryString: string,
): Promise<boolean> {
  const id = queryIdFor(slug);
  let query = repos().Query.get(id) as PersistedQuery | null;
  if (!query) {
    query = await repos().Query.create({
      $id: id,
      name,
      description,
      defaultBackend: backend,
      isPartOf: [library],
    } as Partial<PersistedQuery> & { $id: string });
  }
  if (query.currentVersion) return false;
  await createQueryVersionFlat(id, { queryString, queryType: QueryTypeIri.select });
  return true;
}

/**
 * Grants for the demo: everyone signed in may open the library and run its
 * saved queries on "Company data"; analysts may also write their own queries
 * there. The groups are recorded as principals so the Access screen lists them
 * before anyone in them signs in.
 */
async function ensureGrants(issuer: string): Promise<number> {
  const store = getAuthStore();
  const analysts = principalIri('group', issuer, 'analysts');
  const wanted: Array<{ principal: string; resourceKind: GrantResourceKind; resource: string; modes: string[] }> = [
    { principal: PRINCIPAL_AUTHENTICATED, resourceKind: 'library', resource: GRAPH_ACCESS_DEMO_LIBRARY_ID, modes: ['read', 'execute'] },
    { principal: PRINCIPAL_AUTHENTICATED, resourceKind: 'backend', resource: GRAPH_ACCESS_DEMO_DATA_BACKEND_ID, modes: ['query:saved'] },
    { principal: analysts, resourceKind: 'backend', resource: GRAPH_ACCESS_DEMO_DATA_BACKEND_ID, modes: ['query:adhoc'] },
  ];

  for (const group of DEMO_GROUPS) {
    await store.recordPrincipal(principalIri('group', issuer, group), group, 'group');
  }

  let created = 0;
  for (const grant of wanted) {
    if (store.listGrants({ principal: grant.principal }).some((g) => g.resource === grant.resource)) continue;
    await store.createGrant({ ...grant, grantedBy: 'urn:sqlib:seed:graph-access-demo' });
    created += 1;
  }
  return created;
}
