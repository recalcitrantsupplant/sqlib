import { describe, expect, it } from 'vitest';
import { nodeResultSize, nodeResultView } from '../../src/lib/nodeResult';

describe('nodeResultView', () => {
  it('reads a string result as N-Triples', () => {
    const view = nodeResultView({ nodeId: 'n', status: 'ok', result: '<a> <b> <c> .\n' });
    expect(view).toEqual({ raw: '<a> <b> <c> .\n', json: null, contentType: 'application/n-triples' });
  });

  it('reads an object result as SPARQL JSON', () => {
    const result = { head: { vars: ['x'] }, results: { bindings: [] } };
    const view = nodeResultView({ nodeId: 'n', status: 'ok', result });
    expect(view?.contentType).toBe('application/sparql-results+json');
    expect(view?.json).toBe(result);
    expect(JSON.parse(view!.raw)).toEqual(result);
  });

  it('has nothing to show for a node without a result', () => {
    expect(nodeResultView({ nodeId: 'n', status: 'failed', error: 'boom' })).toBeNull();
    expect(nodeResultView(null)).toBeNull();
  });
});

describe('nodeResultSize', () => {
  it('names triples before rows, and the singular', () => {
    expect(nodeResultSize({ nodeId: 'n', status: 'ok', tripleCount: 1, rowCount: 5 })).toBe('1 triple');
    expect(nodeResultSize({ nodeId: 'n', status: 'ok', rowCount: 12 })).toBe('12 rows');
    expect(nodeResultSize({ nodeId: 'n', status: 'ok' })).toBeNull();
  });
});
