import { describe, expect, it } from 'vitest';
import {
  InvalidBundleError,
  assertValidBundle,
  canonicalJson,
  hashTemplateText,
  sealBundle,
  verifyBundleIntegrity,
  type ExportBundle,
} from '../src/bundle.js';
import { bundleOf, template } from './helpers.js';

const SIMPLE = () => template('SELECT ?s WHERE { «VALUES ?s { UNDEF }» ?s ?p ?o }');

describe('assertValidBundle', () => {
  it('accepts a bundle as exported', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    expect(() => assertValidBundle(bundle)).not.toThrow();
  });

  it('rejects a future bundle version rather than guessing at it', async () => {
    const bundle = { ...(await bundleOf({ people: SIMPLE() })), version: 2 };
    expect(() => assertValidBundle(bundle)).toThrow(/version 2/);
  });

  it('rejects a slot that runs past the end of the text', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.template.slots[0].end = 10_000;
    expect(() => assertValidBundle(bundle)).toThrow(/outside the template text/);
  });

  it('rejects overlapping slots', async () => {
    const bundle = await bundleOf({
      two: template('SELECT * { «VALUES ?a { UNDEF }» «VALUES ?b { UNDEF }» }'),
    });
    bundle.queries.two.template.slots[1].start = 0;
    expect(() => assertValidBundle(bundle)).toThrow(/ordered and disjoint/);
  });

  it('catches an edit that slid the spans off their VALUES blocks', async () => {
    // The failure this format is fragile to: someone reformats the query text by
    // hand and every span after the edit now points a few characters early.
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.template.text = bundle.queries.people.template.text.replace(
      'SELECT ?s',
      'SELECT   ?s',
    );
    expect(() => assertValidBundle(bundle)).toThrow(/does not start at a VALUES keyword/);
  });

  it('rejects a signature that disagrees with the template', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.inferredInputs = [];
    expect(() => assertValidBundle(bundle)).toThrow(/describes 0 slots/);
  });

  it('rejects an unsupported query type', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    (bundle.queries.people as { queryType: string }).queryType = 'UPDATE';
    expect(() => assertValidBundle(bundle)).toThrow(/unsupported queryType/);
  });

  it('rejects a variable name the runtime could not emit', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.template.slots[0].vars = ['s p'];
    expect(() => assertValidBundle(bundle)).toThrow(InvalidBundleError);
  });
});

describe('verifyBundleIntegrity', () => {
  it('passes for an untouched bundle', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    await expect(verifyBundleIntegrity(bundle)).resolves.toBeUndefined();
  });

  it('catches an edit the structural check cannot see', async () => {
    // Changing a term inside the query leaves every span valid, so only the hash
    // can tell you the text is no longer the text that was exported and verified.
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.template.text = bundle.queries.people.template.text.replace('?o', '?z');
    await expect(verifyBundleIntegrity(bundle)).rejects.toThrow(/has been edited/);
  });
});

describe('prefix rows', () => {
  const withPrefixes = async (prefixes: unknown[]) =>
    bundleOf({
      people: template('SELECT ?s WHERE { «VALUES ?s { UNDEF }» ?s ?p ?o }', prefixes as never),
    });

  it('accepts well-formed rows, and the empty prefix SPARQL allows', async () => {
    const bundle = await withPrefixes([
      ['ex', 'http://example.org/'],
      ['', 'urn:example:'],
    ]);
    expect(() => assertValidBundle(bundle)).not.toThrow();
  });

  it.each([
    ['a row that is not a pair', ['ex', 'http://example.org/', 'extra'], /pair of strings/],
    ['a row that is not an array', { ex: 'http://example.org/' }, /pair of strings/],
    ['a non-string namespace', ['ex', 42], /pair of strings/],
    ['a label the runtime cannot emit', ['e x', 'http://example.org/'], /prefix label/],
    ['a label that would close the term', ['ex>', 'http://example.org/'], /prefix label/],
    ['a relative namespace', ['ex', 'example/'], /not an absolute IRI/],
    ['a namespace that closes its own IRI', ['ex', 'http://e/> <http://f/'], /not an absolute IRI/],
  ])('rejects %s', async (_label, row, message) => {
    const bundle = await withPrefixes([row]);
    expect(() => assertValidBundle(bundle)).toThrow(message);
  });
});

