/**
 * A library you can press Run in to see what `text/rdf-patch` actually does.
 *
 * Issue #290 gave update queries an output — the ground diff they would make —
 * and the only way to satisfy yourself that it works is to point one at a store
 * whose contents you already know and read the patch. That needs a dataset, a
 * writable backend and a spread of updates that between them exercise the
 * behaviour worth checking. Seeding those is cheaper than asking every reviewer
 * to type them, and pinning them here means two people demonstrating the
 * feature demonstrate the same thing.
 *
 * The backend is an in-process Oxigraph store in `ephemeral` mode: writable, so
 * apply and revert are real, and never serialised, so a restart puts the
 * catalogue back exactly as it was. That is what makes this safe to poke at —
 * "undo" is `just run-local-patch-demo` again.
 *
 * Idempotent by construction, like the W3C suite seeder beside it: every id is
 * minted from a stable slug and every step skips what is already complete, so
 * re-running against a persistent library store writes nothing.
 */

import { BackendTypeIri, type LdkitBackend } from '../../persistence/schemas/BackendSchema.js';
import type { LdkitDataGraph } from '../../persistence/schemas/DataGraphSchema.js';
import type { LdkitLibrary } from '../../persistence/schemas/LibrarySchema.js';
import type { LdkitQuery } from '../../persistence/schemas/QuerySchema.js';
import { QueryTypeIri } from '../../constants/queryTypes.js';
import { getEntityRepositories } from '../CacheCoordinatorProvider.js';
import { createDataGraphVersion } from '../DataGraphVersionWriter.js';
import { mintId } from '../id.js';
import { createQueryVersionFlat } from '../QueryVersionWriter.js';
import { PATCH_DEMO_ARCHIVE, PATCH_DEMO_ARCHIVE_GRAPH, PATCH_DEMO_CATALOGUE } from './data.js';
import { PATCH_DEMO_QUERIES } from './queries.js';

export const PATCH_DEMO_LIBRARY_ID = mintId('library', 'rdf-patch-demo');
export const PATCH_DEMO_BACKEND_ID = mintId('backend', 'rdf-patch-demo');

const CATALOGUE_GRAPH_ID = mintId('dataGraph', 'rdf-patch-demo-catalogue');
const ARCHIVE_GRAPH_ID = mintId('dataGraph', 'rdf-patch-demo-archive');

const LIBRARY_NAME = 'RDF Patch demo';
const LIBRARY_DESCRIPTION =
  'Update queries whose output is the patch they would make (#290), against a small catalogue you '
  + 'can hold in your head. The backend is writable and thrown away on restart, so apply and revert '
  + 'are real and nothing you do here is permanent.';

const BACKEND_NAME = 'Patch demo catalogue (in memory, writable)';
const BACKEND_DESCRIPTION =
  'In-process Oxigraph, hydrated from the demo data graphs and never serialised. Writable, so '
  + 'applying a patch really changes it; ephemeral, so a restart puts it back. In process is also '
  + 'what makes exact membership and multi-operation forking available — an HTTP backend would '
  + 'refuse query 8.';

export interface PatchDemoSeedResult {
  libraryId: string;
  backendId: string;
  /** Queries written by this call. Zero on a re-run, which is the point. */
  queriesCreated: number;
  /** Queries that were already there and were left alone. */
  queriesExisting: number;
}

function repos() {
  return getEntityRepositories();
}

const queryIdFor = (slug: string) => mintId('query', `rdf-patch-demo-${slug}`);

export async function seedPatchDemo(log: (message: string) => void = () => {}): Promise<PatchDemoSeedResult> {
  const result: PatchDemoSeedResult = {
    libraryId: PATCH_DEMO_LIBRARY_ID,
    backendId: PATCH_DEMO_BACKEND_ID,
    queriesCreated: 0,
    queriesExisting: 0,
  };

  await ensureLibrary();
  await ensureDataGraph(CATALOGUE_GRAPH_ID, 'Patch demo — catalogue', PATCH_DEMO_CATALOGUE);
  await ensureDataGraph(ARCHIVE_GRAPH_ID, 'Patch demo — archive graph', PATCH_DEMO_ARCHIVE);
  await ensureBackend();

  for (const demo of PATCH_DEMO_QUERIES) {
    if (await ensureQuery(demo.slug, demo.name, demo.description, demo.updateString)) {
      result.queriesCreated += 1;
    } else {
      result.queriesExisting += 1;
    }
  }

  log(
    `RDF Patch demo: ${result.queriesCreated} update quer${result.queriesCreated === 1 ? 'y' : 'ies'} created, `
    + `${result.queriesExisting} already present`,
  );
  return result;
}

