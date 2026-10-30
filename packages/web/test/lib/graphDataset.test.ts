/**
 * The graphs a run reads: what each picker choice sends, and how a browser
 * backend receives it.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  EMPTY_DATASET_GRAPH,
  datasetOf,
  datasetProtocolParams,
  datasetSummary,
  parseGraphIris,
} from '../../src/lib/graphDataset';
import { executeOnBrowserBackend } from '../../src/lib/browserBackendExecution';
import type { BrowserBackend } from '../../src/composables/useBrowserBackends';

const G1 = 'http://example.org/g1';
const G2 = 'http://example.org/g2';
const choice = { restricted: true, graphs: [G1], defaultGraphs: [G1], namedGraphs: [G2] };

describe('datasetOf', () => {
  it('sends nothing when the run is not restricted', () => {
    expect(datasetOf({ ...choice, restricted: false, applyTo: 'both' })).toBeNull();
  });

  it('fills the parts the choice names', () => {
    expect(datasetOf({ ...choice, applyTo: 'both' })).toEqual({ defaultGraphs: [G1], namedGraphs: [G1] });
    expect(datasetOf({ ...choice, applyTo: 'default' })).toEqual({ defaultGraphs: [G1] });
    expect(datasetOf({ ...choice, applyTo: 'named' })).toEqual({ namedGraphs: [G1] });
    expect(datasetOf({ ...choice, applyTo: 'separate' })).toEqual({ defaultGraphs: [G1], namedGraphs: [G2] });
  });

  it('keeps an empty selection, which matches nothing', () => {
    const dataset = datasetOf({ ...choice, graphs: [], applyTo: 'both' });
    expect(dataset).toEqual({ defaultGraphs: [], namedGraphs: [] });
    expect(datasetSummary(dataset)).toBe('none');
  });
});

describe('datasetSummary', () => {
  it('counts distinct graphs', () => {
    expect(datasetSummary(null)).toBe('all');
    expect(datasetSummary({ defaultGraphs: [G1], namedGraphs: [G1] })).toBe('1 graph');
    expect(datasetSummary({ defaultGraphs: [G1], namedGraphs: [G2] })).toBe('2 graphs');
  });
});

describe('parseGraphIris', () => {
  it('reads IRIs one per line, with or without angle brackets, and drops duplicates', () => {
    expect(parseGraphIris(`<${G1}>\n${G2}, ${G1}\nnot-an-iri`)).toEqual([G1, G2]);
  });
});

describe('datasetProtocolParams', () => {
  it('sends an empty part as the graph that names nothing', () => {
    const params = datasetProtocolParams({ defaultGraphs: [], namedGraphs: [G1, G2] });
    expect(params.getAll('default-graph-uri')).toEqual([EMPTY_DATASET_GRAPH]);
    expect(params.getAll('named-graph-uri')).toEqual([G1, G2]);
  });

  it('leaves an unrestricted part out', () => {
    expect(datasetProtocolParams({ namedGraphs: [G1] }).has('default-graph-uri')).toBe(false);
  });
});

describe('a browser backend run with graphs', () => {
  const backend: BrowserBackend = {
    id: 'urn:sqlib:browser-backend:x',
    name: 'Local',
    description: null,
    endpoint: 'https://example.org/sparql',
    queryMethod: null,
    headers: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const ok = () => vi.fn(async () => new Response('{}', { status: 200 }));

  it('puts the dataset on the GET URL', async () => {
    const fetchImpl = ok();
    await executeOnBrowserBackend({ backend, query: 'SELECT * {}', dataset: { defaultGraphs: [G1] } }, fetchImpl);
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.searchParams.get('default-graph-uri')).toBe(G1);
    expect(url.searchParams.get('query')).toBe('SELECT * {}');
  });

  it('puts the dataset on the POST URL', async () => {
    const fetchImpl = ok();
    await executeOnBrowserBackend(
      { backend: { ...backend, queryMethod: 'post' }, query: 'SELECT * {}', dataset: { namedGraphs: [G2] } },
      fetchImpl,
    );
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.searchParams.get('named-graph-uri')).toBe(G2);
  });

  it('sends no dataset with an update', async () => {
    const fetchImpl = ok();
    await executeOnBrowserBackend(
      { backend, query: 'INSERT DATA {}', operation: 'update', dataset: { defaultGraphs: [G1] } },
      fetchImpl,
    );
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(backend.endpoint);
  });
});
