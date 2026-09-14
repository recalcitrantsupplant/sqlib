/**
 * A per-constraint-kind fan-out variant of the SHACL validation pipeline.
 *
 * Follow-up to the two-node minimal example in `validationExamples.ts` (issue
 * #280 / #295). That checker is one query with a sparse VALUES interface and a
 * four-branch FILTER/OPTIONAL dispatch over `?constraintKind` and `?depth` —
 * fine as a first runnable example, but every branch shares one failure domain
 * and adding a constraint kind means editing a shared query rather than adding
 * a node.
 *
 * This group replaces that with:
 *
 * - One extraction query **per constraint kind, per depth** against the shapes
 *   backend, each emitting dense rows (no UNDEF columns, no BOUND guards).
 * - One small checker **per kind/depth** against the data, VALUES-fed from its
 *   own extraction — each independently testable and independently timed.
 * - A **focus-node resolution** node, run once against the data, so
 *   `?focus a ?targetClass` is not re-derived by every checker.
 * - An **unsupported-constraint detector**, so a constraint kind the pipeline
 *   does not implement (`sh:pattern` here) surfaces as a row rather than being
 *   silently skipped.
 * - A **shapes-graph cycle detector**, over the property path the design
 *   calls for (`sh:property|sh:node|sh:or|sh:and|sh:not|rdf:first|rdf:rest`).
 * - A **merge** node: the three checkers' outputs share one input tuple (the
 *   engine unions same-shaped bindings arriving at the same input), and the
 *   merge query UNIONs that with the detectors' differently-shaped rows into
 *   one report, tagged with `?reportKind`.
 *
 * Shapes and data are its own graphs (a separate namespace from the minimal
 * example's), with two additions the minimal example's shapes have no reason
 * to carry: an `sh:pattern` constraint (unsupported), and a pair of shapes
 * that reference each other through `sh:node` (a cycle) — an island the
 * PersonShape tree never reaches, so it cannot change what the checkers see.
 */

import type { LdkitQuery } from '../../persistence/schemas/QuerySchema.js';
import type { LdkitQueryGroup } from '../../persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryVersion } from '../../persistence/schemas/QueryVersionSchema.js';
import type { LdkitTest } from '../../persistence/schemas/TestSchema.js';
import { QueryTypeIri } from '../../constants/queryTypes.js';
import { getEntityRepositories } from '../CacheCoordinatorProvider.js';
import { createGroupVersionFlat } from '../GroupVersionWriter.js';
import { mintId } from '../id.js';
import { createQueryVersionFlat } from '../QueryVersionWriter.js';
import { createTestVersion } from '../TestVersionWriter.js';
import {
  ensureBackend,
  ensureDataGraph,
  groupVersionIsUsable,
  SHACL_VALIDATION_EXAMPLES_LIBRARY_ID,
} from './validationExamples.js';

const SHAPES_GRAPH_ID = mintId('dataGraph', 'shacl-validation-fanout-shapes');
const DATA_GRAPH_ID = mintId('dataGraph', 'shacl-validation-fanout-data');
const SHAPES_BACKEND_ID = mintId('backend', 'shacl-validation-fanout-shapes');
export const FANOUT_GROUP_ID = mintId('group', 'shacl-validation-fanout');
const FANOUT_TEST_ID = mintId('test', 'shacl-validation-fanout');
const DATA_INPUT_ID = 'urn:ui-temp:shacl-fanout-data-input';

/** One ephemeral store per data-consuming node — see the sibling file's note on why they stay separate. */
const FOCUS_STORE_ID = 'urn:sqlib:store:shacl-fanout-focus';
const CHECK_MINCOUNT_1_STORE_ID = 'urn:sqlib:store:shacl-fanout-check-mincount-1';
const CHECK_DATATYPE_1_STORE_ID = 'urn:sqlib:store:shacl-fanout-check-datatype-1';
const CHECK_MINCOUNT_2_STORE_ID = 'urn:sqlib:store:shacl-fanout-check-mincount-2';

