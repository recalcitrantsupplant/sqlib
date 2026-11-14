/**
 * An ETL job version whose template is a saved query.
 *
 * `templateQuery` names a QueryVersion (pinned) or a Query (floating to its
 * current version). These cover the resolver, the checks on a new version,
 * the run record of a floating reference, and the pin a reference holds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { QueryTypeIri } from '@sparql-query-lib/types';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const hoisted = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
  streamChunks: vi.fn(),
  applyArguments: vi.fn(),
  constructQueryParsed: vi.fn(),
}));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: (id: string) => hoisted.entities.get(id) ?? null,
    list: (type: string) => Array.from(hoisted.entities.values()).filter((e) => e['@type'] === type),
    create: async (type: string, entity: Record<string, unknown>) => {
      hoisted.entities.set(entity.$id as string, { '@type': type, ...entity });
      return entity;
    },
    update: async (_type: string, id: string, patch: Record<string, unknown>) => {
      const existing = hoisted.entities.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      hoisted.entities.set(id, updated);
      return updated;
    },
  }),
} as never);

vi.mock('../../src/lib/DuckDbService.js', () => ({
  duckDbService: { streamChunks: hoisted.streamChunks },
  mapDuckDbTypeToXsd: () => 'http://www.w3.org/2001/XMLSchema#string',
}));

vi.mock('../../src/lib/parser.js', () => ({
  SparqlQueryParser: vi.fn(function () {
    return { applyArguments: hoisted.applyArguments };
  }),
}));

vi.mock('../../src/lib/orchestration/ExecutorFactory.js', () => ({
  ExecutorFactory: vi.fn(function () {
    return { getExecutorForBackendId: async () => ({ constructQueryParsed: hoisted.constructQueryParsed }) };
  }),
}));

const { EtlService } = await import('../../src/lib/EtlService.js');
const { resolveEtlTemplate, EtlTemplateError } = await import('../../src/lib/etlTemplate.js');
const { pinsOn } = await import('../../src/lib/versionPins.js');

const CONSTRUCT = QueryTypeIri.construct;
const SELECT = QueryTypeIri.select;

const LIBRARY = 'urn:sqlib:library:lib';
const OTHER_LIBRARY = 'urn:sqlib:library:other';
const QUERY = 'urn:sqlib:query:people';
const QV1 = 'urn:sqlib:query-version:people-1';
const QV2 = 'urn:sqlib:query-version:people-2';
const JOB = 'urn:sqlib:etl-job:job-1';
const MAPPING = 'urn:sqlib:etl-column-mapping-version:mapping-1';

const TEXT_V1 = 'CONSTRUCT { ?s a <urn:v1> } WHERE { VALUES (?s) { (UNDEF) } }';
const TEXT_V2 = 'CONSTRUCT { ?s a <urn:v2> } WHERE { VALUES (?s) { (UNDEF) } }';

function put(entity: Record<string, unknown>) {
  hoisted.entities.set(entity.$id as string, entity);
}

const lookup = (id: string) => (hoisted.entities.get(id) as never) ?? null;

beforeEach(async () => {
  hoisted.entities.clear();
  vi.clearAllMocks();
  put({ $id: LIBRARY, '@type': 'Library', name: 'Lib' });
  put({ $id: OTHER_LIBRARY, '@type': 'Library', name: 'Other' });
  put({ $id: QUERY, '@type': 'Query', name: 'People', isPartOf: [LIBRARY], currentVersion: QV2 });
  put({ $id: QV1, '@type': 'QueryVersion', isPartOf: QUERY, version: 1, queryString: TEXT_V1, queryType: CONSTRUCT });
  put({ $id: QV2, '@type': 'QueryVersion', isPartOf: QUERY, version: 2, queryString: TEXT_V2, queryType: CONSTRUCT });
  put({ $id: JOB, '@type': 'EtlJob', name: 'Job', isPartOf: [LIBRARY] });
  put({
    $id: MAPPING,
    '@type': 'EtlColumnMappingVersion',
    columns: JSON.stringify([{ columnName: 's', targetVariable: 's', termType: 'uri', nullPolicy: 'undef' }]),
  });
});

describe('resolveEtlTemplate', () => {
  it('reads inline text, with no query version', () => {
    expect(resolveEtlTemplate({ sparqlTemplate: TEXT_V1 }, lookup)).toEqual({
      text: TEXT_V1, queryVersionId: null, queryId: null, floating: false,
    });
  });

  it('reads a pinned query version', () => {
    expect(resolveEtlTemplate({ templateQuery: QV1 }, lookup)).toEqual({
      text: TEXT_V1, queryVersionId: QV1, queryId: QUERY, floating: false,
    });
  });

  it('floats a query reference to its current version', () => {
    expect(resolveEtlTemplate({ templateQuery: QUERY }, lookup)).toMatchObject({
      text: TEXT_V2, queryVersionId: QV2, floating: true,
    });
    hoisted.entities.set(QUERY, { ...hoisted.entities.get(QUERY)!, currentVersion: QV1 });
    expect(resolveEtlTemplate({ templateQuery: QUERY }, lookup).queryVersionId).toBe(QV1);
  });

  it('refuses a version that is not a CONSTRUCT', () => {
    put({ $id: QV2, '@type': 'QueryVersion', isPartOf: QUERY, version: 2, queryString: 'SELECT * {}', queryType: SELECT });
    expect(() => resolveEtlTemplate({ templateQuery: QUERY }, lookup)).toThrow(EtlTemplateError);
  });

  it('refuses a reference that does not exist, or is another kind of entity', () => {
    expect(() => resolveEtlTemplate({ templateQuery: 'urn:sqlib:query:gone' }, lookup)).toThrow(/does not exist/);
    expect(() => resolveEtlTemplate({ templateQuery: JOB }, lookup)).toThrow(/query or a query version/);
  });
});

describe('EtlService.createEtlJobVersion with templateQuery', () => {
  const service = new EtlService();
  const base = { sql: 'SELECT 1 AS s', backendId: 'urn:sqlib:backend:b' };

  it('stores the reference and no text, and reports the resolved text', async () => {
    const detail = await service.createEtlJobVersion('job-1', { ...base, templateQuery: QUERY });
    expect(detail.templateQuery).toBe(QUERY);
    expect(detail.templateQueryVersion).toBe(QV2);
    expect(detail.sparqlTemplate).toBe(TEXT_V2);

    const stored = Array.from(hoisted.entities.values()).find((e) => e['@type'] === 'EtlJobVersion')!;
    expect(stored.templateQuery).toBe(QUERY);
    expect(stored.sparqlTemplate).toBeUndefined();
  });

  it('refuses both a template and a query, and neither', async () => {
    await expect(service.createEtlJobVersion('job-1', { ...base, sparqlTemplate: TEXT_V1, templateQuery: QV1 }))
      .rejects.toThrow(/not both/);
    await expect(service.createEtlJobVersion('job-1', { ...base })).rejects.toThrow(/sparqlTemplate or templateQuery/);
  });

  it('refuses a query from another library', async () => {
    hoisted.entities.set(QUERY, { ...hoisted.entities.get(QUERY)!, isPartOf: [OTHER_LIBRARY] });
    await expect(service.createEtlJobVersion('job-1', { ...base, templateQuery: QV1 }))
      .rejects.toThrow(/not in the library of this ETL job/);
  });

  it('still takes inline text', async () => {
    const detail = await service.createEtlJobVersion('job-1', { ...base, sparqlTemplate: TEXT_V1 });
    expect(detail.sparqlTemplate).toBe(TEXT_V1);
    expect(detail.templateQuery).toBeUndefined();
  });
});

describe('EtlService.executeEtlJob with a floating templateQuery', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'etl-output-'));
    process.env.ETL_OUTPUT_DIR = outputDir;
    hoisted.streamChunks.mockImplementation(async function* () {
      yield { rows: [{ s: 'urn:x' }], timing: { initMs: 0, connectionMs: 0, queryMs: 0, serializeMs: 0, totalMs: 0 } };
    });
    hoisted.applyArguments.mockImplementation((text: string) => text);
    hoisted.constructQueryParsed.mockResolvedValue({ result: '<urn:x> a <urn:v2> .', contentType: 'application/n-triples' });
  });

  afterEach(async () => {
    delete process.env.ETL_OUTPUT_DIR;
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('runs the current version and records which one it was', async () => {
    const service = new EtlService();
    const created = await service.createEtlJobVersion('job-1', {
      sql: 'SELECT 1 AS s', backendId: 'urn:sqlib:backend:b', templateQuery: QUERY,
    });
    const versionUrn = `urn:sqlib:etl-job-version:${created.id}`;
    hoisted.entities.set(versionUrn, { ...hoisted.entities.get(versionUrn)!, currentColumnMappingVersion: MAPPING });

    const result = await service.executeEtlJob('job-1', {}, { internal: true });
    expect(result.status).toBe('completed');
    expect(result.templateQueryVersion).toBe(QV2);
    expect(hoisted.applyArguments.mock.calls[0][0]).toBe(TEXT_V2);

    const execution = await service.getExecution(result.executionId!);
    expect(execution?.templateQueryVersion).toBe(QV2);

    // A new query version moves the next run, and the first run's record keeps v2.
    const QV3 = 'urn:sqlib:query-version:people-3';
    put({ $id: QV3, '@type': 'QueryVersion', isPartOf: QUERY, version: 3, queryString: TEXT_V1, queryType: CONSTRUCT });
    hoisted.entities.set(QUERY, { ...hoisted.entities.get(QUERY)!, currentVersion: QV3 });
    const second = await service.executeEtlJob('job-1', {}, { internal: true });
    expect(second.templateQueryVersion).toBe(QV3);
    expect((await service.getExecution(result.executionId!))?.templateQueryVersion).toBe(QV2);
  });
});

describe('pinsOn for an ETL job version', () => {
  it('holds a pinned query version', () => {
    put({ $id: 'urn:sqlib:etl-job-version:a', '@type': 'EtlJobVersion', isPartOf: JOB, templateQuery: QV1 });
    expect(pinsOn([QV1, QV2]).map((pin) => [pin.version, pin.heldByType, pin.holderName]))
      .toEqual([[QV1, 'EtlJobVersion', 'Job']]);
  });

  it('holds the current version of a floating query', () => {
    put({ $id: 'urn:sqlib:etl-job-version:b', '@type': 'EtlJobVersion', isPartOf: JOB, templateQuery: QUERY });
    expect(pinsOn([QV1])).toEqual([]);
    expect(pinsOn([QV1, QV2]).map((pin) => pin.version)).toEqual([QV2]);
  });
});
