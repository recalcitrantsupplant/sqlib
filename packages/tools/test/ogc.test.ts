import { describe, expect, it } from 'vitest';
import {
  OgcRequestError,
  checkOgcObject,
  combineCql,
  cqlBboxClause,
  cqlComparisons,
  cqlDatetimeClauses,
  cqlProperties,
  ogcParamKinds,
  parseBbox,
  parseCql2Json,
  parseDatetime,
  parseLimit,
  parseOffset,
  renameCqlProperties,
  type OgcCheckContext,
  type OgcObject,
} from '../src/ogc.js';

const valuesContext: OgcCheckContext = {
  isSelect: true,
  inputs: {
    tables: [['feature'], ['minx', 'miny', 'maxx', 'maxy'], ['start', 'end'], ['skip'], ['state']],
    limits: ['1'],
    offsets: ['2'],
  },
  outputs: ['feature', 'name', 'wkt', 'state'],
};

const valuesOgc: OgcObject = {
  collectionId: 'parcels',
  title: 'Parcels',
  mode: 'values',
  feature: { var: 'feature', base: 'https://example.org/parcel/' },
  geometry: 'wkt',
  params: {
    limit: '1',
    offset: '2',
    bbox: ['minx', 'miny', 'maxx', 'maxy'],
    datetime: ['start', 'end'],
    skipGeometry: 'skip',
  },
  queryables: { state: { type: 'string' } },
};

const cqlContext: OgcCheckContext = {
  isSelect: true,
  inputs: { tables: [['feature'], ['filter', 'limit', 'after'], ['skip']], limits: [], offsets: [] },
  outputs: ['feature', 'wkt', 'total', 'cursor', 'name'],
};

const cqlOgc: OgcObject = {
  collectionId: 'sites',
  title: 'Sites',
  mode: 'cql2',
  feature: { var: 'feature', base: 'https://example.org/site/' },
  geometry: 'wkt',
  params: { filter: 'filter', limit: 'limit', cursor: 'after', skipGeometry: 'skip' },
  outputs: { numberMatched: 'total', nextCursor: 'cursor' },
  cql: { geometryField: 'https://example.org/field/geom', fields: { name: 'https://example.org/field/name' } },
  queryables: { name: { type: 'string' } },
};

describe('checkOgcObject', () => {
  it('accepts a values collection and a cql2 collection', () => {
    expect(checkOgcObject(valuesOgc, valuesContext)).toBeNull();
    expect(checkOgcObject(cqlOgc, cqlContext)).toBeNull();
  });

  it('accepts a collection with no geometry', () => {
    const { skipGeometry: _skip, ...params } = valuesOgc.params!;
    expect(checkOgcObject({ ...valuesOgc, geometry: null, params }, valuesContext)).toBeNull();
  });

  it.each([
    [{ ...valuesOgc, collectionId: 'has space' }, 'collectionId'],
    [{ ...valuesOgc, mode: 'sparql' }, 'ogc.mode'],
    [{ ...valuesOgc, feature: { var: 'nope', base: 'https://example.org/' } }, 'ogc.feature.var'],
    [{ ...valuesOgc, feature: { var: 'feature', base: 'not an iri' } }, 'ogc.feature.base'],
    [{ ...valuesOgc, geometry: undefined }, 'ogc.geometry'],
    [{ ...valuesOgc, geometry: 'missing' }, 'ogc.geometry'],
    [{ ...valuesOgc, point: ['lon', 'lat'] }, 'not both'],
    [{ ...valuesOgc, params: { ...valuesOgc.params, limit: undefined } }, 'ogc.params.limit'],
    [{ ...valuesOgc, params: { ...valuesOgc.params, limit: '9' } }, 'ogc.params.limit'],
    [{ ...valuesOgc, params: { ...valuesOgc.params, bbox: ['minx', 'miny', 'maxx', 'start'] } }, 'ogc.params.bbox'],
    [{ ...valuesOgc, params: { ...valuesOgc.params, filter: 'x' } }, 'only a cql2 collection'],
    [{ ...valuesOgc, queryables: { bbox: { type: 'string' } } }, 'OGC parameter name'],
    [{ ...valuesOgc, queryables: { state: {} } }, 'type is required'],
    [{ ...valuesOgc, queryables: { other: { type: 'string' } } }, 'not a VALUES parameter'],
    [{ ...valuesOgc, queryables: { state: { type: 'string', var: 'feature' } } }, 'already used'],
    [{ ...valuesOgc, pageSize: { default: 50, max: 20 } }, 'ogc.pageSize'],
    [{ ...valuesOgc, extent: { spatial: [[1, 2, 3]] } }, 'ogc.extent.spatial'],
  ])('refuses a bad values object (%#)', (ogc, message) => {
    expect(checkOgcObject(ogc, valuesContext)).toContain(message);
  });

  it.each([
    [{ ...cqlOgc, params: { ...cqlOgc.params, bbox: ['a', 'b', 'c', 'd'] } }, 'sends bbox to the index'],
    [{ ...cqlOgc, params: { ...cqlOgc.params, filter: undefined } }, 'ogc.params.filter'],
    [{ ...cqlOgc, params: { ...cqlOgc.params, cursor: undefined } }, 'needs ogc.params.cursor'],
    [{ ...cqlOgc, cql: undefined }, 'ogc.cql must be an object'],
    [{ ...cqlOgc, cql: {} }, 'geometryField'],
    [{ ...cqlOgc, queryables: { name: { var: 'name' } } }, 'index field'],
    [{ ...cqlOgc, outputs: { numberMatched: 'nope' } }, 'ogc.outputs.numberMatched'],
  ])('refuses a bad cql2 object (%#)', (ogc, message) => {
    expect(checkOgcObject(ogc, cqlContext)).toContain(message);
  });

  it('refuses anything but a SELECT', () => {
    expect(checkOgcObject(valuesOgc, { ...valuesContext, isSelect: false })).toContain('SELECT');
  });
});

