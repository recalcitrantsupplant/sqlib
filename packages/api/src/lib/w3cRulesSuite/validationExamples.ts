/**
 * Runnable query-group validation patterns shipped beside the W3C SRL suite.
 *
 * SHACL is read as ordinary RDF: a SPARQL query pulls the constraints out of a
 * shapes graph, and those bindings parameterise a second query over the data.
 * Validation is query chaining, not a new kind of node.
 *
 * Shapes and data stay *separate inputs* throughout — never merged into one
 * graph — which is how the SHACL spec defines validation and what keeps the
 * shapes out of the data being checked. Two groups show the two ways to supply
 * them, because which one you want depends on where the graphs live:
 *
 * - {@link GROUP_ID} (`…-minimal`): shapes are a **backend**, data is passed in
 *   through the StartNode. Right when the shapes are the stable, shared thing
 *   and the data varies — validating many datasets against one published
 *   profile — and the only shape a Test can drive today (see below).
 * - {@link EPHEMERAL_GROUP_ID} (`…-ephemeral`): **both** graphs are passed in
 *   through the StartNode, each into its own ephemeral store, so the group
 *   needs no backend configured at all. Right for ad-hoc "check this data
 *   against these shapes", which is the common case.
 *
 * A `TestCase` holds a single `dataGraphVersion`, so it cannot fill the
 * two-input group's ports; that group is covered by an engine-level test
 * instead of a Test entity.
 */

import { BackendTypeIri, type LdkitBackend } from '../../persistence/schemas/BackendSchema.js';
import type { LdkitDataGraph } from '../../persistence/schemas/DataGraphSchema.js';
import type { LdkitLibrary } from '../../persistence/schemas/LibrarySchema.js';
import type { LdkitQuery } from '../../persistence/schemas/QuerySchema.js';
import type { LdkitQueryGroup } from '../../persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryGroupVersion } from '../../persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitQueryNode } from '../../persistence/schemas/QueryNodeSchema.js';
import type { LdkitQueryVersion } from '../../persistence/schemas/QueryVersionSchema.js';
import type { LdkitTest } from '../../persistence/schemas/TestSchema.js';
import { QueryTypeIri } from '../../constants/queryTypes.js';
import { getEntityRepositories } from '../CacheCoordinatorProvider.js';
import { createDataGraphVersion } from '../DataGraphVersionWriter.js';
import { createGroupVersionFlat } from '../GroupVersionWriter.js';
import { mintId } from '../id.js';
import { createQueryVersionFlat } from '../QueryVersionWriter.js';
import { createTestVersion } from '../TestVersionWriter.js';

export const SHACL_VALIDATION_EXAMPLES_LIBRARY_ID = mintId('library', 'shacl-validation-query-groups');

const SHAPES_GRAPH_ID = mintId('dataGraph', 'shacl-validation-shapes');
const DATA_GRAPH_ID = mintId('dataGraph', 'shacl-validation-data');
const SHAPES_BACKEND_ID = mintId('backend', 'shacl-validation-shapes');
const EXTRACT_QUERY_ID = mintId('query', 'shacl-validation-extract');
const CHECK_QUERY_ID = mintId('query', 'shacl-validation-check');
export const GROUP_ID = mintId('group', 'shacl-validation-minimal');
export const EPHEMERAL_GROUP_ID = mintId('group', 'shacl-validation-ephemeral');
const TEST_ID = mintId('test', 'shacl-validation-minimal');
const EPHEMERAL_TEST_ID = mintId('test', 'shacl-validation-ephemeral');
const DATA_INPUT_ID = 'urn:ui-temp:shacl-validation-data-input';
const SHAPES_INPUT_ID = 'urn:ui-temp:shacl-validation-shapes-input';

/**
 * Distinct stores per node, so the shapes never land in the graph being
 * checked. Sharing one store would let shape triples answer the checker's
 * patterns — the merge this design exists to avoid.
 */
