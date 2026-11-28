import { describe, expect, it } from 'vitest';
import { extentOf, featureLabel, linkHref, offsetOf, pageRange, resolveService, withQueryables } from '../src/service';

describe('resolveService', () => {
  const page = 'https://demo.example.org/site/map/';

  it('opens ?url= as given, on any server', () => {
    expect(resolveService(`${page}?url=https://other.example.org/ogc`, { service: 'rail' }, { apiBaseUrl: 'browser' }))
      .toEqual({ kind: 'url', url: 'https://other.example.org/ogc' });
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

describe('items URLs', () => {
  it('adds queryable values once encoded and drops blank ones', () => {
    const url = withQueryables('https://x.org/items?limit=10&name=old', { name: 'King St & 5th', zone: ' ' });
    expect(url).toBe('https://x.org/items?limit=10&name=King+St+%26+5th');
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
