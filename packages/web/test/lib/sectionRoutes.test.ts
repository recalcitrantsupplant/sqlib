import { describe, it, expect } from 'vitest';
import {
  isScratchId,
  legacyRedirect,
  parseSectionRoute,
  sectionPath,
  ROUTED_SECTIONS,
} from '@/lib/sectionRoutes';

describe('section routes', () => {
  it('puts a section and its record in the path, the id encoded', () => {
    expect(sectionPath({ section: null, id: null })).toBe('/');
    expect(sectionPath({ section: 'queries', id: null })).toBe('/queries');
    expect(sectionPath({ section: 'queries', id: 'urn:sqlib:query:1' })).toBe('/queries/urn%3Asqlib%3Aquery%3A1');
  });

  it('reads back what it writes', () => {
    const id = 'https://example.org/q#1';
    const path = sectionPath({ section: 'rules', id });
    const [, section, encoded] = path.split('/');
    expect(parseSectionRoute({ section, id: decodeURIComponent(encoded!) })).toEqual({ section: 'rules', id });
  });

  it('refuses a first segment that names no section, and is the splash with none', () => {
    expect(parseSectionRoute({ section: 'nonsense' })).toBeUndefined();
    expect(parseSectionRoute({})).toEqual({ section: null, id: null });
  });

  it('routes every workspace section and none of the screens', () => {
    expect(ROUTED_SECTIONS).toContain('backends');
    expect(ROUTED_SECTIONS).not.toContain('notebooks');
    expect(ROUTED_SECTIONS).not.toContain('mcp');
  });

  it('tells an unsaved record by its id', () => {
    expect(isScratchId('urn:ui-temp:abc')).toBe(true);
    expect(isScratchId('urn:sqlib:query:1')).toBe(false);
  });
});

describe('legacyRedirect — old links keep working', () => {
  it.each([
    [{ section: 'queries' }, '/queries'],
    [{ query: 'urn:q:1', section: 'queries' }, '/queries/urn%3Aq%3A1'],
    [{ queryGroup: 'urn:g:1' }, '/queryGroups/urn%3Ag%3A1'],
    [{ ruleSet: 'urn:r:1' }, '/rules/urn%3Ar%3A1'],
    [{ etlJob: 'urn:e:1' }, '/etl/urn%3Ae%3A1'],
    [{ test: 'urn:t:1' }, '/tests/urn%3At%3A1'],
    [{ dataGraph: 'urn:d:1' }, '/dataGraphs/urn%3Ad%3A1'],
    [{ tupleSet: 'urn:ts:1' }, '/tupleSets/urn%3Ats%3A1'],
    [{ argumentSet: 'urn:a:1' }, '/argumentSets/urn%3Aa%3A1'],
    [{ benchmark: 'urn:b:1' }, '/benchmarks/urn%3Ab%3A1'],
    [{ benchmark: 'true' }, '/benchmarks'],
    [{ playground: 'etl' }, '/etl'],
    [{ section: 'backends' }, '/backends'],
  ])('%o → %s', (query, path) => {
    expect(legacyRedirect(query)?.path).toBe(path);
  });

  it('keeps what modifies the record, and a set chosen for "Run with…"', () => {
    expect(legacyRedirect({ query: 'urn:q:1', version: '3', library: 'urn:lib:1', argumentSet: 'urn:a:1' })).toEqual({
      path: '/queries/urn%3Aq%3A1',
      query: { library: 'urn:lib:1', version: '3', argumentSet: 'urn:a:1' },
    });
  });

  it('sends a scratch link to the section it names, else to where the record lives', () => {
    expect(legacyRedirect({ scratch: 'urn:ui-temp:1', section: 'rules' })?.path).toBe('/rules/urn%3Aui-temp%3A1');
    expect(legacyRedirect({ scratch: 'urn:ui-temp:1' }, () => 'tests')?.path).toBe('/tests/urn%3Aui-temp%3A1');
    // A browser that does not hold the record has nowhere to send it.
    expect(legacyRedirect({ scratch: 'urn:ui-temp:1' })?.path).toBe('/');
  });

  it('leaves a link that was never one of these alone', () => {
    expect(legacyRedirect({})).toBeNull();
    expect(legacyRedirect({ library: 'urn:lib:1' })).toBeNull();
  });
});
