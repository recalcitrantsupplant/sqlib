import { describe, it, expect } from 'vitest';

/**
 * RDF 1.2 triple terms, end to end (issue #176).
 *
 * `:s :p :o ~:r {| :w 9 |}` is SPARQL 1.2 reifier-and-annotation syntax, and the
 * rules grammar always parsed it — the SRL documents that use it round-tripped
 * fine. What failed was everything downstream: the term rendering, the N-Quads
 * writer and the canonicaliser all switched on term type and had no arm for a
 * quoted triple, so the first W3C rules entry that used the syntax died with
 * `Unsupported RDF term type: Quad` before a rule ever ran.
 *
 * These are the four seams a triple term has to cross, tested one at a time so a
 * regression names the seam rather than the suite: rendering, canonicalisation,
 * SPARQL-JSON binding values, and a whole rule set run.
 */

import { quadToNQuad, termToNQuad, type RenderableQuad, type RenderableTerm } from '../../src/lib/nquads.js';
import { canonicalizeNQuads } from '../../src/lib/rdfCanonicalizer.js';
import { renderBindingValue } from '../../src/lib/TupleStore.js';

const iri = (value: string): RenderableTerm => ({ termType: 'NamedNode', value });
const tripleTerm = (s: RenderableTerm, p: RenderableTerm, o: RenderableTerm): RenderableTerm => ({
  termType: 'Quad',
  value: '',
  subject: s,
  predicate: p,
  object: o,
});

describe('the N-Quads writer', () => {
  it('writes a triple term in RDF 1.2 syntax', () => {
    expect(termToNQuad(tripleTerm(iri('http://ex/s'), iri('http://ex/p'), iri('http://ex/o'))))
      .toBe('<<( <http://ex/s> <http://ex/p> <http://ex/o> )>>');
  });

  it('writes a triple term nested inside another', () => {
    const inner = tripleTerm(iri('http://ex/s'), iri('http://ex/p'), iri('http://ex/o'));
    expect(termToNQuad(tripleTerm(iri('http://ex/r'), iri('http://ex/says'), inner)))
      .toBe('<<( <http://ex/r> <http://ex/says> <<( <http://ex/s> <http://ex/p> <http://ex/o> )>> )>>');
  });

  it('writes the quad a reifier produces', () => {
    // What Oxigraph hands back for `:x1 :link :x2 ~:linkB {| :weight 9 |}`: the
    // reifier names the reification, and `rdf:reifies` points at a triple term.
    const quad: RenderableQuad = {
      subject: iri('http://ex/linkB'),
      predicate: iri('http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies'),
      object: tripleTerm(iri('http://ex/x1'), iri('http://ex/link'), iri('http://ex/x2')),
      graph: { termType: 'DefaultGraph', value: '' },
    };
    expect(quadToNQuad(quad)).toBe(
      '<http://ex/linkB> <http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies> '
      + '<<( <http://ex/x1> <http://ex/link> <http://ex/x2> )>> .',
    );
  });

  it('still refuses a term type it does not know', () => {
    expect(() => termToNQuad({ termType: 'Variable', value: 'x' })).toThrow(/Unsupported RDF term type/);
  });
});