const CHECK_STORE_ID = 'urn:sqlib:store:shacl-validation-data';
const EPHEMERAL_SHAPES_STORE_ID = 'urn:sqlib:store:shacl-validation-ephemeral-shapes';
const EPHEMERAL_CHECK_STORE_ID = 'urn:sqlib:store:shacl-validation-ephemeral-data';

export const SHACL_VALIDATION_SHAPES = `
@prefix ex: <https://example.com/validation#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:path ex:email ; sh:minCount 1 ] ;
  sh:property [ sh:path ex:age ; sh:datatype xsd:integer ] ;
  sh:property [ sh:path ex:address ; sh:node ex:AddressShape ] .

ex:AddressShape a sh:NodeShape ;
  sh:property [ sh:path ex:postcode ; sh:minCount 1 ] .
`;

export const SHACL_VALIDATION_DATA = `
@prefix ex: <https://example.com/validation#> .

ex:ada a ex:Person ;
  ex:email "ada@example.com" ;
  ex:age 42 ;
  ex:address [ ex:postcode "4000" ] .

ex:bert a ex:Person ;
  ex:age "unknown" ;
  ex:address ex:bertAddress .
`;

const EXTRACT_QUERY = `
PREFIX sh: <http://www.w3.org/ns/shacl#>

SELECT ?sourceShape ?targetClass ?depth ?path1 ?path2 ?constraintKind ?constraintValue
WHERE {
  {
    ?sourceShape a sh:NodeShape ;
      sh:targetClass ?targetClass ;
      sh:property ?propertyShape .
    ?propertyShape sh:path ?path1 .
    {
      ?propertyShape sh:minCount ?constraintValue .
      FILTER (?constraintValue = 1)
      BIND ("minCount" AS ?constraintKind)
    }
    UNION
    {
      ?propertyShape sh:datatype ?constraintValue .
      BIND ("datatype" AS ?constraintKind)
    }
    BIND (1 AS ?depth)
  }
  UNION
  {
    ?sourceShape a sh:NodeShape ;
      sh:targetClass ?targetClass ;
      sh:property ?outerPropertyShape .
    ?outerPropertyShape sh:path ?path1 ; sh:node ?nestedShape .
    ?nestedShape sh:property ?innerPropertyShape .
    ?innerPropertyShape sh:path ?path2 .
    {
      ?innerPropertyShape sh:minCount ?constraintValue .
      FILTER (?constraintValue = 1)
      BIND ("minCount" AS ?constraintKind)
    }
    UNION
    {
      ?innerPropertyShape sh:datatype ?constraintValue .
      BIND ("datatype" AS ?constraintKind)
    }
    BIND (2 AS ?depth)
  }
}
ORDER BY ?sourceShape ?path1 ?path2 ?constraintKind
`;

const CHECK_QUERY = `
SELECT ?focus ?sourceShape ?path1 ?path2 ?constraintKind ?message
WHERE {
  VALUES (?constraintKind ?constraintValue ?depth ?path1 ?path2 ?sourceShape ?targetClass) {
    (UNDEF UNDEF UNDEF UNDEF UNDEF UNDEF UNDEF)
  }
  ?focus a ?targetClass .
  OPTIONAL { ?focus ?path1 ?value1 }
  OPTIONAL {
    FILTER (?depth = 2)
    ?value1 ?path2 ?value2
  }
  FILTER (
    (?depth = 1 && ?constraintKind = "minCount" && !BOUND(?value1)) ||
    (?depth = 1 && ?constraintKind = "datatype" && BOUND(?value1) && DATATYPE(?value1) != ?constraintValue) ||
    (?depth = 2 && ?constraintKind = "minCount" && BOUND(?value1) && !BOUND(?value2)) ||
    (?depth = 2 && ?constraintKind = "datatype" && BOUND(?value2) && DATATYPE(?value2) != ?constraintValue)
  )
  BIND (
    IF(?constraintKind = "minCount", "Missing required value", "Value has wrong datatype")
    AS ?message
  )
}
ORDER BY ?focus ?path1 ?path2 ?constraintKind
`;