async function ensureLibrary(): Promise<void> {
  if (repos().Library.get(PATCH_DEMO_LIBRARY_ID)) return;
  await repos().Library.create({
    $id: PATCH_DEMO_LIBRARY_ID,
    name: LIBRARY_NAME,
    description: LIBRARY_DESCRIPTION,
  } as Partial<LdkitLibrary> & { $id: string });
}

async function ensureDataGraph(id: string, name: string, content: string): Promise<void> {
  let graph = repos().DataGraph.get(id) as LdkitDataGraph | null;
  if (!graph) {
    graph = await repos().DataGraph.create({
      $id: id,
      name,
      isPartOf: [PATCH_DEMO_LIBRARY_ID],
    } as Partial<LdkitDataGraph> & { $id: string });
  }
  if (!graph.currentVersion) {
    await createDataGraphVersion(id, { contentString: content, contentFormat: 'text/turtle' });
  }
  if (!(repos().DataGraph.get(id) as LdkitDataGraph | null)?.currentVersion) {
    throw new Error(`DataGraph ${id} has no current version after seeding`);
  }
}

/**
 * The store the previews are derived against.
 *
 * `mode: 'ephemeral'` is the whole design: `readOnly` would make apply
 * meaningless and `durable` would make the demo a thing you have to clean up.
 * The graphs are tracked rather than pinned, so editing the catalogue in the
 * Data graphs screen re-hydrates the store and the next preview reflects it —
 * which is itself worth demonstrating.
 */
async function ensureBackend(): Promise<void> {
  // A JSON string, not an object: the property is not declared `rdf:JSON`, so
  // an object reaches the store as `"[object Object]"` and comes back as a
  // config with no sources at all. See `LdkitBackend.oxigraphConfig`.
  const oxigraphConfig = JSON.stringify({
    storeType: 'ephemeral',
    mode: 'ephemeral',
    sources: [
      { dataGraphId: CATALOGUE_GRAPH_ID },
      { dataGraphId: ARCHIVE_GRAPH_ID, namedGraph: PATCH_DEMO_ARCHIVE_GRAPH },
    ],
  });

  const existing = repos().Backend.get(PATCH_DEMO_BACKEND_ID) as LdkitBackend | null;
  if (existing) {
    // Repairs a store seeded by an earlier build rather than assuming the
    // config on disk is the one this version writes.
    if (existing.oxigraphConfig !== oxigraphConfig) {
      await repos().Backend.update(PATCH_DEMO_BACKEND_ID, { oxigraphConfig });
    }
    return;
  }

  await repos().Backend.create({
    $id: PATCH_DEMO_BACKEND_ID,
    name: BACKEND_NAME,
    description: BACKEND_DESCRIPTION,
    backendType: BackendTypeIri.oxigraphMemory,
    oxigraphConfig,
  } as Partial<LdkitBackend> & { $id: string });
}

/**
 * One demo query, pointed at the demo backend.
 *
 * `defaultBackend` is what makes the demo a two-click affair: the editor loads
 * a query with its backend already selected, so Run derives against the
 * catalogue without anyone first working out which of the backends in the list
 * is the right one.
 *
 * @returns whether it was created, as against already being there.
 */
async function ensureQuery(
  slug: string,
  name: string,
  description: string,
  queryString: string,
): Promise<boolean> {
  const id = queryIdFor(slug);
  let query = repos().Query.get(id) as LdkitQuery | null;
  if (!query) {
    query = await repos().Query.create({
      $id: id,
      name,
      description,
      defaultBackend: PATCH_DEMO_BACKEND_ID,
      isPartOf: [PATCH_DEMO_LIBRARY_ID],
    } as Partial<LdkitQuery> & { $id: string });
  }
  if (query.currentVersion) return false;

  await createQueryVersionFlat(id, {
    queryString,
    // Every update form detects as `update` — see `queryTypeDetector` — so
    // seeding anything else would leave the stored type disagreeing with what
    // the editor computes the moment somebody touches the text.
    queryType: QueryTypeIri.update,
    outputs: [],
    inputs: [],
  });
  return true;
}
