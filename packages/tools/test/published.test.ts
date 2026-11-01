import { describe, expect, it } from 'vitest';
import {
  PublishedToolArgumentError,
  buildPublishedExecuteBody,
  checkToolObject,
  defaultToolObject,
  prefixedToolName,
  publishedInputSchema,
  publishedOpenApiDocument,
  publishedToolDefinition,
  safeToolName,
  valuesFromQueryString,
  type PublishedToolSpec,
} from '../src/published.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

/** A decision tool shaped like `pm`'s `record-decision`. */
const recordDecision: PublishedToolSpec = {
  slug: 'pm',
  libraryId: 'urn:sqlib:library:pm',
  name: 'record-decision',
  description: 'Record a decision with its rationale, before you implement it.',
  targetId: 'urn:sqlib:query-version:record-decision-3',
  targetKind: 'query',
  readOnly: false,
  params: {
    title: { kind: 'string', required: true },
    rationale: { kind: 'string' },
    affects: { kind: 'iri', list: true, description: 'the items the decision affects' },
    weight: { kind: 'integer', list: true },
    '1': { kind: 'integer' },
  },
  inputs: {
    tables: [['title', 'rationale'], ['affects', 'weight'], ['unoffered']],
    limits: ['1'],
    offsets: [],
  },
  defaultBackendId: 'urn:sqlib:backend:pm',
};