const EXPECTED = JSON.stringify({
  head: { vars: ['focus', 'sourceShape', 'path1', 'path2', 'constraintKind', 'message'] },
  results: {
    bindings: [
      {
        focus: { type: 'uri', value: 'https://example.com/validation#bert' },
        sourceShape: { type: 'uri', value: 'https://example.com/validation#PersonShape' },
        path1: { type: 'uri', value: 'https://example.com/validation#address' },
        path2: { type: 'uri', value: 'https://example.com/validation#postcode' },
        constraintKind: { type: 'literal', value: 'minCount' },
        message: { type: 'literal', value: 'Missing required value' },
      },
      {
        focus: { type: 'uri', value: 'https://example.com/validation#bert' },
        sourceShape: { type: 'uri', value: 'https://example.com/validation#PersonShape' },
        path1: { type: 'uri', value: 'https://example.com/validation#age' },
        constraintKind: { type: 'literal', value: 'datatype' },
        message: { type: 'literal', value: 'Value has wrong datatype' },
      },
      {
        focus: { type: 'uri', value: 'https://example.com/validation#bert' },
        sourceShape: { type: 'uri', value: 'https://example.com/validation#PersonShape' },
        path1: { type: 'uri', value: 'https://example.com/validation#email' },
        constraintKind: { type: 'literal', value: 'minCount' },
        message: { type: 'literal', value: 'Missing required value' },
      },
    ],
  },
});

// detectInputs canonicalizes VALUES variables alphabetically. Keep both tuple
// interfaces in that order so validation and positional transfer agree.
const EXTRACT_OUTPUTS = ['constraintKind', 'constraintValue', 'depth', 'path1', 'path2', 'sourceShape', 'targetClass'];
const CHECK_OUTPUTS = ['focus', 'sourceShape', 'path1', 'path2', 'constraintKind', 'message'];

function repos() {
  return getEntityRepositories();
}

export async function seedShaclValidationExamples(log: (message: string) => void = () => {}): Promise<void> {
  await ensureLibrary();
  const shapesGraphVersion = await ensureDataGraph(SHAPES_GRAPH_ID, 'SHACL shapes graph', SHACL_VALIDATION_SHAPES);
  const dataGraphVersion = await ensureDataGraph(DATA_GRAPH_ID, 'Validation instance data', SHACL_VALIDATION_DATA);
  await ensureBackend(SHAPES_BACKEND_ID, 'SHACL shapes (in memory)', SHAPES_GRAPH_ID);
  const extract = await ensureQuery(EXTRACT_QUERY_ID, 'Extract supported SHACL constraints', EXTRACT_QUERY, EXTRACT_OUTPUTS);
  const check = await ensureQuery(
    CHECK_QUERY_ID,
    'Check data from extracted SHACL constraints',
    CHECK_QUERY,
    CHECK_OUTPUTS,
    EXTRACT_OUTPUTS,
  );
  await ensureGroup(extract, check);
  await ensureEphemeralGroup(extract, check);
  await ensureTest(dataGraphVersion);
  await ensureEphemeralTest(shapesGraphVersion, dataGraphVersion);
  log('Created SHACL validation query-group examples');
}

/**
 * The same pipeline with no backend to configure: both graphs arrive through
 * the StartNode, each into its own ephemeral store.
 *
 * This is the shape most validation actually wants — "check this data against
 * these shapes" — where neither graph is a standing resource worth registering
 * as a backend. The backend-based group beside it stays the right answer when
 * the shapes *are* a standing resource (one published profile, many datasets)
 * or when the data is a whole triplestore you would never pass by value.
 *
 * Neither node names a backend, which is the point: since #297 an ephemeral
 * `backendConfig` is the node's backend, and naming one alongside it is now
 * rejected rather than merely pointless.
 */
