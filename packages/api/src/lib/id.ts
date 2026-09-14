import { randomUUID } from 'crypto';

// Centralized namespace prefixes for all sqlib resources
export const NS = {
  query: 'urn:sqlib:query:',
  queryVersion: 'urn:sqlib:query-version:',
  rule: 'urn:sqlib:rule:',
  ruleVersion: 'urn:sqlib:rule-version:',
  ruleset: 'urn:sqlib:ruleset:',
  rulesetVersion: 'urn:sqlib:ruleset-version:',
  dataBlock: 'urn:sqlib:data-block:',
  dataBlockVersion: 'urn:sqlib:data-block-version:',
  group: 'urn:sqlib:group:',
  groupVersion: 'urn:sqlib:group-version:',
  node: 'urn:sqlib:node:',
  edge: 'urn:sqlib:edge:',
  input: 'urn:sqlib:input:',
  output: 'urn:sqlib:output:',
  tupleMember: 'urn:sqlib:tuple-member:',
  inputTuple: 'urn:sqlib:input-tuple:',
  outputTuple: 'urn:sqlib:output-tuple:',
  limitParam: 'urn:sqlib:limit-param:',
  offsetParam: 'urn:sqlib:offset-param:',
  backend: 'urn:sqlib:backend:',
  library: 'urn:sqlib:library:',
  rdfOutput: 'urn:sqlib:rdf-output:',
  triplesQuadsIO: 'urn:sqlib:triples-quads-io:',
  controlFlowIO: 'urn:sqlib:control-flow-io:',
  startNode: 'urn:sqlib:start-node:',
  endNode: 'urn:sqlib:end-node:',
  dynNode: 'urn:sqlib:dyn-node:',
  booleanIO: 'urn:sqlib:boolean-io:',
  queryIdInput: 'urn:sqlib:query-id-input:',
  argumentSet: 'urn:sqlib:argument-set:',
  argumentSetVersion: 'urn:sqlib:argument-set-version:',
  argumentTupleBinding: 'urn:sqlib:argument-tuple-binding:',
  argumentScalarBinding: 'urn:sqlib:argument-scalar-binding:',
  argumentGraphBinding: 'urn:sqlib:argument-graph-binding:',
  benchmarkExperiment: 'urn:sqlib:benchmark-experiment:',
  benchmarkExperimentVersion: 'urn:sqlib:benchmark-experiment-version:',
  benchmarkRun: 'urn:sqlib:benchmark-run:',
  benchmarkNodeRun: 'urn:sqlib:benchmark-node-run:',
  benchmarkIterationRun: 'urn:sqlib:benchmark-iteration-run:',
  benchmarkObservation: 'urn:sqlib:benchmark-observation:',
  benchmarkNodeObservation: 'urn:sqlib:benchmark-node-observation:',
  benchmarkIterationObservation: 'urn:sqlib:benchmark-iteration-observation:',
  etlJob: 'urn:sqlib:etl-job:',
  etlJobVersion: 'urn:sqlib:etl-job-version:',
  etlColumnMapping: 'urn:sqlib:etl-column-mapping:',
  etlColumnMappingVersion: 'urn:sqlib:etl-column-mapping-version:',
  etlExecution: 'urn:sqlib:etl-execution:',
  duckDbEtlNode: 'urn:sqlib:duckdb-etl-node:',
  dataGraph: 'urn:sqlib:data-graph:',
  dataGraphVersion: 'urn:sqlib:data-graph-version:',
  test: 'urn:sqlib:test:',
  testVersion: 'urn:sqlib:test-version:',
  testCase: 'urn:sqlib:test-case:',
  testCaseDataGraph: 'urn:sqlib:test-case-data-graph:',
  tag: 'urn:sqlib:tag:',
  patch: 'urn:sqlib:patch:',
  tupleSet: 'urn:sqlib:tuple-set:',
  tupleSetVersion: 'urn:sqlib:tuple-set-version:',
  // Test runs. `testRun` names two things that are the same thing seen twice:
  // the stored run entity in the library store (issue #179), and the run a
  // report's EARL assertions cite, which lives in whichever backend the caller
  // nominated. Both are "one execution of one test", and both are minted here.
  testRun: 'urn:sqlib:test-run:',
  testRunCase: 'urn:sqlib:test-run-case:',
  earlAssertion: 'urn:sqlib:assertion:',
  earlResult: 'urn:sqlib:assertion-result:',
} as const;

type KnownKind = keyof typeof NS;