describe('buildPublishedExecuteBody', () => {
  it('runs the pinned version on the default backend, with single values as one row', () => {
    const body = buildPublishedExecuteBody(recordDecision, { title: 'Use SQLite', rationale: 'It is one file' });
    expect(body).toEqual({
      targetId: 'urn:sqlib:query-version:record-decision-3',
      backendId: 'urn:sqlib:backend:pm',
      arguments: [
        {
          head: { vars: ['title', 'rationale'] },
          results: {
            bindings: [
              { title: { type: 'literal', value: 'Use SQLite' }, rationale: { type: 'literal', value: 'It is one file' } },
            ],
          },
        },
      ],
    });
  });

  it('zips two lists in one table by position, with UNDEF past the shorter one', () => {
    const body = buildPublishedExecuteBody(recordDecision, {
      title: 'x',
      affects: ['urn:a', 'urn:b', 'urn:c'],
      weight: [1, 2],
    });
    expect(body.arguments?.[1]).toEqual({
      head: { vars: ['affects', 'weight'] },
      results: {
        bindings: [
          { affects: { type: 'uri', value: 'urn:a' }, weight: { type: 'literal', value: '1', datatype: `${XSD}integer` } },
          { affects: { type: 'uri', value: 'urn:b' }, weight: { type: 'literal', value: '2', datatype: `${XSD}integer` } },
          { affects: { type: 'uri', value: 'urn:c' } },
        ],
      },
    });
  });

  it('leaves out a table given nothing, so it runs unconstrained', () => {
    const body = buildPublishedExecuteBody(recordDecision, { title: 'x' });
    expect(body.arguments?.map(table => table.head.vars)).toEqual([['title', 'rationale']]);
  });

  it('gives an empty list one all-UNDEF row', () => {
    const body = buildPublishedExecuteBody(recordDecision, { title: 'x', affects: [] });
    expect(body.arguments?.[1].results.bindings).toEqual([{}]);
  });

  it('binds a LIMIT parameter by name, and the caller may name the backend', () => {
    const body = buildPublishedExecuteBody(recordDecision, { title: 'x', '1': 5, backendId: 'urn:other' });
    expect(body.limits).toEqual([{ name: '1', value: 5 }]);
    expect(body.backendId).toBe('urn:other');
  });

  it('refuses a missing required parameter, an unknown argument and a bad IRI, naming each', () => {
    expect(() => buildPublishedExecuteBody(recordDecision, {})).toThrow(/^title: is required$/);
    expect(() => buildPublishedExecuteBody(recordDecision, { title: 'x', colour: 'red' })).toThrow(/^colour:/);
    expect(() => buildPublishedExecuteBody(recordDecision, { title: 'x', affects: ['not an iri'] })).toThrow(
      PublishedToolArgumentError,
    );
    expect(() => buildPublishedExecuteBody(recordDecision, { title: 'x', unoffered: 'y' })).toThrow(/^unoffered:/);
  });

  it('refuses a query call with no backend when nothing defaults one', () => {
    const spec = { ...recordDecision, defaultBackendId: undefined };
    expect(() => buildPublishedExecuteBody(spec, { title: 'x' })).toThrow(
      'backendId is required: neither the query nor its library has a default backend',
    );
  });

  it('spells every kind as its RDF term', () => {
    const spec: PublishedToolSpec = {
      ...recordDecision,
      params: {
        a: { kind: 'langString' },
        b: { kind: 'decimal' },
        c: { kind: 'boolean' },
        d: { kind: 'date' },
        e: { kind: 'dateTime' },
        f: { kind: 'term' },
        g: { kind: 'term' },
        h: { kind: 'term' },
        i: { kind: 'term' },
      },
      inputs: { tables: [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']], limits: [], offsets: [] },
    };
    const body = buildPublishedExecuteBody(spec, {
      a: { value: 'chat', lang: 'fr' },
      b: 1.5,
      c: false,
      d: '2026-10-29',
      e: '2026-10-29T10:00:00Z',
      f: 'plain',
      g: { iri: 'http://example.org/x' },
      h: { value: 'colour', lang: 'en-AU' },
      i: { value: '7', datatype: `${XSD}short` },
    });
    expect(body.arguments?.[0].results.bindings[0]).toEqual({
      a: { type: 'literal', value: 'chat', 'xml:lang': 'fr' },
      b: { type: 'literal', value: '1.5', datatype: `${XSD}decimal` },
      c: { type: 'literal', value: 'false', datatype: `${XSD}boolean` },
      d: { type: 'literal', value: '2026-10-29', datatype: `${XSD}date` },
      e: { type: 'literal', value: '2026-10-29T10:00:00Z', datatype: `${XSD}dateTime` },
      f: { type: 'literal', value: 'plain' },
      g: { type: 'uri', value: 'http://example.org/x' },
      h: { type: 'literal', value: 'colour', 'xml:lang': 'en-AU' },
      i: { type: 'literal', value: '7', datatype: `${XSD}short` },
    });
  });

  it('takes no backend for a group', () => {
    const group: PublishedToolSpec = { ...recordDecision, targetKind: 'group', defaultBackendId: undefined };
    expect(buildPublishedExecuteBody(group, { title: 'x' }).backendId).toBeUndefined();
    expect(() => buildPublishedExecuteBody(group, { title: 'x', backendId: 'urn:b' })).toThrow(/^backendId:/);
  });
});

describe('publishedInputSchema', () => {
  it('has one property per parameter, plus backendId for a query, and refuses others', () => {
    const schema = publishedInputSchema(recordDecision);
    // An integer-like key (`LIMIT 0001`'s name) sorts first: JavaScript orders keys that way.
    expect(Object.keys(schema.properties as object)).toEqual(['1', 'title', 'rationale', 'affects', 'weight', 'backendId']);
    expect(schema.required).toEqual(['title']);
    expect(schema.additionalProperties).toBe(false);
    expect((schema.properties as Record<string, unknown>).affects).toEqual({
      type: 'array',
      items: { type: 'string', format: 'iri' },
      description: 'the items the decision affects',
    });
  });

  it('marks the definition read-only or not, as MCP annotations say', () => {
    const definition = publishedToolDefinition(recordDecision, prefixedToolName('pm', 'record-decision'));
    expect(definition.name).toBe('pm__record-decision');
    expect(definition.annotations).toEqual({ readOnlyHint: false });
    expect(definition.buildRequest({ title: 'x' })).toMatchObject({ method: 'POST', url: '/execute' });
  });
});

describe('checkToolObject', () => {
  const inputs = { tables: [['city']], limits: ['1'], offsets: [] };

  it('accepts params that name the inputs', () => {
    expect(
      checkToolObject({ name: 'by-city', description: 'd', params: { city: { kind: 'string' }, '1': { kind: 'integer' } } }, inputs, {
        targetKind: 'query',
      }),
    ).toBeNull();
  });

  it('names a key that is no input, and lists the inputs there are', () => {
    expect(
      checkToolObject({ name: 'by-city', description: 'd', params: { town: { kind: 'string' } } }, inputs, { targetKind: 'query' }),
    ).toBe('tool.params.town names no input of this version. Its inputs are: ?city, LIMIT 1');
  });

  it('holds a page parameter to integer, and refuses a name with a dot', () => {
    expect(
      checkToolObject({ name: 'by-city', description: 'd', params: { '1': { kind: 'string' } } }, inputs, { targetKind: 'query' }),
    ).toMatch(/^tool\.params\.1 is a LIMIT or OFFSET parameter/);
    expect(checkToolObject({ name: 'pm.by-city', description: 'd' }, inputs, { targetKind: 'query' })).toMatch(/^tool\.name/);
  });
});

describe('refusals', () => {
  const inputs = { tables: [['item']], limits: [], offsets: [] };
  const base = { name: 'settle', description: 'd', params: { item: { kind: 'iri' as const } } };

  it('takes messages keyed by the part of a flag after ?ok_, on a query only', () => {
    expect(checkToolObject({ ...base, refusals: { proposed: 'Refused.' } }, inputs, { targetKind: 'query' })).toBeNull();
    expect(checkToolObject({ ...base, refusals: { 'not-a-flag': 'x' } }, inputs, { targetKind: 'query' })).toMatch(
      /^tool\.refusals\.not-a-flag: a key is the part of a flag after "\?ok_"/,
    );
    expect(checkToolObject({ ...base, refusals: { proposed: ' ' } }, inputs, { targetKind: 'query' })).toBe(
      'tool.refusals.proposed must be a message',
    );
    expect(checkToolObject({ ...base, refusals: { proposed: 'x' } }, inputs, { targetKind: 'group' })).toMatch(
      /only a published query can have refusals/,
    );
  });

  it('documents the 409 only for a tool with refusals', () => {
    const withRefusals = { ...recordDecision, refusals: { proposed: 'Refused.' } };
    const document = publishedOpenApiDocument({ slug: 'pm', title: 'pm', specs: [withRefusals] }) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    expect(Object.keys(document.paths['/tools/pm/record-decision'].post.responses)).toEqual(['200', '400', '409']);
    const plain = publishedOpenApiDocument({ slug: 'pm', title: 'pm', specs: [recordDecision] }) as typeof document;
    expect(Object.keys(plain.paths['/tools/pm/record-decision'].post.responses)).toEqual(['200', '400']);
  });
});

describe('default tools', () => {
  it('makes a name safe and offers every input as an optional term', () => {
    expect(safeToolName('People in a city!')).toBe('People-in-a-city');
    expect(defaultToolObject({ name: 'People in a city', description: null }, { tables: [['city']], limits: ['1'], offsets: [] })).toEqual({
      name: 'People-in-a-city',
      description: 'People in a city',
      params: { city: { kind: 'term' }, '1': { kind: 'integer' } },
    });
  });
});

describe('the HTTP door', () => {
  it('reads a repeated key as a list, and JSON for a term object', () => {
    const spec: PublishedToolSpec = { ...recordDecision, params: { ...recordDecision.params, other: { kind: 'term' } } };
    expect(
      valuesFromQueryString(spec, {
        title: 'x',
        affects: ['urn:a', 'urn:b'],
        weight: '3',
        '1': '10',
        other: '{"iri":"urn:z"}',
      }),
    ).toEqual({ title: 'x', affects: ['urn:a', 'urn:b'], weight: [3], '1': 10, other: { iri: 'urn:z' } });
  });

  it('documents a reading tool as GET and a writing one as POST', () => {
    const reading = { ...recordDecision, name: 'list-decisions', readOnly: true };
    const document = publishedOpenApiDocument({ slug: 'pm', title: 'pm', specs: [recordDecision, reading] }) as {
      paths: Record<string, Record<string, { parameters?: Array<{ name: string; in: string }> }>>;
    };
    expect(Object.keys(document.paths['/tools/pm/record-decision'])).toEqual(['post']);
    expect(document.paths['/tools/pm/list-decisions'].get.parameters?.map(p => p.name)).toContain('affects');
  });
});