async function ensureEphemeralGroup(extract: LdkitQueryVersion, check: LdkitQueryVersion): Promise<void> {
  let group = repos().QueryGroup.get(EPHEMERAL_GROUP_ID) as LdkitQueryGroup | null;
  if (!group) {
    group = await repos().QueryGroup.create({
      $id: EPHEMERAL_GROUP_ID,
      name: 'Validate a data graph against a shapes graph',
      description: 'Both graphs arrive through the StartNode, each into its own ephemeral store. No backend to configure.',
      isPartOf: SHACL_VALIDATION_EXAMPLES_LIBRARY_ID,
    } as Partial<LdkitQueryGroup> & { $id: string });
  }
  if (groupVersionIsUsable(EPHEMERAL_GROUP_ID, group.currentVersion)) return;

  const extractOutput = extract.inferredOutputs?.[0];
  const checkInput = check.inferredInputs?.[0];
  const checkOutput = check.inferredOutputs?.[0];
  if (!extractOutput || !checkInput || !checkOutput) {
    throw new Error('Validation example queries did not produce the expected tuple interfaces');
  }

  await createGroupVersionFlat(EPHEMERAL_GROUP_ID, {
    // Declaration order is the positional order a run supplies them in: shapes
    // first, then data.
    rdfOutputs: [
      { id: SHAPES_INPUT_ID, name: 'shapes graph' },
      { id: DATA_INPUT_ID, name: 'data graph' },
    ],
    startNode: { outputs: [SHAPES_INPUT_ID, DATA_INPUT_ID] },
    endNode: { mediaType: 'application/sparql-results+json' },
    executionNodes: [
      {
        id: 'urn:ui-temp:ephemeral-extract-node',
        nodeType: 'QueryNode',
        queryId: extract.$id,
        inputs: [SHAPES_INPUT_ID],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: EPHEMERAL_SHAPES_STORE_ID },
      },
      {
        id: 'urn:ui-temp:ephemeral-check-node',
        nodeType: 'QueryNode',
        queryId: check.$id,
        inputs: [checkInput, DATA_INPUT_ID],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: EPHEMERAL_CHECK_STORE_ID },
      },
    ],
    edges: [
      {
        id: 'urn:ui-temp:ephemeral-shapes-edge',
        sourceNodeId: 'urn:__START__',
        targetNodeId: 'urn:ui-temp:ephemeral-extract-node',
        sourceOutputId: SHAPES_INPUT_ID,
        targetInputId: SHAPES_INPUT_ID,
        dataFlowType: 'RDF_GRAPH',
      },
      {
        id: 'urn:ui-temp:ephemeral-data-edge',
        sourceNodeId: 'urn:__START__',
        targetNodeId: 'urn:ui-temp:ephemeral-check-node',
        sourceOutputId: DATA_INPUT_ID,
        targetInputId: DATA_INPUT_ID,
        dataFlowType: 'RDF_GRAPH',
      },
      {
        id: 'urn:ui-temp:ephemeral-bindings-edge',
        sourceNodeId: 'urn:ui-temp:ephemeral-extract-node',
        targetNodeId: 'urn:ui-temp:ephemeral-check-node',
        sourceOutputId: extractOutput,
        targetInputId: checkInput,
        dataFlowType: 'VARIABLE_BINDINGS',
        whenEmpty: 'require',
      },
      {
        id: 'urn:ui-temp:ephemeral-end-edge',
        sourceNodeId: 'urn:ui-temp:ephemeral-check-node',
        targetNodeId: 'urn:__END__',
        sourceOutputId: checkOutput,
        targetInputId: checkOutput,
        dataFlowType: 'VARIABLE_BINDINGS',
      },
    ],
  });
}

