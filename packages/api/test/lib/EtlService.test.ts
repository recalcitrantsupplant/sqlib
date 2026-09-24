import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: hoisted.get,
    list: hoisted.list,
    create: hoisted.create,
    update: hoisted.update,
  }),
});

import { EtlService } from '../../src/lib/EtlService.js';
import type { ColumnDefinition } from '../../src/persistence/schemas/EtlColumnMappingVersionSchema.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

describe('EtlService', () => {
  let service: EtlService;
  const store = new Map<string, any>();

  beforeEach(() => {
    service = new EtlService();
    store.clear();

    hoisted.get.mockImplementation((id: string) => {
      return store.get(id) ?? null;
    });

    hoisted.list.mockImplementation((type: string) => {
      return Array.from(store.values()).filter((entity: any) => entity['@type'] === type);
    });

    hoisted.create.mockImplementation(async (_type: string, entity: any) => {
      store.set(entity.$id, entity);
      return entity;
    });

    hoisted.update.mockImplementation(async (_type: string, id: string, updates: any) => {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      store.set(id, updated);
      return updated;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createEtlJob', () => {
    it('creates a new ETL job with required fields', async () => {
      const input = {
        name: 'Customer Import',
        description: 'Import customer data from CSV',
        libraryId: 'lib1',
      };

      const result = await service.createEtlJob(input);

      expect(result).toMatchObject({
        id: expect.any(String),
        name: 'Customer Import',
        description: 'Import customer data from CSV',
        libraryIds: ['lib1'],
        dateCreated: expect.any(String),
        dateModified: expect.any(String),
      });

      const stored = store.get(`urn:sqlib:etl-job:${result.id}`);
      expect(stored).toBeDefined();
      expect(stored.$id).toBe(`urn:sqlib:etl-job:${result.id}`);
      expect(stored.name).toBe('Customer Import');
    });
  });

  describe('createEtlJobVersion', () => {
    it('creates first version with version number 1', async () => {
      store.set('urn:sqlib:etl-job:job1', {
        $id: 'urn:sqlib:etl-job:job1',
        name: 'Test Job',
        isPartOf: ['urn:sqlib:library:lib1'],
      });

      const input = {
        sql: "SELECT name, age FROM customers",
        sparqlTemplate: "CONSTRUCT { ?s :name ?name ; :age ?age } WHERE { VALUES (?name ?age) { (UNDEF UNDEF) } }",
        backendId: 'backend1',
        chunkSize: 1000,
        comment: 'Initial version',
      };

      const result = await service.createEtlJobVersion('job1', input);

      expect(result).toMatchObject({
        id: expect.any(String),
        isPartOf: 'job1',
        version: 1,
        sql: input.sql,
        sparqlTemplate: input.sparqlTemplate,
        chunkSize: 1000,
        comment: 'Initial version',
      });
    });

    it('increments version number for subsequent versions', async () => {
      store.set('urn:sqlib:etl-job:job1', {
        $id: 'urn:sqlib:etl-job:job1',
        '@type': 'EtlJob',
        name: 'Test Job',
        isPartOf: ['urn:sqlib:library:lib1'],
      });

      store.set('urn:sqlib:etl-job-version:version1', {
        $id: 'urn:sqlib:etl-job-version:version1',
        '@type': 'EtlJobVersion',
        isPartOf: 'urn:sqlib:etl-job:job1',
        version: 1,
        sql: 'old sql',
        sparqlTemplate: 'old template',
      });

      const input = {
        sql: "SELECT name, age, city FROM customers",
        sparqlTemplate: "new template",
        backendId: 'backend1',
      };

      const result = await service.createEtlJobVersion('job1', input);

      expect(result.version).toBe(2);
    });

    it('updates parent currentVersion pointer', async () => {
      store.set('urn:sqlib:etl-job:job1', {
        $id: 'urn:sqlib:etl-job:job1',
        name: 'Test Job',
        isPartOf: ['urn:sqlib:library:lib1'],
      });

      const input = {
        sql: "SELECT * FROM test",
        sparqlTemplate: "template",
        backendId: 'backend1',
      };

      const result = await service.createEtlJobVersion('job1', input);

      const job = store.get('urn:sqlib:etl-job:job1');
      expect(job.currentVersion).toBe(`urn:sqlib:etl-job-version:${result.id}`);
    });

    it('throws error if parent job not found', async () => {
      await expect(
        service.createEtlJobVersion('nonexistent', {
          sql: 'SELECT 1',
          sparqlTemplate: 'CONSTRUCT {}',
          backendId: 'backend1',
        })
      ).rejects.toThrow('ETL job not found: nonexistent');
    });
  });

  describe('createColumnMapping', () => {
    it('creates column mapping with initial version', async () => {
      store.set('urn:sqlib:etl-job-version:version1', {
        $id: 'urn:sqlib:etl-job-version:version1',
        isPartOf: 'urn:sqlib:etl-job:job1',
        version: 1,
        sql: 'SELECT name, age FROM customers',
        sparqlTemplate: 'template',
      });

      const columns: ColumnDefinition[] = [
        {
          columnName: 'name',
          targetVariable: 'customerName',
          termType: 'literal',
          datatypeIri: 'http://www.w3.org/2001/XMLSchema#string',
          nullPolicy: 'undef',
        },
        {
          columnName: 'age',
          targetVariable: 'customerAge',
          termType: 'literal',
          datatypeIri: 'http://www.w3.org/2001/XMLSchema#integer',
          nullPolicy: 'skipRow',
        },
      ];

      const result = await service.createColumnMapping('version1', {
        name: 'Customer Mapping',
        description: 'Map customer columns',
        columns,
      });

      expect(result).toMatchObject({
        id: expect.any(String),
        name: 'Customer Mapping',
        description: 'Map customer columns',
        currentVersionId: expect.any(String),
        etlJobVersionId: 'version1',
      });

      // Verify column mapping version was created
      const mappingVersion = store.get(`urn:sqlib:etl-column-mapping-version:${result.currentVersionId!}`);
      expect(mappingVersion).toBeDefined();
      expect(mappingVersion.version).toBe(1);
      expect(JSON.parse(mappingVersion.columns)).toEqual(columns);
    });

    it('updates ETL job version with currentColumnMappingVersion', async () => {
      store.set('urn:sqlib:etl-job-version:version1', {
        $id: 'urn:sqlib:etl-job-version:version1',
        isPartOf: 'urn:sqlib:etl-job:job1',
        version: 1,
        sql: 'SELECT 1',
        sparqlTemplate: 'template',
      });

      const result = await service.createColumnMapping('version1', {
        name: 'Mapping',
        columns: [],
      });

      const etlVersion = store.get('urn:sqlib:etl-job-version:version1');
      expect(etlVersion.currentColumnMappingVersion).toBe(`urn:sqlib:etl-column-mapping-version:${result.currentVersionId}`);
    });
  });

  describe('convertRowsToBindings', () => {
    it('converts DuckDB rows to SPARQL bindings using literal mappings', () => {
      const rows = [
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 30 },
      ];

      const columnDefs: ColumnDefinition[] = [
        {
          columnName: 'name',
          targetVariable: 'customerName',
          termType: 'literal',
          datatypeIri: 'http://www.w3.org/2001/XMLSchema#string',
          nullPolicy: 'undef',
        },
        {
          columnName: 'age',
          targetVariable: 'customerAge',
          termType: 'literal',
          datatypeIri: 'http://www.w3.org/2001/XMLSchema#integer',
          nullPolicy: 'undef',
        },
      ];

      const bindings = service.convertRowsToBindings(rows, columnDefs);

      expect(bindings).toHaveLength(2);
      expect(bindings[0]).toEqual({
        customerName: {
          type: 'literal',
          value: 'Alice',
          datatype: 'http://www.w3.org/2001/XMLSchema#string',
        },
        customerAge: {
          type: 'literal',
          value: '25',
          datatype: 'http://www.w3.org/2001/XMLSchema#integer',
        },
      });
    });

    /**
     * Issue #200: DuckDB's TIMESTAMP has a space where xsd:dateTime wants a `T`,
     * so the literal declared a datatype its own lexical form did not satisfy.
     * Scoped to columns mapped to xsd:dateTime, so a string column that happens
     * to look like a timestamp goes out as it was read.
     */
    it('writes a DuckDB timestamp in the lexical form xsd:dateTime declares', () => {
      const rows = [
        { seen: '2020-01-02 03:04:05', note: '2020-01-02 03:04:05' },
      ];

      const columnDefs: ColumnDefinition[] = [
        {
          columnName: 'seen',
          targetVariable: 'seen',
          termType: 'literal',
          datatypeIri: 'http://www.w3.org/2001/XMLSchema#dateTime',
          nullPolicy: 'undef',
        },
        {
          columnName: 'note',
          targetVariable: 'note',
          termType: 'literal',
          datatypeIri: 'http://www.w3.org/2001/XMLSchema#string',
          nullPolicy: 'undef',
        },
      ];

      const [binding] = service.convertRowsToBindings(rows, columnDefs);

      expect(binding.seen).toEqual({
        type: 'literal',
        value: '2020-01-02T03:04:05',
        datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
      });
      expect(binding.note).toEqual({
        type: 'literal',
        value: '2020-01-02 03:04:05',
        datatype: 'http://www.w3.org/2001/XMLSchema#string',
      });
    });

    it('converts rows to URI bindings with IRI template', () => {
      const rows = [{ customerId: '123' }];

      const columnDefs: ColumnDefinition[] = [
        {
          columnName: 'customerId',
          targetVariable: 'customer',
          termType: 'uri',
          iriTemplate: 'http://example.org/customer/{value}',
          nullPolicy: 'undef',
        },
      ];

      const bindings = service.convertRowsToBindings(rows, columnDefs);

      expect(bindings[0]).toEqual({
        customer: {
          type: 'uri',
          value: 'http://example.org/customer/123',
        },
      });
    });

    it('handles null values with undef policy by omitting from binding', () => {
      const rows = [{ name: 'Alice', age: null }];

      const columnDefs: ColumnDefinition[] = [
        {
          columnName: 'name',
          targetVariable: 'name',
          termType: 'literal',
          nullPolicy: 'undef',
        },
        {
          columnName: 'age',
          targetVariable: 'age',
          termType: 'literal',
          nullPolicy: 'undef',
        },
      ];

      const bindings = service.convertRowsToBindings(rows, columnDefs);

      expect(bindings).toHaveLength(1);
      expect(bindings[0]).toHaveProperty('name');
      expect(bindings[0]).not.toHaveProperty('age');
    });

    it('handles null values with skipRow policy by excluding entire row', () => {
      const rows = [
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: null },
        { name: 'Charlie', age: 35 },
      ];

      const columnDefs: ColumnDefinition[] = [
        {
          columnName: 'name',
          targetVariable: 'name',
          termType: 'literal',
          nullPolicy: 'undef',
        },
        {
          columnName: 'age',
          targetVariable: 'age',
          termType: 'literal',
          nullPolicy: 'skipRow',
        },
      ];

      const bindings = service.convertRowsToBindings(rows, columnDefs);

      expect(bindings).toHaveLength(2);
      expect(bindings[0].name.value).toBe('Alice');
      expect(bindings[1].name.value).toBe('Charlie');
    });

    it('adds language tag to literals when specified', () => {
      const rows = [{ description: 'Hello' }];

      const columnDefs: ColumnDefinition[] = [
        {
          columnName: 'description',
          targetVariable: 'desc',
          termType: 'literal',
          lang: 'en',
          nullPolicy: 'undef',
        },
      ];

      const bindings = service.convertRowsToBindings(rows, columnDefs);

      expect(bindings[0].desc).toEqual({
        type: 'literal',
        value: 'Hello',
        'xml:lang': 'en',
      });
    });

    it('skips invalid IRIs with warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rows = [{ id: 'invalid value' }];

      const columnDefs: ColumnDefinition[] = [
        {
          columnName: 'id',
          targetVariable: 'uri',
          termType: 'uri',
          nullPolicy: 'undef',
        },
      ];

      const bindings = service.convertRowsToBindings(rows, columnDefs);

      expect(bindings).toHaveLength(1);
      expect(bindings[0]).not.toHaveProperty('uri');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid IRI generated')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('getEtlJob', () => {
    it('returns ETL job details', async () => {
      store.set('urn:sqlib:etl-job:job1', {
        $id: 'urn:sqlib:etl-job:job1',
        name: 'Test Job',
        description: 'Test Description',
        currentVersion: 'urn:sqlib:etl-job-version:version1',
        isPartOf: ['urn:sqlib:library:lib1'],
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: '2024-01-02T00:00:00Z',
      });

      const result = await service.getEtlJob('job1');

      expect(result).toEqual({
        id: 'job1',
        name: 'Test Job',
        description: 'Test Description',
        currentVersionId: 'version1',
        libraryIds: ['lib1'],
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: '2024-01-02T00:00:00Z',
      });
    });

    it('returns null for non-existent job', async () => {
      const result = await service.getEtlJob('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getEtlJobVersion', () => {
    it('returns ETL job version details', async () => {
      store.set('urn:sqlib:etl-job-version:version1', {
        $id: 'urn:sqlib:etl-job-version:version1',
        isPartOf: 'urn:sqlib:etl-job:job1',
        version: 1,
        immutable: true,
        sql: 'SELECT * FROM test',
        sparqlTemplate: 'CONSTRUCT {}',
        backendId: 'urn:sqlib:backend:backend1',
        currentColumnMappingVersion: 'urn:sqlib:etl-column-mapping-version:mapping1',
        chunkSize: 1000,
        comment: 'Test version',
        dateCreated: '2024-01-01T00:00:00Z',
      });

      const result = await service.getEtlJobVersion('version1');

      expect(result).toEqual({
        id: 'version1',
        isPartOf: 'job1',
        version: 1,
        immutable: true,
        sql: 'SELECT * FROM test',
        sparqlTemplate: 'CONSTRUCT {}',
        backendId: 'backend1',
        currentColumnMappingVersionId: 'mapping1',
        chunkSize: 1000,
        comment: 'Test version',
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: undefined,
      });
    });
  });

  describe('getColumnMappingVersion', () => {
    it('returns column mapping version with parsed columns', async () => {
      const columns: ColumnDefinition[] = [
        {
          columnName: 'test',
          targetVariable: 'var',
          termType: 'literal',
          nullPolicy: 'undef',
        },
      ];

      store.set('urn:sqlib:etl-column-mapping-version:mapping1', {
        $id: 'urn:sqlib:etl-column-mapping-version:mapping1',
        isPartOf: 'urn:sqlib:etl-column-mapping:parent1',
        version: 1,
        columns: JSON.stringify(columns),
        dateCreated: '2024-01-01T00:00:00Z',
      });

      const result = await service.getColumnMappingVersion('mapping1');

      expect(result).toEqual({
        id: 'mapping1',
        isPartOf: 'parent1',
        version: 1,
        immutable: undefined,
        columns,
        comment: undefined,
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: undefined,
      });
    });
  });
});