const SHAPES = `
@prefix ex: <https://example.com/validation-fanout#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:path ex:email ; sh:minCount 1 ] ;
  sh:property [ sh:path ex:age ; sh:datatype xsd:integer ] ;
  sh:property [ sh:path ex:handle ; sh:pattern "^[a-z]+$" ] ;
  sh:property [ sh:path ex:address ; sh:node ex:AddressShape ] .

ex:AddressShape a sh:NodeShape ;
  sh:property [ sh:path ex:postcode ; sh:minCount 1 ] .

# An island unreachable from PersonShape's target tree, existing solely to
# exercise the cycle detector: it must never change what the checkers see.
ex:CyclicShapeA a sh:NodeShape ;
  sh:property [ sh:path ex:next ; sh:node ex:CyclicShapeB ] .

ex:CyclicShapeB a sh:NodeShape ;
  sh:property [ sh:path ex:next ; sh:node ex:CyclicShapeA ] .
`;

const DATA = `
@prefix ex: <https://example.com/validation-fanout#> .

ex:ada a ex:Person ;
  ex:email "ada@example.com" ;
  ex:age 42 ;
  ex:handle "ada" ;
  ex:address [ ex:postcode "4000" ] .

ex:bert a ex:Person ;
  ex:age "unknown" ;
  ex:handle "Bert!" ;
  ex:address ex:bertAddress .
`;

const FOCUS_QUERY = `
SELECT ?focus ?targetClass
WHERE {
  ?focus a ?targetClass .
}
ORDER BY ?focus
`;

const EXTRACT_MINCOUNT_DEPTH1_QUERY = `
PREFIX sh: <http://www.w3.org/ns/shacl#>
SELECT ?sourceShape ?targetClass ?path1
WHERE {
  ?sourceShape a sh:NodeShape ; sh:targetClass ?targetClass ; sh:property ?propertyShape .
  ?propertyShape sh:path ?path1 ; sh:minCount 1 .
}
ORDER BY ?sourceShape ?path1
`;

const EXTRACT_DATATYPE_DEPTH1_QUERY = `
PREFIX sh: <http://www.w3.org/ns/shacl#>
SELECT ?sourceShape ?targetClass ?path1 ?constraintValue
WHERE {
  ?sourceShape a sh:NodeShape ; sh:targetClass ?targetClass ; sh:property ?propertyShape .
  ?propertyShape sh:path ?path1 ; sh:datatype ?constraintValue .
}
ORDER BY ?sourceShape ?path1
`;

const EXTRACT_MINCOUNT_DEPTH2_QUERY = `
PREFIX sh: <http://www.w3.org/ns/shacl#>
SELECT ?sourceShape ?targetClass ?path1 ?path2
WHERE {
  ?sourceShape a sh:NodeShape ; sh:targetClass ?targetClass ; sh:property ?outerPropertyShape .
  ?outerPropertyShape sh:path ?path1 ; sh:node ?nestedShape .
  ?nestedShape sh:property ?innerPropertyShape .
  ?innerPropertyShape sh:path ?path2 ; sh:minCount 1 .
}
ORDER BY ?sourceShape ?path1 ?path2
`;

const CHECK_MINCOUNT_DEPTH1_QUERY = `
SELECT ?focus ?sourceShape ?path1 ?path2 ?message
WHERE {
  VALUES (?focus ?targetClass) { (UNDEF UNDEF) }
  VALUES (?sourceShape ?targetClass ?path1) { (UNDEF UNDEF UNDEF) }
  OPTIONAL { ?focus ?path1 ?value1 }
  FILTER (!BOUND(?value1))
  BIND ("Missing required value" AS ?message)
}
ORDER BY ?focus ?path1
`;

const CHECK_DATATYPE_DEPTH1_QUERY = `
SELECT ?focus ?sourceShape ?path1 ?path2 ?message
WHERE {
  VALUES (?focus ?targetClass) { (UNDEF UNDEF) }
  VALUES (?sourceShape ?targetClass ?path1 ?constraintValue) { (UNDEF UNDEF UNDEF UNDEF) }
  ?focus ?path1 ?value1 .
  FILTER (DATATYPE(?value1) != ?constraintValue)
  BIND ("Value has wrong datatype" AS ?message)
}
ORDER BY ?focus ?path1
`;