describe('canonicalizing a dataset that contains triple terms', () => {
  const nquads = [
    '<http://ex/linkB> <http://ex/weight> "9"^^<http://www.w3.org/2001/XMLSchema#integer> .',
    '<http://ex/linkB> <http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies> <<( <http://ex/x1> <http://ex/link> <http://ex/x2> )>> .',
    '<http://ex/x1> <http://ex/link> <http://ex/x2> .',
  ].join('\n');

  it('round-trips the triple term rather than dropping or mangling it', async () => {
    const canonical = await canonicalizeNQuads(nquads);
    expect(canonical.split('\n').filter(Boolean)).toHaveLength(3);
    expect(canonical).toContain('<<( <http://ex/x1> <http://ex/link> <http://ex/x2> )>>');
  });

  it('is stable under reordering — the point of canonicalising at all', async () => {
    const shuffled = nquads.split('\n').reverse().join('\n');
    expect(await canonicalizeNQuads(shuffled)).toBe(await canonicalizeNQuads(nquads));
  });

  it('labels a blank node that occurs only inside a triple term', async () => {
    // The case the rewrite exists for. `rdf-canonize` walks a quad's subject and
    // object as flat terms, so a blank node nested in a triple term would never
    // be issued an identifier — these two datasets are isomorphic and must
    // canonicalise identically, and the one below them must not.
    const withB0 = '<http://ex/r> <http://ex/says> <<( _:b0 <http://ex/p> <http://ex/o> )>> .';
    const withB9 = '<http://ex/r> <http://ex/says> <<( _:b9 <http://ex/p> <http://ex/o> )>> .';
    expect(await canonicalizeNQuads(withB0)).toBe(await canonicalizeNQuads(withB9));

    const grounded = '<http://ex/r> <http://ex/says> <<( <http://ex/s> <http://ex/p> <http://ex/o> )>> .';
    expect(await canonicalizeNQuads(grounded)).not.toBe(await canonicalizeNQuads(withB0));
  });

  it('tells two datasets apart when only the nesting differs', async () => {
    const nested = '<http://ex/r> <http://ex/says> <<( <http://ex/a> <http://ex/p> <<( <http://ex/b> <http://ex/p> <http://ex/c> )>> )>> .';
    const flat = '<http://ex/r> <http://ex/says> <<( <http://ex/a> <http://ex/p> <http://ex/c> )>> .';
    expect(await canonicalizeNQuads(nested)).not.toBe(await canonicalizeNQuads(flat));
    expect(await canonicalizeNQuads(nested)).toContain('<<( <http://ex/b>');
  });

  it('leaves an RDF 1.1 dataset exactly as it was canonicalised before', async () => {
    // The rewrite is a branch, not a replacement: everything without a triple
    // term must go through `rdf-canonize` untouched, trailing newline included.
    const plain = '_:b0 <http://ex/p> <http://ex/o> .\n';
    expect(await canonicalizeNQuads(plain)).toBe('_:c14n0 <http://ex/p> <http://ex/o> .\n');
  });

  it('terminates every line, on both branches', async () => {
    expect((await canonicalizeNQuads(nquads)).endsWith('\n')).toBe(true);
  });

  it('keeps a triple term inside a named graph in that graph', async () => {
    // The rewrite hangs the components off the default graph even when the term
    // occurs in a named one — they are scaffolding, not data — so this checks
    // the quad that carries the term comes back in the graph it went in.
    const named = '<http://ex/r> <http://ex/says> <<( <http://ex/a> <http://ex/p> <http://ex/c> )>> <http://ex/g> .';
    const canonical = await canonicalizeNQuads(named);
    expect(canonical.split('\n').filter(Boolean)).toEqual([
      '<http://ex/r> <http://ex/says> <<( <http://ex/a> <http://ex/p> <http://ex/c> )>> <http://ex/g> .',
    ]);
  });

  it('refuses a dataset that squats on the namespace the rewrite reserves', async () => {
    const squatting = '<http://ex/s> <urn:sqlib:rdf-canonize:triple-term#subject> <<( <http://ex/a> <http://ex/b> <http://ex/c> )>> .';
    await expect(canonicalizeNQuads(squatting)).rejects.toThrow(/reserved namespace/);
  });
});

describe('rendering a SPARQL JSON binding value', () => {
  it('renders a triple term by recursion', () => {
    // SPARQL 1.2 carries a triple term as three nested terms rather than a
    // lexical form; the literal branch used to stringify the object.
    expect(renderBindingValue({
      type: 'triple',
      value: {
        subject: { type: 'uri', value: 'http://ex/x1' },
        predicate: { type: 'uri', value: 'http://ex/link' },
        object: { type: 'literal', value: '9', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
      },
    })).toBe('<<( <http://ex/x1> <http://ex/link> "9"^^<http://www.w3.org/2001/XMLSchema#integer> )>>');
  });
});
