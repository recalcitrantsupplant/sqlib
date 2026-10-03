import { describe, it, expect, vi } from 'vitest';
import * as oxigraph from 'oxigraph';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import type { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import { etlService } from '../../src/lib/EtlService.js';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';
import type { ExecutionGraph, ResolvedEdge, ResolvedNode } from '../../src/lib/orchestration/types.js';
import type { ColumnDefinition } from '../../src/persistence/schemas/EtlColumnMappingVersionSchema.js';

/**
 * An ETL job is the same job run directly or as a group node (WP17).
 *
 * The engine kept its own copy of the row-to-binding conversion, and the two
 * had drifted: the node did not percent-encode a value spliced into an IRI
 * template and did not skip a value that made no IRI, so a job's triples
 * depended on which way it was run. The node now runs `EtlService.runPipeline`
 * itself, and this pins that with real DuckDB rows that exercise both rules.
 */

const MAPPING_VERSION = 'urn:sqlib:etl-column-mapping-version:1';
const COLUMNS: ColumnDefinition[] = [
  { columnName: 'name', targetVariable: 'person', termType: 'uri', iriTemplate: 'http://example.org/person/{value}', nullPolicy: 'skipRow' },
  { columnName: 'label', targetVariable: 'label', termType: 'literal', nullPolicy: 'undef' },
];

const entities: Record<string, Record<string, unknown>> = {
  [MAPPING_VERSION]: { $id: MAPPING_VERSION, '@type': 'EtlColumnMappingVersion', columns: JSON.stringify(COLUMNS) },
  'urn:io:etl-out': { '@type': 'TriplesQuadsIO' },
};

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => entities[id] ?? null }),
}));

// A name with a space and a slash, which only an encoded template turns into
// a usable IRI, and a row with no name, which the mapping skips.
const SQL = `SELECT * FROM (VALUES ('Ada Lovelace', 'first'), ('a/b', 'second'), (NULL, 'third')) AS t(name, label)`;
const TEMPLATE = `CONSTRUCT { ?person <http://example.org/label> ?label } WHERE { VALUES (?person ?label) { (UNDEF UNDEF) } }`;

const etlJobVersion = {
  $id: 'urn:sqlib:etl-job-version:1',
  '@type': 'EtlJobVersion',
  sql: SQL,
  sparqlTemplate: TEMPLATE,
  backendId: 'urn:sqlib:backend:etl',
  currentColumnMappingVersion: MAPPING_VERSION,
  chunkSize: 2,
} as unknown as NonNullable<ResolvedNode['etlJobVersion']>;

function quadsOf(text: string): string[] {
  const store = new oxigraph.Store();
  store.load(text, { format: 'nq' });
  return store.match(null, null, null, null).map(q => q.toString()).sort();
}

describe('ExecutionEngine — DuckDbEtlNode', () => {
  it('produces the same IRIs as running the job directly', async () => {
    const executor = new OxigraphSparqlExecutor(new oxigraph.Store());

    const direct: string[] = [];
    await etlService.runPipeline({
      sql: SQL,
      sparqlTemplate: TEMPLATE,
      columnDefs: COLUMNS,
      executor,
      chunkSize: 2,
      onOutput: async (rdf) => { direct.push(rdf); },
    });

    const etl: ResolvedNode = {
      id: 'etl',
      raw: { '@type': 'DuckDbEtlNode', $id: 'etl', name: 'People' } as ResolvedNode['raw'],
      backendId: undefined,
      queryVersionId: undefined,
      queryVersion: undefined,
      queryString: undefined,
      queryType: undefined,
      etlJobVersionId: etlJobVersion.$id,
      etlJobVersion,
      inputTupleIds: [],
      outputTupleIds: ['urn:io:etl-out'],
    };
    const end: ResolvedNode = {
      id: 'end',
      raw: { '@type': 'EndNode', $id: 'end', inputs: ['urn:io:etl-out'] } as ResolvedNode['raw'],
      backendId: undefined,
      queryVersionId: undefined,
      queryVersion: undefined,
      queryString: undefined,
      queryType: undefined,
      inputTupleIds: [],
      outputTupleIds: [],
    };
    const edge: ResolvedEdge = {
      id: 'e1', raw: {} as ResolvedEdge['raw'], sourceNodeId: 'etl', targetNodeId: 'end',
      dataFlowType: 'RDF_GRAPH', sourceOutputId: 'urn:io:etl-out', targetInputId: 'urn:io:etl-out',
    };
    const graph: ExecutionGraph = {
      groupVersion: {} as ExecutionGraph['groupVersion'],
      nodes: new Map([['etl', etl], ['end', end]]),
      edges: [edge],
      incomingEdges: new Map([['end', [edge]]]),
      outgoingEdges: new Map([['etl', [edge]]]),
      startNodeIds: ['etl'],
      endNodeIds: ['end'],
    };
    const factory = { getExecutorForBackendId: vi.fn().mockResolvedValue(executor) } as unknown as ExecutorFactory;

    const { result } = await new ExecutionEngine(factory).execute(graph);

    const asNode = quadsOf(result as string);
    expect(asNode).toEqual(quadsOf(direct.join('\n')));
    expect(asNode).toEqual([
      '<http://example.org/person/Ada%20Lovelace> <http://example.org/label> "first"',
      '<http://example.org/person/a%2Fb> <http://example.org/label> "second"',
    ]);
  });
});