const CHECK_MINCOUNT_DEPTH2_QUERY = `
SELECT ?focus ?sourceShape ?path1 ?path2 ?message
WHERE {
  VALUES (?focus ?targetClass) { (UNDEF UNDEF) }
  VALUES (?sourceShape ?targetClass ?path1 ?path2) { (UNDEF UNDEF UNDEF UNDEF) }
  ?focus ?path1 ?value1 .
  OPTIONAL { ?value1 ?path2 ?value2 }
  FILTER (!BOUND(?value2))
  BIND ("Missing required value" AS ?message)
}
ORDER BY ?focus ?path1 ?path2
`;

/**
 * Unsupported constraints must surface as rows: a constraint predicate other
 * than the three this pipeline evaluates (`sh:path`/`sh:node` are structural,
 * not constraints in their own right) is a shape the checkers never look at,
 * and silently not reporting it would make the pipeline claim "conforms" for
 * a shape it never checked.
 */
const UNSUPPORTED_DETECTOR_QUERY = `
PREFIX sh: <http://www.w3.org/ns/shacl#>
SELECT ?sourceShape ?path1 ?constraintPredicate
WHERE {
  {
    ?sourceShape a sh:NodeShape ; sh:property ?propertyShape .
    ?propertyShape sh:path ?path1 ; ?constraintPredicate ?constraintValue .
    FILTER (?constraintPredicate NOT IN (sh:path, sh:minCount, sh:datatype, sh:node))
  }
  UNION
  {
    ?sourceShape a sh:NodeShape ; sh:property ?outerPropertyShape .
    ?outerPropertyShape sh:node ?nestedShape .
    ?nestedShape sh:property ?innerPropertyShape .
    ?innerPropertyShape sh:path ?path1 ; ?constraintPredicate ?constraintValue .
    FILTER (?constraintPredicate NOT IN (sh:path, sh:minCount, sh:datatype, sh:node))
  }
}
ORDER BY ?sourceShape ?path1
`;

const CYCLE_DETECTOR_QUERY = `
PREFIX sh: <http://www.w3.org/ns/shacl#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?sourceShape
WHERE {
  ?sourceShape (sh:property|sh:node|sh:or|sh:and|sh:not|rdf:first|rdf:rest)+ ?sourceShape .
  FILTER (isIRI(?sourceShape))
}
ORDER BY ?sourceShape
`;

const MERGE_QUERY = `
SELECT ?reportKind ?focus ?sourceShape ?path1 ?path2 ?message
WHERE {
  {
    VALUES (?focus ?sourceShape ?path1 ?path2 ?message) { (UNDEF UNDEF UNDEF UNDEF UNDEF) }
    BIND ("violation" AS ?reportKind)
  }
  UNION
  {
    VALUES (?sourceShape ?path1 ?constraintPredicate) { (UNDEF UNDEF UNDEF) }
    BIND ("unsupported" AS ?reportKind)
    BIND (CONCAT("unsupported constraint ", STR(?constraintPredicate)) AS ?message)
  }
  UNION
  {
    VALUES (?sourceShape) { (UNDEF) }
    BIND ("cycle" AS ?reportKind)
    BIND ("cyclic shapes graph detected" AS ?message)
  }
}
ORDER BY ?reportKind ?focus ?sourceShape ?path1
`;

const NS = 'https://example.com/validation-fanout#';
const SH = 'http://www.w3.org/ns/shacl#';

const uri = (value: string) => ({ type: 'uri' as const, value });
const literal = (value: string) => ({ type: 'literal' as const, value });

const FANOUT_EXPECTED = JSON.stringify({
  head: { vars: ['reportKind', 'focus', 'sourceShape', 'path1', 'path2', 'message'] },
  results: {
    bindings: [
      {
        reportKind: literal('cycle'),
        sourceShape: uri(`${NS}CyclicShapeA`),
        message: literal('cyclic shapes graph detected'),
      },
      {
        reportKind: literal('cycle'),
        sourceShape: uri(`${NS}CyclicShapeB`),
        message: literal('cyclic shapes graph detected'),
      },
      {
        reportKind: literal('unsupported'),
        sourceShape: uri(`${NS}PersonShape`),
        path1: uri(`${NS}handle`),
        message: literal(`unsupported constraint ${SH}pattern`),
      },
      {
        reportKind: literal('violation'),
        focus: uri(`${NS}bert`),
        sourceShape: uri(`${NS}PersonShape`),
        path1: uri(`${NS}address`),
        path2: uri(`${NS}postcode`),
        message: literal('Missing required value'),
      },
      {
        reportKind: literal('violation'),
        focus: uri(`${NS}bert`),
        sourceShape: uri(`${NS}PersonShape`),
        path1: uri(`${NS}age`),
        message: literal('Value has wrong datatype'),
      },
      {
        reportKind: literal('violation'),
        focus: uri(`${NS}bert`),
        sourceShape: uri(`${NS}PersonShape`),
        path1: uri(`${NS}email`),
        message: literal('Missing required value'),
      },
    ],
  },
});

