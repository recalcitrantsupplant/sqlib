import { describe, expect, it } from 'vitest';
import { extentOf, featureLabel, linkHref, offsetOf, pageRange, resolveService, sparqlUrl, withQueryables, facetsOf, withFacets } from '../src/service';

describe('resolveService', () => {
  const page = 'https://demo.example.org/site/map/';

  it('opens ?url= as given, on any server', () => {
    expect(resolveService(`${page}?url=https://other.example.org/ogc`, { service: 'rail' }, { apiBaseUrl: 'browser' }))
      .toEqual({ kind: 'url', url: 'https://other.example.org/ogc' });
  });

  it('uses the API in the tab for a ?url= under ../api', () => {
    expect(resolveService(`${page}?url=https://demo.example.org/site/api/ogc/rail`, null, { apiBaseUrl: 'browser' }))
      .toEqual({ kind: 'browser', url: 'https://demo.example.org/site/api/ogc/rail' });
    expect(resolveService(`${page}?url=https://demo.example.org/site/api/ogc/rail`, null, { apiBaseUrl: 'https://api.example.org' }))
      .toEqual({ kind: 'url', url: 'https://demo.example.org/site/api/ogc/rail' });
  });

  it('puts the service under ../api when the API runs in the tab', () => {
    expect(resolveService(page, { service: 'rail' }, { apiBaseUrl: 'browser' }))
      .toEqual({ kind: 'browser', url: 'https://demo.example.org/site/api/ogc/rail' });
  });

  it('puts the service under the API URL of a server', () => {
    expect(resolveService(`${page}?service=birds`, { service: 'rail' }, { apiBaseUrl: 'https://api.example.org/' }))
      .toEqual({ kind: 'api', apiBaseUrl: 'https://api.example.org/', url: 'https://api.example.org/ogc/birds' });
  });

  it('gives null with no service or no API', () => {
    expect(resolveService(page, null, { apiBaseUrl: 'browser' })).toBeNull();
    expect(resolveService(page, { service: 'rail' }, null)).toBeNull();
  });
});

describe('facets', () => {
  it('reads the properties with an enum, with their counts', () => {
    const doc = { properties: {
      name: { title: 'Name', type: 'string' },
      zone: { title: 'Zone', enum: [1, 2, 3], 'x-counts': [6, 5, 5] },
    } };
    expect(facetsOf(doc)).toEqual([{ name: 'zone', title: 'Zone', values: [{ value: 1, count: 6 }, { value: 2, count: 5 }, { value: 3, count: 5 }] }]);
  });

  it('puts the chosen values in one CQL2-JSON filter, and removes it with no choice', () => {
    const one = new URL(withFacets('https://x.org/items?limit=10', { zone: [1, 2], stepFree: [] }));
    expect(JSON.parse(one.searchParams.get('filter')!)).toEqual({ op: 'in', args: [{ property: 'zone' }, [1, 2]] });
    expect(one.searchParams.get('filter-lang')).toBe('cql2-json');
    const two = new URL(withFacets(one.href, { zone: [1], stepFree: [true] }));
    expect(JSON.parse(two.searchParams.get('filter')!).op).toBe('and');
    expect(withFacets(two.href, {})).toBe('https://x.org/items?limit=10');
  });
});

describe('items URLs', () => {
  it('adds queryable values once encoded and drops blank ones', () => {
    const url = withQueryables('https://x.org/items?limit=10&name=old', { name: 'King St & 5th', zone: ' ' });
    expect(url).toBe('https://x.org/items?limit=10&name=King+St+%26+5th');
  });

  it('asks for the SPARQL of the same page', () => {
    expect(sparqlUrl('https://x.org/c/s/sparql', 'https://x.org/c/s/items?name=Cen&offset=10&limit=10'))
      .toBe('https://x.org/c/s/sparql?name=Cen&offset=10&limit=10');
  });

  it('resolves a link relation against the page URL', () => {
    expect(linkHref([{ rel: 'next', href: 'items?offset=10' }], 'next', 'https://x.org/c/s/items')).toBe('https://x.org/c/s/items?offset=10');
    expect(linkHref([], 'prev', 'https://x.org/')).toBeNull();
  });

  it('reads the offset and labels the page range', () => {
    expect(offsetOf('https://x.org/items?offset=10&limit=10')).toBe(10);
    expect(offsetOf('https://x.org/items')).toBe(0);
    expect(pageRange(10, 6, 16)).toBe('11–16 of 16');
    expect(pageRange(0, 4, undefined)).toBe('1–4');
    expect(pageRange(0, 0, 0)).toBe('0 of 0');
  });
});

describe('collection and feature fields', () => {
  it('reads the bbox of a collection document', () => {
    expect(extentOf({ extent: { spatial: { bbox: [[115.76, -32.025, 115.977, -31.905]] } } })).toEqual([115.76, -32.025, 115.977, -31.905]);
    expect(extentOf({ extent: { spatial: { bbox: [[1, 2, 0, 3, 4, 9]] } } })).toEqual([1, 2, 3, 4]);
    expect(extentOf({})).toBeNull();
  });

  it('labels a feature by name, else by the end of its id', () => {
    expect(featureLabel({ id: 'central', properties: { name: 'Central' } })).toBe('Central');
    expect(featureLabel({ id: 'https://example.org/rail/central', properties: null })).toBe('central');
  });
});
