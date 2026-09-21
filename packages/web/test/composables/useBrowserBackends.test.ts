/**
 * Browser backends: what survives a reload, and what never leaves the browser.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useBrowserBackends,
  isBrowserBackendId,
  toBackend,
  BROWSER_BACKEND_PREFIX,
  type BrowserBackend,
} from '../../src/composables/useBrowserBackends';

const STORAGE_KEY = 'sparql-query-lib-browser-backends';

function stored(): unknown[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
}

beforeEach(() => {
  localStorage.clear();
  useBrowserBackends().reload();
});

describe('identifying a browser backend', () => {
  it('reads it off the id, so a projected record still validates as a Backend', () => {
    expect(isBrowserBackendId(`${BROWSER_BACKEND_PREFIX}abc`)).toBe(true);
    expect(isBrowserBackendId('urn:sqlib:backend:server-one')).toBe(false);
    expect(isBrowserBackendId(null)).toBe(false);
    expect(isBrowserBackendId(undefined)).toBe(false);
  });
});

describe('saving', () => {
  it('mints an id under the browser namespace', () => {
    const record = useBrowserBackends().save({
      name: 'Wikidata',
      description: null,
      endpoint: 'https://query.wikidata.org/sparql',
      queryMethod: null,
      headers: {},
    });
    expect(isBrowserBackendId(record.id)).toBe(true);
  });

  it('survives a reload', () => {
    useBrowserBackends().save({
      name: 'Wikidata',
      description: null,
      endpoint: 'https://query.wikidata.org/sparql',
      queryMethod: null,
      headers: {},
    });
    const fresh = useBrowserBackends();
    fresh.reload();
    expect(fresh.records.value).toHaveLength(1);
    expect(fresh.records.value[0]!.endpoint).toBe('https://query.wikidata.org/sparql');
  });

  it('replaces rather than duplicates when the id is given back', () => {
    const api = useBrowserBackends();
    const first = api.save({
      name: 'One', description: null, endpoint: 'https://e/one', queryMethod: null, headers: {},
    });
    api.save({
      id: first.id,
      name: 'Renamed', description: null, endpoint: 'https://e/one', queryMethod: null, headers: {},
    });
    expect(api.records.value).toHaveLength(1);
    expect(api.records.value[0]!.name).toBe('Renamed');
  });

  it('keeps createdAt across an edit, so the list order does not jump', () => {
    const api = useBrowserBackends();
    const first = api.save({
      name: 'One', description: null, endpoint: 'https://e/one', queryMethod: null, headers: {},
    });
    const edited = api.save({
      id: first.id,
      name: 'One', description: null, endpoint: 'https://e/two', queryMethod: null, headers: {},
    });
    expect(edited.createdAt).toBe(first.createdAt);
  });

  it('falls back to the endpoint when no name is given', () => {
    const record = useBrowserBackends().save({
      name: '   ', description: null, endpoint: 'https://e/one', queryMethod: null, headers: {},
    });
    expect(record.name).toBe('https://e/one');
  });
});

describe('removing', () => {
  it('drops it from storage too', () => {
    const api = useBrowserBackends();
    const record = api.save({
      name: 'One', description: null, endpoint: 'https://e/one', queryMethod: null, headers: {},
    });
    api.remove(record.id);
    expect(api.records.value).toHaveLength(0);
    expect(stored()).toHaveLength(0);
  });
});

describe('reading a stored blob back', () => {
  it('drops a record with no endpoint rather than offering a row that cannot run', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: `${BROWSER_BACKEND_PREFIX}x`, name: 'Broken' }])
    );
    const api = useBrowserBackends();
    api.reload();
    expect(api.records.value).toHaveLength(0);
  });

  it('drops header entries that are not strings', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: `${BROWSER_BACKEND_PREFIX}x`,
          name: 'One',
          endpoint: 'https://e/one',
          headers: { Authorization: 'Bearer t', bad: { nested: true }, '': 'blank' },
        },
      ])
    );
    const api = useBrowserBackends();
    api.reload();
    expect(api.records.value[0]!.headers).toEqual({ Authorization: 'Bearer t' });
  });

  it('survives a corrupt blob', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    const api = useBrowserBackends();
    api.reload();
    expect(api.records.value).toEqual([]);
  });
});

describe('projecting to a Backend', () => {
  const record: BrowserBackend = {
    id: `${BROWSER_BACKEND_PREFIX}x`,
    name: 'Wikidata',
    description: 'public',
    endpoint: 'https://query.wikidata.org/sparql',
    queryMethod: 'get',
    headers: { Authorization: 'Bearer secret' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  it('is an http backend, because that is what it is', () => {
    expect(toBackend(record).backendType).toBe('http');
    expect(toBackend(record).endpoint).toBe('https://query.wikidata.org/sparql');
  });

  it('never carries the headers, so nothing server-facing can receive them', () => {
    expect(JSON.stringify(toBackend(record))).not.toContain('secret');
  });
});