function repos() {
  return getEntityRepositories();
}

export async function seedShaclValidationFanOutExample(log: (message: string) => void = () => {}): Promise<void> {
  await ensureDataGraph(SHAPES_GRAPH_ID, 'SHACL shapes graph (fan-out)', SHAPES);
  const dataGraphVersion = await ensureDataGraph(DATA_GRAPH_ID, 'Validation instance data (fan-out)', DATA);
  await ensureBackend(SHAPES_BACKEND_ID, 'SHACL shapes, fan-out (in memory)', SHAPES_GRAPH_ID);

  const focus = await ensureMultiInputQuery(
    mintId('query', 'shacl-fanout-focus'),
    'Resolve focus nodes',
    'Run once: every focus node and its target class, so no checker re-derives it.',
    FOCUS_QUERY,
    ['focus', 'targetClass'],
  );

  const extractMinCount1 = await ensureMultiInputQuery(
    mintId('query', 'shacl-fanout-extract-mincount-1'),
    'Extract minCount constraints (depth 1)',
    'Dense rows: one per minCount property shape directly on the target class.',
    EXTRACT_MINCOUNT_DEPTH1_QUERY,
    ['sourceShape', 'targetClass', 'path1'],
  );
  const extractDatatype1 = await ensureMultiInputQuery(
    mintId('query', 'shacl-fanout-extract-datatype-1'),
    'Extract datatype constraints (depth 1)',
    'Dense rows: one per datatype property shape directly on the target class.',
    EXTRACT_DATATYPE_DEPTH1_QUERY,
    ['sourceShape', 'targetClass', 'path1', 'constraintValue'],
  );
  const extractMinCount2 = await ensureMultiInputQuery(
    mintId('query', 'shacl-fanout-extract-mincount-2'),
    'Extract minCount constraints (depth 2)',
    'Dense rows: one per minCount property shape reached through an sh:node hop.',
    EXTRACT_MINCOUNT_DEPTH2_QUERY,
    ['sourceShape', 'targetClass', 'path1', 'path2'],
  );

  const focusGroup = { name: 'Focus nodes', variableNames: ['focus', 'targetClass'] };

  const checkMinCount1 = await ensureMultiInputQuery(
    mintId('query', 'shacl-fanout-check-mincount-1'),
    'Check minCount (depth 1)',
    'VALUES-fed from the focus and depth-1 minCount extractions; checks the data backend.',
    CHECK_MINCOUNT_DEPTH1_QUERY,
    ['focus', 'sourceShape', 'path1', 'path2', 'message'],
    [focusGroup, { name: 'minCount constraints (depth 1)', variableNames: ['sourceShape', 'targetClass', 'path1'] }],
  );
  const checkDatatype1 = await ensureMultiInputQuery(
    mintId('query', 'shacl-fanout-check-datatype-1'),
    'Check datatype (depth 1)',
    'VALUES-fed from the focus and depth-1 datatype extractions; checks the data backend.',
    CHECK_DATATYPE_DEPTH1_QUERY,
    ['focus', 'sourceShape', 'path1', 'path2', 'message'],
    [focusGroup, { name: 'datatype constraints (depth 1)', variableNames: ['sourceShape', 'targetClass', 'path1', 'constraintValue'] }],
  );
  const checkMinCount2 = await ensureMultiInputQuery(
    mintId('query', 'shacl-fanout-check-mincount-2'),
    'Check minCount (depth 2)',
    'VALUES-fed from the focus and depth-2 minCount extractions; checks the data backend.',
    CHECK_MINCOUNT_DEPTH2_QUERY,
    ['focus', 'sourceShape', 'path1', 'path2', 'message'],
    [focusGroup, { name: 'minCount constraints (depth 2)', variableNames: ['sourceShape', 'targetClass', 'path1', 'path2'] }],
  );

  const unsupported = await ensureMultiInputQuery(
    mintId('query', 'shacl-fanout-unsupported'),
    'Detect unsupported constraints',
    'Any constraint predicate the checkers do not evaluate, surfaced rather than silently skipped.',
    UNSUPPORTED_DETECTOR_QUERY,
    ['sourceShape', 'path1', 'constraintPredicate'],
  );
  const cycle = await ensureMultiInputQuery(
    mintId('query', 'shacl-fanout-cycle'),
    'Detect shapes-graph cycles',
    'A shape reachable back to itself through property/node/or/and/not/first/rest.',
    CYCLE_DETECTOR_QUERY,
    ['sourceShape'],
  );

  const merge = await ensureMultiInputQuery(
    mintId('query', 'shacl-fanout-merge'),
    'Merge the fan-out report',
    'Unions the three checkers’ violations (same input tuple) with the unsupported and cycle rows.',
    MERGE_QUERY,
    ['reportKind', 'focus', 'sourceShape', 'path1', 'path2', 'message'],
    [
      { name: 'Violations', variableNames: ['focus', 'sourceShape', 'path1', 'path2', 'message'] },
      { name: 'Unsupported constraints', variableNames: ['sourceShape', 'path1', 'constraintPredicate'] },
      { name: 'Cycles', variableNames: ['sourceShape'] },
    ],
  );

  await ensureFanOutGroup(
    { focus, extractMinCount1, extractDatatype1, extractMinCount2, checkMinCount1, checkDatatype1, checkMinCount2, unsupported, cycle, merge },
  );
  await ensureFanOutTest(dataGraphVersion);
  log('Created SHACL validation fan-out query-group example');
}