// Support common aliases so callers can pass flexible keys
const ALIAS_TO_KIND: Record<string, KnownKind> = {
  // query + versions
  query: 'query',
  'queryversion': 'queryVersion',
  'query-version': 'queryVersion',
  'query_version': 'queryVersion',
  rule: 'rule',
  'ruleversion': 'ruleVersion',
  'rule-version': 'ruleVersion',
  'rule_version': 'ruleVersion',

  // rulesets + versions
  ruleset: 'ruleset',
  'rulesetversion': 'rulesetVersion',
  'ruleset-version': 'rulesetVersion',
  'ruleset_version': 'rulesetVersion',

  // datablocks + versions
  datablock: 'dataBlock',
  'datablockversion': 'dataBlockVersion',
  'datablock-version': 'dataBlockVersion',
  'datablock_version': 'dataBlockVersion',

  // groups + versions
  group: 'group',
  'groupversion': 'groupVersion',
  'group-version': 'groupVersion',
  'group_version': 'groupVersion',

  // graph pieces
  node: 'node',
  edge: 'edge',
  'startnode': 'startNode',
  'start-node': 'startNode',
  'endnode': 'endNode',
  'end-node': 'endNode',
  'dynnode': 'dynNode',
  'dyn-node': 'dynNode',

  // io
  input: 'input',
  output: 'output',
  'tuplemember': 'tupleMember',
  'tuple-member': 'tupleMember',
  'inputtuple': 'inputTuple',
  'input-tuple': 'inputTuple',
  'outputtuple': 'outputTuple',
  'output-tuple': 'outputTuple',
  'queryinputtuple': 'inputTuple',
  'queryoutputtuple': 'outputTuple',
  'triplesquadsio': 'triplesQuadsIO',
  'booleanio': 'booleanIO',
  'queryidinput': 'queryIdInput',
  'limitparam': 'limitParam',
  'limit-param': 'limitParam',
  'offsetparam': 'offsetParam',
  'offset-param': 'offsetParam',
  'rdfoutput': 'rdfOutput',
  'rdf-output': 'rdfOutput',
  'triples-quads-io': 'triplesQuadsIO',
  'controlflowio': 'controlFlowIO',
  'control-flow-io': 'controlFlowIO',
  'argumentset': 'argumentSet',
  'argument-set': 'argumentSet',
  'argumentsetversion': 'argumentSetVersion',
  'argument-set-version': 'argumentSetVersion',
  'argument-setversion': 'argumentSetVersion',
  'argumenttuplebinding': 'argumentTupleBinding',
  'argument-tuple-binding': 'argumentTupleBinding',
  'argumentscalarbinding': 'argumentScalarBinding',
  'argument-scalar-binding': 'argumentScalarBinding',
  'argumentgraphbinding': 'argumentGraphBinding',
  'argument-graph-binding': 'argumentGraphBinding',
  'benchmarkexperiment': 'benchmarkExperiment',
  'benchmark-experiment': 'benchmarkExperiment',
  'benchmarkexperimentversion': 'benchmarkExperimentVersion',
  'benchmark-experiment-version': 'benchmarkExperimentVersion',
  'benchmarkrun': 'benchmarkRun',
  'benchmark-run': 'benchmarkRun',
  'benchmarknoderun': 'benchmarkNodeRun',
  'benchmark-node-run': 'benchmarkNodeRun',
  'benchmarkiterationrun': 'benchmarkIterationRun',
  'benchmark-iteration-run': 'benchmarkIterationRun',
  'benchmarkobservation': 'benchmarkObservation',
  'benchmark-observation': 'benchmarkObservation',
  'benchmarknodeobservation': 'benchmarkNodeObservation',
  'benchmark-node-observation': 'benchmarkNodeObservation',
  'benchmarkiterationobservation': 'benchmarkIterationObservation',
  'benchmark-iteration-observation': 'benchmarkIterationObservation',

  // etl
  'etljob': 'etlJob',
  'etl-job': 'etlJob',
  'etljobversion': 'etlJobVersion',
  'etl-job-version': 'etlJobVersion',
  'etlcolumnmapping': 'etlColumnMapping',
  'etl-column-mapping': 'etlColumnMapping',
  'etlcolumnmappingversion': 'etlColumnMappingVersion',
  'etl-column-mapping-version': 'etlColumnMappingVersion',
  'etlexecution': 'etlExecution',
  'etl-execution': 'etlExecution',
  'duckdbetlnode': 'duckDbEtlNode',
  'duckdb-etl-node': 'duckDbEtlNode',

  // data graphs
  'datagraph': 'dataGraph',
  'data-graph': 'dataGraph',
  'datagraphversion': 'dataGraphVersion',
  'data-graph-version': 'dataGraphVersion',

  // tests
  'test': 'test',
  'testversion': 'testVersion',
  'test-version': 'testVersion',
  'testcase': 'testCase',
  'test-case': 'testCase',
  'testcasedatagraph': 'testCaseDataGraph',
  'test-case-data-graph': 'testCaseDataGraph',
  'testrun': 'testRun',
  'test-run': 'testRun',
  'testruncase': 'testRunCase',
  'test-run-case': 'testRunCase',
  'earlassertion': 'earlAssertion',
  'earl-assertion': 'earlAssertion',
  'earlresult': 'earlResult',
  'earl-result': 'earlResult',

  // tags
  'tag': 'tag',

  // patches
  'patch': 'patch',

  // tuple sets
  'tupleset': 'tupleSet',
  'tuple-set': 'tupleSet',
  'tuplesetversion': 'tupleSetVersion',
  'tuple-set-version': 'tupleSetVersion',

  // top-level
  backend: 'backend',
  library: 'library',
};

export function dashlessUUID(): string {
  return randomUUID().replace(/-/g, '');
}

export function getPrefix(kind: string): string {
  const key = (kind || '').toString().trim();
  const norm = key.replace(/[^a-zA-Z]/g, '').toLowerCase();
  const mapped = ALIAS_TO_KIND[norm] as KnownKind | undefined;
  let resolvedKey: KnownKind | undefined;
  if (mapped) resolvedKey = mapped;
  else if (NS[key as keyof typeof NS] !== undefined) resolvedKey = key as KnownKind;
  if (!resolvedKey) throw new Error(`Unknown id kind: ${kind}`);
  return NS[resolvedKey];
}

export function mintId(kind: string, suffix?: string): string {
  const prefix = getPrefix(kind);
  return prefix + (suffix ?? dashlessUUID());
}