describe('ogcParamKinds', () => {
  it('gives each filled variable its kind', () => {
    expect(ogcParamKinds(valuesOgc)).toEqual({
      feature: { kind: 'iri' },
      minx: { kind: 'decimal' },
      miny: { kind: 'decimal' },
      maxx: { kind: 'decimal' },
      maxy: { kind: 'decimal' },
      start: { kind: 'dateTime' },
      end: { kind: 'dateTime' },
      '1': { kind: 'integer' },
      '2': { kind: 'integer' },
      skip: { kind: 'boolean' },
      state: { kind: 'string' },
    });
  });

  it('leaves cql2 queryables out: they go in the filter', () => {
    expect(Object.keys(ogcParamKinds(cqlOgc)).sort()).toEqual(['after', 'feature', 'filter', 'limit', 'skip']);
  });
});

describe('OGC parameters', () => {
  it('reads a bbox', () => {
    expect(parseBbox('110,-45, 155,-10')).toEqual([110, -45, 155, -10]);
    expect(() => parseBbox('1,2,3')).toThrow(OgcRequestError);
    expect(() => parseBbox('1,2,3,4,5,6')).toThrow(/3D/);
    expect(() => parseBbox('170,0,-170,10')).toThrow(/antimeridian/);
    expect(() => parseBbox('0,10,1,5')).toThrow(/latitudes/);
  });

  it('reads a datetime instant and interval', () => {
    expect(parseDatetime('2020-01-01T00:00:00Z')).toEqual({ start: '2020-01-01T00:00:00Z', end: '2020-01-01T00:00:00Z' });
    expect(parseDatetime('2020-01-01/..')).toEqual({ start: '2020-01-01T00:00:00Z', end: null });
    expect(parseDatetime('/2021-06-30T12:00:00+10:00')).toEqual({ start: null, end: '2021-06-30T12:00:00+10:00' });
    expect(() => parseDatetime('../..')).toThrow(OgcRequestError);
    expect(() => parseDatetime('2021-01-01/2020-01-01')).toThrow(/after/);
    expect(() => parseDatetime('yesterday')).toThrow(/RFC 3339/);
  });

  it('reads limit and offset', () => {
    expect(parseLimit(undefined, undefined)).toBe(10);
    expect(parseLimit('50', { max: 20 })).toBe(20);
    expect(() => parseLimit('0', undefined)).toThrow(OgcRequestError);
    expect(() => parseLimit('-1', undefined)).toThrow(OgcRequestError);
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset('30')).toBe(30);
    expect(() => parseOffset('x')).toThrow(OgcRequestError);
  });
});

describe('CQL2-JSON', () => {
  const filter = { op: 'and', args: [{ op: '=', args: [{ property: 'name' }, 'Ayr'] }, { op: '>', args: [{ property: 'area' }, 3] }] };

  it('parses JSON and refuses anything else', () => {
    expect(parseCql2Json(JSON.stringify(filter))).toEqual(filter);
    expect(() => parseCql2Json('name = 1')).toThrow(/cql2-json/);
    expect(() => parseCql2Json('[1]')).toThrow(/op/);
  });

  it('lists and renames properties', () => {
    expect(cqlProperties(filter)).toEqual(['name', 'area']);
    expect(cqlComparisons(filter)).toEqual([
      { op: '=', property: 'name' },
      { op: '>', property: 'area' },
    ]);
    const renamed = renameCqlProperties(filter, name => `urn:f:${name}`);
    expect(cqlProperties(renamed)).toEqual(['urn:f:name', 'urn:f:area']);
  });

  it('builds bbox, datetime and combined clauses', () => {
    expect(cqlBboxClause('g', [1, 2, 3, 4])).toEqual({ op: 's_intersects', args: [{ property: 'g' }, { bbox: [1, 2, 3, 4] }] });
    expect(cqlDatetimeClauses('t', { start: 'a', end: null })).toEqual([{ op: '>=', args: [{ property: 't' }, { timestamp: 'a' }] }]);
    expect(cqlDatetimeClauses('t', { start: 'a', end: 'a' })).toEqual([{ op: '=', args: [{ property: 't' }, { timestamp: 'a' }] }]);
    expect(combineCql([])).toBeNull();
    expect(combineCql([filter])).toBe(filter);
    expect(combineCql([1, 2])).toEqual({ op: 'and', args: [1, 2] });
  });
});