interface InputGroupSpec {
  name: string;
  variableNames: string[];
}

/**
 * Like `ensureQuery` in the sibling file, generalised to any number of
 * separate VALUES-clause tuple interfaces on one query — the mechanism a
 * checker needs to take the focus-resolution node's output and its own
 * per-kind extraction as two independent inputs, and the merge node needs to
 * take three.
 */
async function ensureMultiInputQuery(
  id: string,
  name: string,
  description: string,
  queryString: string,
  outputNames: string[],
  inputGroups: InputGroupSpec[] = [],
): Promise<LdkitQueryVersion> {
  let query = repos().Query.get(id) as LdkitQuery | null;
  if (!query) {
    query = await repos().Query.create({
      $id: id,
      name,
      description,
      isPartOf: [SHACL_VALIDATION_EXAMPLES_LIBRARY_ID],
    } as Partial<LdkitQuery> & { $id: string });
  }
  if (query.currentVersion) return repos().QueryVersion.get(query.currentVersion) as LdkitQueryVersion;

  const stem = id.split(':').pop();
  const outputs = outputNames.map((variableName, index) => ({ id: `urn:ui-temp:${stem}-output-${index}`, variableName }));

  const inputs: Array<{ id: string; variableName: string }> = [];
  const tupleMembers: Array<{ id: string; position: number; variable: string }> = [];
  const inferredInputs: Array<{ id: string; name: string; memberEntries: string[] }> = [];

  inputGroups.forEach((group, groupIndex) => {
    const memberIds: string[] = [];
    // `detectInputs` canonicalizes a VALUES clause's variables alphabetically
    // before matching it against a declared InputTuple's member order, so the
    // tuple must be declared in that same order regardless of how the query
    // text happens to write the VALUES column list.
    const sortedVariableNames = [...group.variableNames].sort();
    sortedVariableNames.forEach((variableName, varIndex) => {
      const inputId = `urn:ui-temp:${stem}-input-${groupIndex}-${varIndex}`;
      const memberId = `urn:ui-temp:${stem}-member-${groupIndex}-${varIndex}`;
      inputs.push({ id: inputId, variableName });
      tupleMembers.push({ id: memberId, position: varIndex, variable: inputId });
      memberIds.push(memberId);
    });
    inferredInputs.push({
      id: `urn:ui-temp:${stem}-input-tuple-${groupIndex}`,
      name: group.name,
      memberEntries: memberIds,
    });
  });

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

interface FanOutQueries {
  focus: LdkitQueryVersion;
  extractMinCount1: LdkitQueryVersion;
  extractDatatype1: LdkitQueryVersion;
  extractMinCount2: LdkitQueryVersion;
  checkMinCount1: LdkitQueryVersion;
  checkDatatype1: LdkitQueryVersion;
  checkMinCount2: LdkitQueryVersion;
  unsupported: LdkitQueryVersion;
  cycle: LdkitQueryVersion;
  merge: LdkitQueryVersion;
}

async function ensureFanOutGroup(q: FanOutQueries): Promise<void> {
  let group = repos().QueryGroup.get(FANOUT_GROUP_ID) as LdkitQueryGroup | null;
  if (!group) {
    group = await repos().QueryGroup.create({
      $id: FANOUT_GROUP_ID,
      name: 'Validate data from SHACL constraint bindings (fan-out)',
      description:
        'One extraction/checker pair per constraint kind and depth, a shared focus-resolution node, '
        + 'unsupported-constraint and shapes-cycle detectors, and a merge node unioning it all into one report.',
      isPartOf: SHACL_VALIDATION_EXAMPLES_LIBRARY_ID,
    } as Partial<LdkitQueryGroup> & { $id: string });
  }
  if (groupVersionIsUsable(FANOUT_GROUP_ID, group.currentVersion)) return;

  const focusOutput = q.focus.inferredOutputs?.[0];
  const extractMinCount1Output = q.extractMinCount1.inferredOutputs?.[0];
  const extractDatatype1Output = q.extractDatatype1.inferredOutputs?.[0];
  const extractMinCount2Output = q.extractMinCount2.inferredOutputs?.[0];
  const unsupportedOutput = q.unsupported.inferredOutputs?.[0];
  const cycleOutput = q.cycle.inferredOutputs?.[0];
  const mergeOutput = q.merge.inferredOutputs?.[0];

  const [checkMinCount1Focus, checkMinCount1Constraint] = q.checkMinCount1.inferredInputs ?? [];
  const [checkDatatype1Focus, checkDatatype1Constraint] = q.checkDatatype1.inferredInputs ?? [];
  const [checkMinCount2Focus, checkMinCount2Constraint] = q.checkMinCount2.inferredInputs ?? [];
  const checkMinCount1Output = q.checkMinCount1.inferredOutputs?.[0];
  const checkDatatype1Output = q.checkDatatype1.inferredOutputs?.[0];
  const checkMinCount2Output = q.checkMinCount2.inferredOutputs?.[0];

  const [mergeViolations, mergeUnsupported, mergeCycles] = q.merge.inferredInputs ?? [];

  if (
    !focusOutput || !extractMinCount1Output || !extractDatatype1Output || !extractMinCount2Output
    || !unsupportedOutput || !cycleOutput || !mergeOutput
    || !checkMinCount1Focus || !checkMinCount1Constraint || !checkMinCount1Output
    || !checkDatatype1Focus || !checkDatatype1Constraint || !checkDatatype1Output
    || !checkMinCount2Focus || !checkMinCount2Constraint || !checkMinCount2Output
    || !mergeViolations || !mergeUnsupported || !mergeCycles
  ) {
    throw new Error('Fan-out validation example queries did not produce the expected tuple interfaces');
  }

  const nodeId = (suffix: string) => `urn:ui-temp:fanout-${suffix}`;
  const edgeId = (suffix: string) => `urn:ui-temp:fanout-edge-${suffix}`;

  await createGroupVersionFlat(FANOUT_GROUP_ID, {
    rdfOutputs: [{ id: DATA_INPUT_ID, name: 'validation data' }],
    startNode: { outputs: [DATA_INPUT_ID] },
    endNode: { mediaType: 'application/sparql-results+json' },
    executionNodes: [
      { id: nodeId('focus'), nodeType: 'QueryNode', queryId: q.focus.$id, inputs: [DATA_INPUT_ID], backendConfig: { type: 'ephemeral-oxigraph', storeId: FOCUS_STORE_ID } },
      { id: nodeId('extract-mincount-1'), nodeType: 'QueryNode', queryId: q.extractMinCount1.$id, backendId: SHAPES_BACKEND_ID },
      { id: nodeId('extract-datatype-1'), nodeType: 'QueryNode', queryId: q.extractDatatype1.$id, backendId: SHAPES_BACKEND_ID },
      { id: nodeId('extract-mincount-2'), nodeType: 'QueryNode', queryId: q.extractMinCount2.$id, backendId: SHAPES_BACKEND_ID },
      {
        id: nodeId('check-mincount-1'),
        nodeType: 'QueryNode',
        queryId: q.checkMinCount1.$id,
        inputs: [checkMinCount1Focus, checkMinCount1Constraint, DATA_INPUT_ID],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: CHECK_MINCOUNT_1_STORE_ID },
      },
      {
        id: nodeId('check-datatype-1'),
        nodeType: 'QueryNode',
        queryId: q.checkDatatype1.$id,
        inputs: [checkDatatype1Focus, checkDatatype1Constraint, DATA_INPUT_ID],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: CHECK_DATATYPE_1_STORE_ID },
      },
      {
        id: nodeId('check-mincount-2'),
        nodeType: 'QueryNode',
        queryId: q.checkMinCount2.$id,
        inputs: [checkMinCount2Focus, checkMinCount2Constraint, DATA_INPUT_ID],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: CHECK_MINCOUNT_2_STORE_ID },
      },
      { id: nodeId('unsupported'), nodeType: 'QueryNode', queryId: q.unsupported.$id, backendId: SHAPES_BACKEND_ID },
      { id: nodeId('cycle'), nodeType: 'QueryNode', queryId: q.cycle.$id, backendId: SHAPES_BACKEND_ID },
      {
        id: nodeId('merge'),
        nodeType: 'QueryNode',
        queryId: q.merge.$id,
        inputs: [mergeViolations, mergeUnsupported, mergeCycles],
        backendId: SHAPES_BACKEND_ID,
      },
    ],
    edges: [
      // Control-flow into every node with no other incoming edge.
      { id: edgeId('start-extract-mincount-1'), sourceNodeId: 'urn:__START__', targetNodeId: nodeId('extract-mincount-1'), dataFlowType: 'CONTROL_FLOW' },
      { id: edgeId('start-extract-datatype-1'), sourceNodeId: 'urn:__START__', targetNodeId: nodeId('extract-datatype-1'), dataFlowType: 'CONTROL_FLOW' },
      { id: edgeId('start-extract-mincount-2'), sourceNodeId: 'urn:__START__', targetNodeId: nodeId('extract-mincount-2'), dataFlowType: 'CONTROL_FLOW' },
      { id: edgeId('start-unsupported'), sourceNodeId: 'urn:__START__', targetNodeId: nodeId('unsupported'), dataFlowType: 'CONTROL_FLOW' },
      { id: edgeId('start-cycle'), sourceNodeId: 'urn:__START__', targetNodeId: nodeId('cycle'), dataFlowType: 'CONTROL_FLOW' },

      // Data graph into every node that reads it.
      { id: edgeId('data-focus'), sourceNodeId: 'urn:__START__', targetNodeId: nodeId('focus'), sourceOutputId: DATA_INPUT_ID, targetInputId: DATA_INPUT_ID, dataFlowType: 'RDF_GRAPH' },
      { id: edgeId('data-check-mincount-1'), sourceNodeId: 'urn:__START__', targetNodeId: nodeId('check-mincount-1'), sourceOutputId: DATA_INPUT_ID, targetInputId: DATA_INPUT_ID, dataFlowType: 'RDF_GRAPH' },
      { id: edgeId('data-check-datatype-1'), sourceNodeId: 'urn:__START__', targetNodeId: nodeId('check-datatype-1'), sourceOutputId: DATA_INPUT_ID, targetInputId: DATA_INPUT_ID, dataFlowType: 'RDF_GRAPH' },
      { id: edgeId('data-check-mincount-2'), sourceNodeId: 'urn:__START__', targetNodeId: nodeId('check-mincount-2'), sourceOutputId: DATA_INPUT_ID, targetInputId: DATA_INPUT_ID, dataFlowType: 'RDF_GRAPH' },

      // Focus resolution -> each checker.
      { id: edgeId('focus-check-mincount-1'), sourceNodeId: nodeId('focus'), targetNodeId: nodeId('check-mincount-1'), sourceOutputId: focusOutput, targetInputId: checkMinCount1Focus, dataFlowType: 'VARIABLE_BINDINGS', whenEmpty: 'require' },
      { id: edgeId('focus-check-datatype-1'), sourceNodeId: nodeId('focus'), targetNodeId: nodeId('check-datatype-1'), sourceOutputId: focusOutput, targetInputId: checkDatatype1Focus, dataFlowType: 'VARIABLE_BINDINGS', whenEmpty: 'require' },
      { id: edgeId('focus-check-mincount-2'), sourceNodeId: nodeId('focus'), targetNodeId: nodeId('check-mincount-2'), sourceOutputId: focusOutput, targetInputId: checkMinCount2Focus, dataFlowType: 'VARIABLE_BINDINGS', whenEmpty: 'require' },

      // Per-kind extraction -> its own checker.
      { id: edgeId('extract-check-mincount-1'), sourceNodeId: nodeId('extract-mincount-1'), targetNodeId: nodeId('check-mincount-1'), sourceOutputId: extractMinCount1Output, targetInputId: checkMinCount1Constraint, dataFlowType: 'VARIABLE_BINDINGS', whenEmpty: 'require' },
      { id: edgeId('extract-check-datatype-1'), sourceNodeId: nodeId('extract-datatype-1'), targetNodeId: nodeId('check-datatype-1'), sourceOutputId: extractDatatype1Output, targetInputId: checkDatatype1Constraint, dataFlowType: 'VARIABLE_BINDINGS', whenEmpty: 'require' },
      { id: edgeId('extract-check-mincount-2'), sourceNodeId: nodeId('extract-mincount-2'), targetNodeId: nodeId('check-mincount-2'), sourceOutputId: extractMinCount2Output, targetInputId: checkMinCount2Constraint, dataFlowType: 'VARIABLE_BINDINGS', whenEmpty: 'require' },

      // The three checkers share one merge input tuple: bindings arriving at
      // the same targetInputId are unioned by the engine, not by this query.
      { id: edgeId('check-mincount-1-merge'), sourceNodeId: nodeId('check-mincount-1'), targetNodeId: nodeId('merge'), sourceOutputId: checkMinCount1Output, targetInputId: mergeViolations, dataFlowType: 'VARIABLE_BINDINGS' },
      { id: edgeId('check-datatype-1-merge'), sourceNodeId: nodeId('check-datatype-1'), targetNodeId: nodeId('merge'), sourceOutputId: checkDatatype1Output, targetInputId: mergeViolations, dataFlowType: 'VARIABLE_BINDINGS' },
      { id: edgeId('check-mincount-2-merge'), sourceNodeId: nodeId('check-mincount-2'), targetNodeId: nodeId('merge'), sourceOutputId: checkMinCount2Output, targetInputId: mergeViolations, dataFlowType: 'VARIABLE_BINDINGS' },
      { id: edgeId('unsupported-merge'), sourceNodeId: nodeId('unsupported'), targetNodeId: nodeId('merge'), sourceOutputId: unsupportedOutput, targetInputId: mergeUnsupported, dataFlowType: 'VARIABLE_BINDINGS' },
      { id: edgeId('cycle-merge'), sourceNodeId: nodeId('cycle'), targetNodeId: nodeId('merge'), sourceOutputId: cycleOutput, targetInputId: mergeCycles, dataFlowType: 'VARIABLE_BINDINGS' },

      { id: edgeId('merge-end'), sourceNodeId: nodeId('merge'), targetNodeId: 'urn:__END__', sourceOutputId: mergeOutput, targetInputId: mergeOutput, dataFlowType: 'VARIABLE_BINDINGS' },
    ],
  });
}

async function ensureFanOutTest(dataGraphVersion: string): Promise<void> {
  let test = repos().Test.get(FANOUT_TEST_ID) as LdkitTest | null;
  if (!test) {
    test = await repos().Test.create({
      $id: FANOUT_TEST_ID,
      name: 'SHACL fan-out pipeline reports violations, unsupported constraints and cycles',
      description: 'Runs the per-kind fan-out Query Group and compares its merged report.',
      subject: FANOUT_GROUP_ID,
      subjectKind: 'queryGroup',
      isPartOf: [SHACL_VALIDATION_EXAMPLES_LIBRARY_ID],
    } as Partial<LdkitTest> & { $id: string });
  }
  if (!test.currentVersion) {
    await createTestVersion(FANOUT_TEST_ID, {
      expectationKind: 'bindings',
      cases: [{ dataGraphVersion, expected: FANOUT_EXPECTED, ordered: true }],
      immutable: true,
    });
  }
}
