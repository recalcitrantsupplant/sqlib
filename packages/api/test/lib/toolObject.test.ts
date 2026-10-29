import { describe, expect, it } from 'vitest';
import { groupInputs, queryBodyInputs, resolveVersionTool, ToolObjectError } from '../../src/lib/toolObject.js';

const inputs = { tables: [['city']], limits: ['1'], offsets: [] };
const tool = { name: 'by-city', description: 'People by city.', params: { city: { kind: 'string' as const } } };

describe('resolveVersionTool', () => {
  it('takes the body\'s tool object, checked', () => {
    expect(resolveVersionTool({ body: { tool }, previous: null, inputs, targetKind: 'query' })).toEqual(tool);
  });

  it('copies the previous version\'s when the body sends none, including false', () => {
    expect(resolveVersionTool({ body: {}, previous: { version: 2, tool }, inputs, targetKind: 'query' })).toEqual(tool);
    expect(resolveVersionTool({ body: {}, previous: { version: 2, tool: false }, inputs, targetKind: 'query' })).toBe(false);
  });

  it('removes it for null, and stores none when there was none', () => {
    expect(resolveVersionTool({ body: { tool: null }, previous: { version: 2, tool }, inputs, targetKind: 'query' })).toBeUndefined();
    expect(resolveVersionTool({ body: {}, previous: null, inputs, targetKind: 'query' })).toBeUndefined();
  });

  it('refuses a copied object the new inputs no longer support, saying it was copied', () => {
    const call = () =>
      resolveVersionTool({ body: {}, previous: { version: 4, tool }, inputs: { tables: [], limits: [], offsets: [] }, targetKind: 'query' });
    expect(call).toThrow(ToolObjectError);
    expect(call).toThrow(/^tool\.params\.city names no input of this version\. Its inputs are: none\. The tool object was copied from version 4/);
  });
});

describe('queryBodyInputs', () => {
  it('reads the names the route derived', () => {
    expect(
      queryBodyInputs({
        inputs: [{ variableName: 'city' }, { variableName: 'country' }],
        limitParameters: [{ name: '1' }],
        offsetParameters: [],
      }),
    ).toEqual({ tables: [['city', 'country']], limits: ['1'], offsets: [] });
  });
});

describe('groupInputs', () => {
  it('reads each variable port of the start node, in member order, and the nodes\' page parameters', () => {
    const entities: Record<string, unknown> = {
      'urn:port:people': { '@type': 'QueryOutputTuple', memberEntries: ['urn:m:2', 'urn:m:1'] },
      'urn:port:graph': { '@type': 'TriplesQuadsIO' },
      'urn:m:1': { position: 0, variable: 'urn:v:city' },
      'urn:m:2': { position: 1, variable: 'urn:v:country' },
      'urn:v:city': { variableName: 'city' },
      'urn:v:country': { variableName: 'country' },
      'urn:qv:a': { queryString: 'A' },
      'urn:qv:b': { queryString: 'B' },
    };
    const detected: Record<string, { limitParameters: string[]; offsetParameters: string[] }> = {
      A: { limitParameters: ['1'], offsetParameters: [] },
      B: { limitParameters: ['1'], offsetParameters: ['2'] },
    };
    expect(
      groupInputs({
        startNodePorts: ['urn:port:people', 'urn:port:graph'],
        nodeQueryVersionIds: ['urn:qv:a', 'urn:qv:b'],
        lookup: id => entities[id],
        detect: text => detected[text],
      }),
    ).toEqual({ tables: [['city', 'country']], limits: ['1'], offsets: ['2'] });
  });
});
