import { describe, expect, it } from 'vitest';
import { findGeometryColumn, toFeatureCollection } from '../src/featureCollection.js';
import type { ResultTerm, SelectResults } from '../src/types.js';

const GEO = 'http://www.opengis.net/ont/geosparql#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

const iri = (value: string): ResultTerm => ({ type: 'uri', value });
const wkt = (value: string): ResultTerm => ({ type: 'literal', value, datatype: `${GEO}wktLiteral` });
const typed = (value: string, type: string): ResultTerm => ({ type: 'literal', value, datatype: `${XSD}${type}` });
const plain = (value: string): ResultTerm => ({ type: 'literal', value });

function results(vars: string[], bindings: Array<Record<string, ResultTerm>>): SelectResults {
  return { head: { vars }, results: { bindings } };
}

describe('toFeatureCollection', () => {
  it('makes one feature per row from a WKT column', () => {
    const out = toFeatureCollection(results(['feature', 'geom', 'name', 'height'], [
      { feature: iri('https://example.org/b/1'), geom: wkt('POINT (115.86 -31.95)'), name: plain('Tower'), height: typed('42', 'integer') },
      { feature: iri('https://example.org/b/2'), geom: wkt('POINT (116 -32)'), name: plain('Shed') },
    ]));
    expect(out).toEqual({
      ok: true,
      collection: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'https://example.org/b/1', geometry: { type: 'Point', coordinates: [115.86, -31.95] }, properties: { name: 'Tower', height: 42 } },
          { type: 'Feature', id: 'https://example.org/b/2', geometry: { type: 'Point', coordinates: [116, -32] }, properties: { name: 'Shed' } },
        ],
      },
    });
  });

  it('swaps axes for lat/lon CRSs and keeps CRS84', () => {
    for (const crs of ['http://www.opengis.net/def/crs/EPSG/0/4326', 'https://www.opengis.net/def/crs/EPSG/0/4283', 'http://www.opengis.net/def/crs/EPSG/0/7844']) {
      const out = toFeatureCollection(results(['geom'], [{ geom: wkt(`<${crs}> POINT (-31.95 115.86)`) }]));
      expect(out.ok && out.collection.features[0]!.geometry, crs).toEqual({ type: 'Point', coordinates: [115.86, -31.95] });
    }
    const crs84 = toFeatureCollection(results(['geom'], [{ geom: wkt('<http://www.opengis.net/def/crs/OGC/1.3/CRS84> POINT (115.86 -31.95)') }]));
    expect(crs84.ok && crs84.collection.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [115.86, -31.95] });
  });

  it('swaps every position of a polygon', () => {
    const out = toFeatureCollection(results(['geom'], [{ geom: wkt('<http://www.opengis.net/def/crs/EPSG/0/4326> POLYGON ((0 1, 2 3, 4 5, 0 1))') }]));
    expect(out.ok && out.collection.features[0]!.geometry).toEqual({ type: 'Polygon', coordinates: [[[1, 0], [3, 2], [5, 4], [1, 0]]] });
  });

  it('refuses a CRS it does not know', () => {
    const out = toFeatureCollection(results(['geom'], [{ geom: wkt('<http://www.opengis.net/def/crs/EPSG/0/28350> POINT (391000 6466000)') }]));
    expect(out).toMatchObject({ ok: false, reason: 'unsupported-crs' });
    expect(!out.ok && out.detail).toContain('EPSG/0/28350');
  });

  it('reports invalid WKT and invalid GeoJSON with the row', () => {
    const bad = toFeatureCollection(results(['geom'], [{ geom: wkt('POINT (1 2)') }, { geom: wkt('POINT (1') }]));
    expect(bad).toMatchObject({ ok: false, reason: 'invalid-geometry' });
    expect(!bad.ok && bad.detail).toContain('Row 2');
    const json = toFeatureCollection(results(['g'], [{ g: { type: 'literal', value: '{nope', datatype: `${GEO}geoJSONLiteral` } }]));
    expect(json).toMatchObject({ ok: false, reason: 'invalid-geometry' });
  });

  it('passes a geoJSONLiteral through', () => {
    const geometry = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
    const out = toFeatureCollection(results(['g'], [{ g: { type: 'literal', value: JSON.stringify(geometry), datatype: `${GEO}geoJSONLiteral` } }]));
    expect(out.ok && out.collection.features[0]!.geometry).toEqual(geometry);
  });

  it('gives null geometry for an unbound value and for EMPTY', () => {
    const out = toFeatureCollection(results(['feature', 'geom'], [
      { feature: iri('urn:a'), geom: wkt('POINT (1 2)') },
      { feature: iri('urn:b') },
      { feature: iri('urn:c'), geom: wkt('POINT EMPTY') },
    ]));
    expect(out.ok && out.collection.features.map(f => f.geometry)).toEqual([{ type: 'Point', coordinates: [1, 2] }, null, null]);
  });

  it('makes points from lat/long columns', () => {
    const out = toFeatureCollection(results(['id', 'lat', 'long'], [{ id: typed('7', 'integer'), lat: typed('-31.95', 'decimal'), long: typed('115.86', 'decimal') }]));
    expect(out.ok && out.collection.features[0]).toEqual({ type: 'Feature', id: 7, geometry: { type: 'Point', coordinates: [115.86, -31.95] }, properties: {} });
  });

  it('uses pointVars in the order given', () => {
    const out = toFeatureCollection(results(['x', 'y'], [{ x: typed('1', 'double'), y: typed('2', 'double') }]), { pointVars: ['x', 'y'] });
    expect(out.ok && out.collection.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [1, 2] });
  });

  it('refuses a result with no geometry column', () => {
    const out = toFeatureCollection(results(['s', 'label'], [{ s: iri('urn:a'), label: plain('A') }]));
    expect(out).toMatchObject({ ok: false, reason: 'no-geometry-column' });
    expect(findGeometryColumn(results(['s'], [{ s: iri('urn:a') }]))).toBeNull();
  });

  it('leaves geometry out with noGeometry, and keeps the geometry column out of properties', () => {
    const rows = results(['feature', 'geom', 'name'], [{ feature: iri('urn:a'), geom: wkt('POINT (1 2)'), name: plain('A') }]);
    const out = toFeatureCollection(rows, { noGeometry: true, geometryVar: 'geom' });
    expect(out.ok && out.collection.features[0]).toEqual({ type: 'Feature', id: 'urn:a', geometry: null, properties: { name: 'A' } });
    const none = toFeatureCollection(results(['feature', 'name'], [{ feature: iri('urn:a'), name: plain('A') }]), { noGeometry: true });
    expect(none.ok).toBe(true);
  });

  it('honours idVar, omitVars and idFromIri', () => {
    const rows = results(['b', 'geom', 'cursor', 'score'], [{ b: iri('https://example.org/b/9'), geom: wkt('POINT (1 2)'), cursor: plain('abc'), score: typed('1.5', 'float') }]);
    const out = toFeatureCollection(rows, {
      idVar: 'b',
      omitVars: ['cursor'],
      idFromIri: value => value.replace('https://example.org/b/', ''),
    });
    expect(out.ok && out.collection.features[0]).toEqual({ type: 'Feature', id: '9', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { score: 1.5 } });
  });

  it('picks the first IRI column for the id when there is no feature or id column', () => {
    const out = toFeatureCollection(results(['geom', 'thing'], [{ geom: wkt('POINT (1 2)'), thing: iri('urn:t') }]));
    expect(out.ok && out.collection.features[0]!.id).toBe('urn:t');
  });

  it('leaves the id out when its column is unbound', () => {
    const out = toFeatureCollection(results(['feature', 'geom'], [{ geom: wkt('POINT (1 2)') }]));
    expect(out.ok && 'id' in out.collection.features[0]!).toBe(false);
  });
});
