import { describe, expect, it } from 'vitest';
import { InvalidBundleError, assertValidBundle } from '../src/bundle.js';
import { fromBundle, iri } from '../src/library.js';
import type { ExecutionResult, Executor } from '../src/executor.js';
import { bundleOf, exportedQuery, template } from './helpers.js';

/**
 * A query's slot policies (`inputPolicies`) travel in the bundle, so an
 * exported page refuses what the server refuses
 * (`docs/proposals/required-arguments.md`).
 */

const PARTS = () =>
  template('SELECT ?part WHERE { «VALUES ?whole { UNDEF }» ?part :isPartOf ?whole }');

async function requiredParts() {
  return exportedQuery(PARTS(), { inputPolicies: [{ vars: ['whole'], whenEmpty: 'require' }] });
}

describe('slot policies in a bundle', () => {
  it('refuses an omitted required slot, and runs one that is filled', async () => {
    const lib = fromBundle(await bundleOf({ parts: await requiredParts() }));
    expect(() => lib.query('parts').text()).toThrow(
      'Required input for VALUES clause 1 (?whole) received no bindings',
    );
    expect(lib.query('parts').text({
      arguments: [{ bindings: [{ whole: iri('http://example.org/book1') }] }],
    })).toContain('VALUES ?whole { <http://example.org/book1> }');
  });

  it('keeps the built-in reading in a bundle without policies', async () => {
    const lib = fromBundle(await bundleOf({ parts: PARTS() }));
    expect(lib.query('parts').text()).not.toContain('VALUES');
  });

  it('refuses a policy for a slot the template does not declare', async () => {
    const bundle = await bundleOf({
      parts: await exportedQuery(PARTS(), { inputPolicies: [{ vars: ['other'], whenEmpty: 'require' }] }),
    });
    expect(() => assertValidBundle(bundle)).toThrow(InvalidBundleError);
    expect(() => assertValidBundle(bundle)).toThrow(/names a slot the template does not declare/);
  });

  it('refuses an unknown mode', async () => {
    const bundle = await bundleOf({
      parts: await exportedQuery(PARTS(), {
        inputPolicies: [{ vars: ['whole'], whenEmpty: 'sometimes' as never }],
      }),
    });
    expect(() => assertValidBundle(bundle)).toThrow(/unknown whenEmpty mode 'sometimes'/);
  });

  it('applies to a group node whose slot nothing fills', async () => {
    const base = await bundleOf({
      wholes: template('SELECT ?thing WHERE { ?thing a :Book }'),
      parts: await requiredParts(),
    });
    const executor: Executor = {
      async execute(): Promise<ExecutionResult> {
        return { head: { vars: ['thing'] }, results: { bindings: [] } };
      },
    };
    const lib = fromBundle({
      ...base,
      groups: {
        lonely: { nodes: { only: { query: 'parts' } }, edges: [], resultNode: 'only' },
      },
    }, { executor });

    await expect(lib.group('lonely').run()).rejects.toThrow(
      'Required input for VALUES clause 1 (?whole) received no bindings',
    );
  });
});