async function ensureLibrary(): Promise<void> {
  if (repos().Library.get(SHACL_VALIDATION_EXAMPLES_LIBRARY_ID)) return;
  await repos().Library.create({
    $id: SHACL_VALIDATION_EXAMPLES_LIBRARY_ID,
    name: 'SHACL validation query groups',
    description: 'Extract constraint bindings from a SHACL backend, then validate a DataGraph supplied through the Query Group StartNode.',
  } as Partial<LdkitLibrary> & { $id: string });
}

export async function ensureDataGraph(id: string, name: string, content: string): Promise<string> {
  let graph = repos().DataGraph.get(id) as LdkitDataGraph | null;
  if (!graph) {
    graph = await repos().DataGraph.create({
      $id: id,
      name,
      isPartOf: [SHACL_VALIDATION_EXAMPLES_LIBRARY_ID],
    } as Partial<LdkitDataGraph> & { $id: string });
  }
  if (!graph.currentVersion) {
    await createDataGraphVersion(id, { contentString: content, contentFormat: 'text/turtle', immutable: true });
  }
  const current = repos().DataGraph.get(id) as LdkitDataGraph | null;
  if (!current?.currentVersion) throw new Error(`DataGraph ${id} has no current version after seeding`);
  return current.currentVersion;
}

export async function ensureBackend(id: string, name: string, dataGraphId: string): Promise<void> {
  // Stored as the JSON string the triple store round-trips — see
  // `LdkitBackend.oxigraphConfig`. A seed written as an object survived in the
  // cache and came back from a restarted store as an empty config, so the
  // examples ran against a store with no data in it.
  const oxigraphConfig = JSON.stringify({
    storeType: 'ephemeral',
    mode: 'readOnly',
    sources: [{ dataGraphId }],
  });
  const existing = repos().Backend.get(id) as LdkitBackend | null;
  if (existing) {
    // Repairs a seed written by an earlier build, which is why this is not a
    // plain "already there, nothing to do".
    if (existing.oxigraphConfig !== oxigraphConfig) {
      await repos().Backend.update(id, { oxigraphConfig });
    }
    return;
  }
  await repos().Backend.create({
    $id: id,
    name,
    description: `Read-only in-memory backend hydrated from ${dataGraphId}`,
    backendType: BackendTypeIri.oxigraphMemory,
    oxigraphConfig,
  } as Partial<LdkitBackend> & { $id: string });
}

async function ensureQuery(
  id: string,
  name: string,
  queryString: string,
  outputNames: string[],
  inputNames: string[] = [],
): Promise<LdkitQueryVersion> {
  let query = repos().Query.get(id) as LdkitQuery | null;
  if (!query) {
    query = await repos().Query.create({
      $id: id,
      name,
      description: inputNames.length === 0
        ? 'Tier 0: reads the shapes backend and emits supported constraint parameters.'
        : 'Tier 1: receives extracted parameters as VALUES and checks the data backend.',
      isPartOf: [SHACL_VALIDATION_EXAMPLES_LIBRARY_ID],
    } as Partial<LdkitQuery> & { $id: string });
  }
  if (query.currentVersion) return repos().QueryVersion.get(query.currentVersion) as LdkitQueryVersion;

  const stem = id.split(':').pop();
  const temp = (kind: string, index: number) => `urn:ui-temp:${stem}-${kind}-${index}`;
  const outputs = outputNames.map((variableName, index) => ({ id: temp('output', index), variableName }));
  const inputs = inputNames.map((variableName, index) => ({ id: temp('input', index), variableName }));
  const tupleMembers = inputNames.map((_, index) => ({
    id: temp('member', index),
    position: index,
    variable: temp('input', index),
  }));
  const inferredInputs = inputNames.length > 0
    ? [{ id: temp('input-tuple', 0), name: 'Extracted constraint', memberEntries: tupleMembers.map(member => member.id) }]
    : [];
  const { created } = await createQueryVersionFlat(id, {
    queryString,
    queryType: QueryTypeIri.select,
    outputs,
    inputs,
    tupleMembers,
    inferredInputs,
    immutable: true,
  });
  return created;
}

