import { describe, it, expect } from 'vitest';
import {
  collectionFromForm,
  emptyCollectionForm,
  firstMissing,
  formFromCollection,
  missingFields,
  freshCollectionId,
  ogcMapUrl,
  ogcServiceUrl,
  propertyColumns,
  suggestMapping,
  versionLabel,
  type QuerySignature,
} from '@/lib/ogcServiceForm';
import type { OgcServiceCollection } from '@/composables/useApiClient';

const STATIONS = {
  query: 'urn:sqlib:query:rail-stations-features',
  collectionId: 'stations',
  title: 'Stations',
  description: 'Every station.',
  mode: 'values',
  feature: { var: 'feature', base: 'https://example.org/rail/' },
  geometry: 'geom',
  params: { limit: '1', offset: '2', bbox: ['minx', 'miny', 'maxx', 'maxy'], skipGeometry: 'skip', cursor: 'after' },
  queryables: {
    name: { var: 'nameLike', type: 'string', title: 'Name' },
    zone: { var: 'zoneIn', type: 'integer', title: 'Zone', description: 'Fare zone' },
  },
  pageSize: { default: 10, max: 100 },
  extent: { spatial: [[115.76, -32.025, 115.977, -31.905]] },
  valuesQuery: 'urn:sqlib:query:rail-station-facets',
  context: {
    name: { '@id': 'https://example.org/rail/name' },
    zone: { '@id': 'https://example.org/rail/zone', '@type': 'http://www.w3.org/2001/XMLSchema#integer' },
    line: { '@id': 'https://example.org/rail/line', '@type': '@id' },
    label: { '@id': 'http://www.w3.org/2000/01/rdf-schema#label', '@language': 'en' },
  },
} as unknown as OgcServiceCollection;

describe('the collection form', () => {
  it('round-trips a stored collection, keeping the fields it has no control for', () => {
    expect(collectionFromForm(formFromCollection(STATIONS))).toEqual(STATIONS);
  });

  it('reads each JSON-LD term as the kind of value it gives', () => {
    const kinds = Object.fromEntries(formFromCollection(STATIONS).context.map((row) => [row.property, row.kind]));
    expect(kinds).toEqual({ name: 'literal', zone: 'datatype', line: 'iri', label: 'language' });
  });

  it('leaves empty fields out rather than sending blanks', () => {
    const form = { ...emptyCollectionForm(), query: 'urn:q', collectionId: ' stops ', title: 'Stops', featureVar: 'f' };
    form.queryables = [{ name: '', variable: 'x', type: 'string', title: '', description: '' }];
    form.context = [{ property: 'name', iri: ' ', kind: 'literal', datatype: '', language: '' }];
    expect(collectionFromForm(form)).toEqual({
      query: 'urn:q',
      collectionId: 'stops',
      title: 'Stops',
      mode: 'values',
      feature: { var: 'f', base: '' },
    });
  });

  it('writes a point or no geometry in place of a geometry column', () => {
    const point = { ...formFromCollection(STATIONS), geometryKind: 'point' as const, pointLon: 'lon', pointLat: 'lat' };
    expect(collectionFromForm(point)).toMatchObject({ point: ['lon', 'lat'] });
    expect(collectionFromForm(point)).not.toHaveProperty('geometry');
    const none = { ...formFromCollection(STATIONS), geometryKind: 'none' as const };
    expect(collectionFromForm(none).geometry).toBeNull();
  });

  it('sends a partly filled bbox as typed, so the server names what is missing', () => {
    const form = { ...emptyCollectionForm(), bbox: ['minx', '', '', ''] as [string, string, string, string] };
    expect(collectionFromForm(form).params).toEqual({ bbox: ['minx', '', '', ''] });
  });

  it('drops a page size that is not a whole number', () => {
    const form = { ...emptyCollectionForm(), pageSizeDefault: '10.5', pageSizeMax: '50' };
    expect(collectionFromForm(form).pageSize).toEqual({ max: 50 });
  });
});

describe('suggestMapping', () => {
  const signature: QuerySignature = {
    outputs: ['feature', 'name', 'geom'],
    valuesInputs: [['minx', 'miny', 'maxx', 'maxy'], ['skip'], ['nameLike']],
    limitParameters: ['1'],
    offsetParameters: ['2'],
  };

  it('fills the fields whose names leave no doubt', () => {
    const next = suggestMapping(emptyCollectionForm(), signature);
    expect(next).toMatchObject({
      featureVar: 'feature', geometry: 'geom', limit: '1', offset: '2', skipGeometry: 'skip',
      bbox: ['minx', 'miny', 'maxx', 'maxy'],
    });
  });

  it('leaves a field already set alone', () => {
    const next = suggestMapping({ ...emptyCollectionForm(), featureVar: 'name', limit: '9' }, signature);
    expect(next.featureVar).toBe('name');
    expect(next.limit).toBe('9');
  });

  it('offers every output but the feature and geometry columns as a JSON-LD property', () => {
    const form = { ...emptyCollectionForm(), featureVar: 'feature', geometry: 'geom' };
    expect(propertyColumns(form, signature)).toEqual(['name']);
  });
});

describe('the collections table', () => {
  it('names the version a collection runs', () => {
    const numbers = new Map([['urn:v3', 3]]);
    expect(versionLabel(STATIONS, numbers)).toBe('Follows environment');
    expect(versionLabel({ ...STATIONS, queryVersion: 'urn:v3' }, numbers)).toBe('v3');
  });

  it('mints a collection id the list does not have', () => {
    expect(freshCollectionId([])).toBe('collection');
    expect(freshCollectionId(['collection', 'collection-2'])).toBe('collection-3');
  });
});

describe('service links', () => {
  it('serves a service under the API base', () => {
    expect(ogcServiceUrl('http://localhost:3000/', 'rail')).toBe('http://localhost:3000/ogc/rail');
  });

  it('links the map page only where the API runs in the browser', () => {
    const origin = 'https://example.org';
    expect(ogcMapUrl({ apiBaseUrl: 'https://example.org/demo/api', appBase: '/demo/', origin }, 'rail'))
      .toBe('/demo/map/?service=rail');
    expect(ogcMapUrl({ apiBaseUrl: 'browser', appBase: '/', origin }, 'rail')).toBe('/map/?service=rail');
    expect(ogcMapUrl({ apiBaseUrl: 'http://localhost:3000', appBase: '/', origin }, 'rail')).toBeNull();
  });
});

describe('the required fields', () => {
  it('names the empty ones of the first incomplete collection, before anything is sent', () => {
    const complete = STATIONS;
    const incomplete = { ...STATIONS, collectionId: 'stops', feature: { var: 'feature', base: '' }, title: ' ' };
    expect(missingFields(complete)).toEqual([]);
    expect(firstMissing([complete, incomplete])).toEqual({
      index: 1,
      message: 'collections[1] ("stops"): Title, Base IRI are empty',
    });
  });

  it('asks for both point columns', () => {
    expect(missingFields({ ...STATIONS, point: ['lon', ''] } as OgcServiceCollection)).toEqual(['Latitude']);
  });
});