describe('integrity over the whole entry', () => {
  /** A bundle with a prefix, a page parameter and a one-edge group, sealed. */
  const chained = async (): Promise<ExportBundle> => {
    const bundle = await bundleOf({
      cities: template('SELECT ?city WHERE { «VALUES ?region { UNDEF }» ?city ex:in ?region } LIMIT 0001', [
        ['ex', 'http://example.org/'],
      ]),
      people: template('SELECT ?name WHERE { «VALUES ?city { UNDEF }» ?p ex:livesIn ?city }', [
        ['ex', 'http://example.org/'],
      ]),
    });
    bundle.groups = {
      'people-by-region': {
        nodes: { cities: { query: 'cities' }, people: { query: 'people' } },
        edges: [
          { from: 'cities', to: 'people', targetVars: ['city'], mappings: [{ source: 'city', target: 'city' }] },
        ],
        resultNode: 'people',
      },
    };
    return sealBundle(bundle);
  };

  it('passes for an untouched bundle, groups included', async () => {
    await expect(verifyBundleIntegrity(await chained())).resolves.toBeUndefined();
  });

  it('fails when a prefix namespace is edited, though the text hash still matches', async () => {
    // The finding this closes: the namespace is not in `template.text`, so the
    // text hash never saw it, and every `ex:` term silently meant another IRI.
    const bundle = await chained();
    bundle.queries.people.template.prefixes = [['ex', 'http://evil.example/']];
    expect(() => assertValidBundle(bundle)).not.toThrow();
    await expect(verifyBundleIntegrity(bundle)).rejects.toThrow(
      /Query 'people' does not match its recorded integrity hash/,
    );
  });

  it.each([
    ['a slot span', (b: ExportBundle) => void (b.queries.people.template.slots[0].vars = ['town'])],
    ['a page parameter', (b: ExportBundle) => void (b.queries.cities.pageParameters![0].name = '9')],
    ['the signature', (b: ExportBundle) => void (b.queries.people.inferredInputs = [['town']])],
    ['the query type', (b: ExportBundle) => void (b.queries.people.queryType = 'ASK')],
    ['an example', (b: ExportBundle) => void (b.queries.people.examples = [{ name: 'x', arguments: [] }])],
  ])('fails when %s is edited', async (_label, edit) => {
    const bundle = await chained();
    edit(bundle);
    await expect(verifyBundleIntegrity(bundle)).rejects.toThrow(/integrity hash/);
  });

  it('fails when the group graph is edited', async () => {
    const bundle = await chained();
    bundle.groups!['people-by-region'].edges[0].mappings = [{ source: 'region', target: 'city' }];
    await expect(verifyBundleIntegrity(bundle)).rejects.toThrow(
      /Group 'people-by-region' does not match its recorded integrity hash/,
    );
  });

  it('refuses to vouch for an entry that carries no integrity hash', async () => {
    // A bundle exported before the hash existed still loads — format rule 1 —
    // but verifying it would prove nothing about its slots and prefixes.
    const bundle = await chained();
    delete bundle.queries.people.integrity;
    expect(() => assertValidBundle(bundle)).not.toThrow();
    await expect(verifyBundleIntegrity(bundle)).rejects.toThrow(/carries no integrity hash/);
  });

  it('survives a trip through a pretty-printed JSON file with its keys reordered', async () => {
    const bundle = await chained();
    const reordered = JSON.parse(JSON.stringify(bundle, null, 2)) as ExportBundle;
    const people = reordered.queries.people as unknown as Record<string, unknown>;
    reordered.queries.people = Object.fromEntries(Object.entries(people).reverse()) as never;
    await expect(verifyBundleIntegrity(reordered)).resolves.toBeUndefined();
  });

  it('covers a field a newer exporter adds, once that exporter has sealed it', async () => {
    const bundle = await chained();
    (bundle.queries.people as unknown as Record<string, unknown>).later = { added: true };
    await expect(verifyBundleIntegrity(bundle)).rejects.toThrow(/integrity hash/);
    await expect(verifyBundleIntegrity(await sealBundle(bundle))).resolves.toBeUndefined();
  });

  it('rejects an integrity field that is not a hash', async () => {
    const bundle = await chained();
    bundle.groups!['people-by-region'].integrity = 'md5-0';
    expect(() => assertValidBundle(bundle)).toThrow(/integrity must be/);
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth, drops undefined fields, and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"e":2,"f":1}]},"b":1}',
    );
  });
});

describe('hashTemplateText', () => {
  it('is stable and prefixed', async () => {
    const hash = await hashTemplateText('SELECT * { ?s ?p ?o }');
    expect(hash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(await hashTemplateText('SELECT * { ?s ?p ?o }')).toBe(hash);
  });
});

describe('examples', () => {
  const withExample = async (args: unknown[], name = 'Perth') => {
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.examples = [{ name, arguments: args as never }];
    return bundle;
  };

  it('accepts an example whose arity matches the query', async () => {
    const bundle = await withExample([{ head: { vars: ['s'] }, results: { bindings: [] } }]);
    expect(() => assertValidBundle(bundle)).not.toThrow();
  });

  const TWO = [
    { head: { vars: ['s'] }, results: { bindings: [] } },
    { head: { vars: ['s'] }, results: { bindings: [] } },
  ];

  it('rejects an example written against a different signature', async () => {
    // The failure that actually happens: the query lost a slot and every
    // example from before now supplies more arguments than it can take.
    const bundle = await withExample(TWO);
    expect(() => assertValidBundle(bundle)).toThrow(/supplies 2 argument sets but the query has only 1/);
  });

  it('accepts an example that leaves a slot out, since an omitted slot runs open', async () => {
    const bundle = await withExample([]);
    expect(() => assertValidBundle(bundle)).not.toThrow();
  });

  it('names the offending example so it can be found', async () => {
    const bundle = await withExample(TWO, 'By city');
    expect(() => assertValidBundle(bundle)).toThrow(/'By city'/);
  });

  it('rejects an example with no name to show', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.examples = [{ arguments: [] } as never];
    expect(() => assertValidBundle(bundle)).toThrow(/has no name/);
  });

  it('leaves a bundle without examples alone', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    expect(bundle.queries.people.examples).toBeUndefined();
    expect(() => assertValidBundle(bundle)).not.toThrow();
  });
});
