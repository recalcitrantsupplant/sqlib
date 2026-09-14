import { describe, it, expect } from 'vitest';
import { playgroundRulesExecuteResponseSchema } from '@sparql-query-lib/contracts';

describe('Playground Rules Execution Schema', () => {
  it('parses valid execution response from backend', () => {
    // This payload matches what the backend sends (programSource is string 'normalized')
    const payload = {
      status: 'converged',
      iterations: [
        {
          index: 1,
          signature: '8b98417dc533da087ddef96a38d7dfcb1e3e8b437761c43ee704e1383f048010',
          tripleCount: 2,
          delta: 1,
          rules: [
            {
              ruleVersionId: 'urn:sqlib:ruleset:885be01ea6a74654b371d2693b9bc392:rule-1',
              programSource: 'normalized',
              durationMs: 0.1006010000128299,
              triplesInserted: 1,
              triplesDeleted: 0,
              quadSamples: [
                '<https://example.com/d> <https://example.com/e> <https://example.com/f> .'
              ],
              insertedQuads: [
                '<https://example.com/d> <https://example.com/e> <https://example.com/f> .'
              ],
              deletedQuads: [],
              timedOut: false
            }
          ]
        },
        {
          index: 2,
          signature: '8b98417dc533da087ddef96a38d7dfcb1e3e8b437761c43ee704e1383f048010',
          tripleCount: 2,
          delta: 0,
          rules: [
            {
              ruleVersionId: 'urn:sqlib:ruleset:885be01ea6a74654b371d2693b9bc392:rule-1',
              programSource: 'normalized',
              durationMs: 0.08799000002909452,
              triplesInserted: 0,
              triplesDeleted: 0,
              quadSamples: [],
              insertedQuads: [],
              deletedQuads: [],
              timedOut: false
            }
          ]
        }
      ],
      dataBlocks: [
        {
          dataBlockVersionId: 'urn:sqlib:ruleset:885be01ea6a74654b371d2693b9bc392:data-1',
          programSource: 'normalized',
          durationMs: 0.10187000001315027,
          tripleDelta: 1
        }
      ],
      finalGraphNQuads: '<https://example.com/d> <https://example.com/e> <https://example.com/f> .',
      finalGraphContent: '<https://example.com/d> <https://example.com/e> <https://example.com/f> .',
      finalGraphContentType: 'application/n-triples',
      ruleNames: {
        'urn:sqlib:ruleset:885be01ea6a74654b371d2693b9bc392:rule-1': 'Rule 1'
      }
    };

    const result = playgroundRulesExecuteResponseSchema.parse(payload);
    expect(result).toEqual(payload);
  });

  it('parses a run that used named tuples', () => {
    // The tuple half of a response: the rows each rule wrote, the workspace
    // size per iteration, and the workspace as the run left it. A rule the SRL
    // names carries its own IRI, which is what results are attributed to.
    const payload = {
      status: 'converged',
      iterations: [
        {
          index: 1,
          signature: 'a2c4',
          tripleCount: 2,
          tupleCount: 2,
          delta: 0,
          rules: [
            {
              ruleVersionId: 'urn:sqlib:ruleset:885be01ea6a74654b371d2693b9bc392:rule-1',
              ruleIri: 'http://example.org/reach-base',
              programSource: 'normalized',
              durationMs: 0.4,
              triplesInserted: 0,
              triplesDeleted: 0,
              quadSamples: [],
              insertedQuads: [],
              deletedQuads: [],
              insertedTuples: [
                'TUPLE(<http://example.org/reach>, <http://example.org/a>, <http://example.org/b>)'
              ],
              timedOut: false
            }
          ]
        }
      ],
      dataBlocks: [],
      finalTuples: [
        'TUPLE(<http://example.org/reach>, <http://example.org/a>, <http://example.org/b>)'
      ]
    };

    expect(playgroundRulesExecuteResponseSchema.parse(payload)).toEqual(payload);
  });
});