/**
 * Whether a seeded group version is still usable, rather than merely present.
 *
 * A `currentVersion` pointer proves only that *a* write happened. It can name a
 * version that no longer resolves, or one written before a node field the
 * example depends on was persisted usably — `backendConfig` was dropped on the
 * way through the flat writer until #280, and then stored as the literal
 * `"[object Object]"` until #305 gave it a datatype. Either way the group looks
 * seeded and fails at run time with an error about the node having no way to
 * read the data graph, and a bare presence check never repairs it.
 *
 * The #305 case reaches here as a `null` `backendConfig`: the assembler reads
 * an unparseable JSON literal as absent rather than throwing, precisely so a
 * store holding one can still be loaded and repaired instead of failing to
 * boot.
 *
 * So the check is what the seeder actually needs to be true: the version
 * resolves, it belongs to this group, and every node the seeder gave an
 * ephemeral store still has one.
 */
export function groupVersionIsUsable(groupId: string, versionId: string | null | undefined): boolean {
  if (!versionId) return false;
  const version = repos().QueryGroupVersion.get(versionId) as LdkitQueryGroupVersion | null;
  if (!version || version.isPartOf !== groupId) return false;

  const nodeIds = version.executionNodes ?? [];
  if (nodeIds.length === 0) return false;
  const nodes = nodeIds.map(nodeId => repos().QueryNode.get(nodeId) as LdkitQueryNode | null);
  if (nodes.some(node => !node)) return false;

  return nodes.some(node => node!.backendConfig?.type === 'ephemeral-oxigraph');
}

async function ensureGroup(extract: LdkitQueryVersion, check: LdkitQueryVersion): Promise<void> {
  let group = repos().QueryGroup.get(GROUP_ID) as LdkitQueryGroup | null;
  if (!group) {
    group = await repos().QueryGroup.create({
      $id: GROUP_ID,
      name: 'Validate data from SHACL constraint bindings',
      description: 'Shapes backend -> constraint bindings; StartNode DataGraph -> ephemeral checker -> violation bindings.',
      isPartOf: SHACL_VALIDATION_EXAMPLES_LIBRARY_ID,
    } as Partial<LdkitQueryGroup> & { $id: string });
  }
  // A stale version is replaced rather than mutated: versions are immutable, so
  // the repair is a new one and the broken version stays in the history.
  if (groupVersionIsUsable(GROUP_ID, group.currentVersion)) return;

  const extractOutput = extract.inferredOutputs?.[0];
  const checkInput = check.inferredInputs?.[0];
  const checkOutput = check.inferredOutputs?.[0];
  if (!extractOutput || !checkInput || !checkOutput) {
    throw new Error('Validation example queries did not produce the expected tuple interfaces');
  }

  await createGroupVersionFlat(GROUP_ID, {
    rdfOutputs: [{ id: DATA_INPUT_ID, name: 'validation data' }],
    startNode: { outputs: [DATA_INPUT_ID] },
    endNode: { mediaType: 'application/sparql-results+json' },
    executionNodes: [
      { id: 'urn:ui-temp:validation-extract-node', nodeType: 'QueryNode', queryId: extract.$id, backendId: SHAPES_BACKEND_ID },
      {
        id: 'urn:ui-temp:validation-check-node',
        nodeType: 'QueryNode',
        queryId: check.$id,
        // No `backendId`: the ephemeral store below *is* this node's backend.
        // The extract node above genuinely reads the shapes backend, which is
        // what makes this group the backend-based one.
        inputs: [checkInput, DATA_INPUT_ID],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: CHECK_STORE_ID },
      },
    ],
    edges: [
      {
        id: 'urn:ui-temp:validation-start-edge',
        sourceNodeId: 'urn:__START__',
        targetNodeId: 'urn:ui-temp:validation-extract-node',
        dataFlowType: 'CONTROL_FLOW',
      },
      {
        id: 'urn:ui-temp:validation-data-edge',
        sourceNodeId: 'urn:__START__',
        targetNodeId: 'urn:ui-temp:validation-check-node',
        sourceOutputId: DATA_INPUT_ID,
        targetInputId: DATA_INPUT_ID,
        dataFlowType: 'RDF_GRAPH',
      },
      {
        id: 'urn:ui-temp:validation-bindings-edge',
        sourceNodeId: 'urn:ui-temp:validation-extract-node',
        targetNodeId: 'urn:ui-temp:validation-check-node',
        sourceOutputId: extractOutput,
        targetInputId: checkInput,
        dataFlowType: 'VARIABLE_BINDINGS',
        whenEmpty: 'require',
      },
      {
        id: 'urn:ui-temp:validation-end-edge',
        sourceNodeId: 'urn:ui-temp:validation-check-node',
        targetNodeId: 'urn:__END__',
        sourceOutputId: checkOutput,
        targetInputId: checkOutput,
        dataFlowType: 'VARIABLE_BINDINGS',
      },
    ],
  });
}

async function ensureTest(dataGraphVersion: string): Promise<void> {
  let test = repos().Test.get(TEST_ID) as LdkitTest | null;
  if (!test) {
    test = await repos().Test.create({
      $id: TEST_ID,
      name: 'SHACL bindings pipeline finds direct and nested violations',
      description: 'Runs the two-backend Query Group and compares its three final violation bindings.',
      subject: GROUP_ID,
      subjectKind: 'queryGroup',
      isPartOf: [SHACL_VALIDATION_EXAMPLES_LIBRARY_ID],
    } as Partial<LdkitTest> & { $id: string });
  }
  if (!test.currentVersion) {
    await createTestVersion(TEST_ID, {
      expectationKind: 'bindings',
      cases: [{ dataGraphVersion, expected: EXPECTED, ordered: true }],
      immutable: true,
    });
  }
}

/**
 * The two-input group's own Test.
 *
 * Until #298 a `TestCase` could name a single `dataGraphVersion`, so this group
 * — whose whole point is that shapes *and* data arrive as separate inputs —
 * could not be driven by a Test at all: the run failed with "the query group's
 * start node declares data graph input …, which this run did not supply". It
 * was covered by a direct `GraphBuilder` + `ExecutionEngine` test instead,
 * which kept it out of the library's own test run, the EARL report and
 * promote-to-test.
 *
 * The graphs are supplied positionally, in the order the group declares its
 * inputs: shapes first, then data. Naming the ports would work equally well
 * and is what a case should do when it must not depend on that order; leaving
 * them unnamed here keeps the example showing the simpler of the two.
 */
async function ensureEphemeralTest(shapesGraphVersion: string, dataGraphVersion: string): Promise<void> {
  let test = repos().Test.get(EPHEMERAL_TEST_ID) as LdkitTest | null;
  if (!test) {
    test = await repos().Test.create({
      $id: EPHEMERAL_TEST_ID,
      name: 'SHACL validation with no backend finds the same violations',
      description:
        'Runs the two-input Query Group with shapes and data both supplied at the StartNode, '
        + 'and compares its three final violation bindings.',
      subject: EPHEMERAL_GROUP_ID,
      subjectKind: 'queryGroup',
      isPartOf: [SHACL_VALIDATION_EXAMPLES_LIBRARY_ID],
    } as Partial<LdkitTest> & { $id: string });
  }
  if (!test.currentVersion) {
    await createTestVersion(EPHEMERAL_TEST_ID, {
      expectationKind: 'bindings',
      cases: [{
        dataGraphs: [
          { dataGraphVersion: shapesGraphVersion },
          { dataGraphVersion },
        ],
        // The identical three violations the backend-based group finds:
        // passing the shapes by value must not change the verdict.
        expected: EXPECTED,
        ordered: true,
      }],
      immutable: true,
    });
  }
}
