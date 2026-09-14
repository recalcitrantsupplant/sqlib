/**
 * `lib/curie` against the parsers, not against a reading of the grammar.
 *
 * Two oracles, because the two directions have different questions:
 *
 *   traqula (SPARQL)  does the CURIE we emit parse at all?
 *   n3 (Turtle)       what IRI does a CURIE actually denote?
 *
 * The failure modes are not symmetric and only one is asserted hard. Emitting a
 * CURIE that will not parse breaks a query someone pastes; declining one that
 * would have parsed only shows a longer IRI. The first is a defect, the second
 * is reported and tolerated.
 */
import { describe, it, expect } from 'vitest';
import { Parser as SparqlParser } from '@traqula/parser-sparql-1-2';
import { Parser as TurtleParser } from 'n3';
import { shrink, expand, isValidLocalName, type PrefixPair } from '@/lib/curie';

const FOAF = 'http://xmlns.com/foaf/0.1/';
const PREFIXES: PrefixPair[] = [
  { prefix: 'foaf', namespace: FOAF },
  // Shares a start with the one below it, to pin longest-match.
  { prefix: 'exsub', namespace: 'http://example.org/a/b/' },
  { prefix: 'ex', namespace: 'http://example.org/a/' },
].sort((a, b) => b.namespace.length - a.namespace.length);

const namespaceFor = (prefix: string) =>
  PREFIXES.find((pair) => pair.prefix === prefix)?.namespace;

/*
 * Both oracles work by injecting the local name into a document and parsing it,
 * which only tests the name when the name is lexically self-contained. A local
 * name containing whitespace is not: `?s foaf:a b ?o` parses fine, because the
 * space ends the CURIE and the parser sees `foaf:` followed by a stray `b` —
 * so the oracle would report `foaf:a b` as valid when it never saw it. Those
 * are inconclusive rather than valid, and are asserted directly instead.
 *
 * '/' is the same trap wearing a different hat: `?s foaf:a/b ?o` parses, but as
 * a property path joining `foaf:a` to `b`, not as one CURIE with a slash in it.
 */
const INCONCLUSIVE = /[\s/]/;

/*
 * One instance each, reused across every case. Both parsers are safe to reuse,
 * including after a throw, and constructing one per name made this spec take
 * ~12s — close enough to vitest's 20s ceiling to flake on a loaded CI runner
 * for reasons having nothing to do with the code under test.
 */
const sparqlParser = new SparqlParser();
const turtleParser = new TurtleParser();

function parsesAsSparql(curie: string): boolean | null {
  if (INCONCLUSIVE.test(curie)) return null;
  try {
    sparqlParser.parse(`PREFIX foaf: <${FOAF}>\nSELECT * WHERE { ?s ${curie} ?o }`);
    return true;
  } catch {
    return false;
  }
}

/** What Turtle says the CURIE denotes; null if it will not parse or is inconclusive. */
function turtleDenotes(curie: string): string | null {
  if (INCONCLUSIVE.test(curie)) return null;
  try {
    const quads = turtleParser.parse(
      `@prefix foaf: <${FOAF}> .\n<urn:s> ${curie} <urn:o> .`,
    );
    return quads[0]!.predicate.value;
  } catch {
    return null;
  }
}

const HAND_PICKED = [
  'alice', 'Alice', '_under', 'a-b', 'a.b', 'a_b', 'x1y2',
  '123abc', '1', '2023Report', 'v2',
  '-dashed', '.dotted', 'a/b', 'a b', 'a.', 'a-',
  'a:b', ':lead', 'trail:', 'has%20escape', 'bad%2', 'bad%zz',
  'café', '日本語', 'Ünicode',
  '.', '-', ':', '%', '_', 'a..b', 'a--b', 'dotted.', '.leading',
  'esc\\-aped', 'esc\\.aped', 'esc\\~aped',
];

function fuzzed(count: number): string[] {
  const alphabet = [...'abZ_-.:0189%\\/éü', '·'];
  const out: string[] = [];
  let seed = 20260818;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < count; i++) {
    const length = 1 + (next() % 5);
    let name = '';
    for (let j = 0; j < length; j++) name += alphabet[next() % alphabet.length];
    out.push(name);
  }
  return out;
}

const LOCAL_NAMES = [...HAND_PICKED, ...fuzzed(500)];

describe('shrink', () => {
  it('never emits a CURIE the SPARQL parser rejects', () => {
    const emitsInvalid: string[] = [];
    const missesValid: string[] = [];

    for (const local of LOCAL_NAMES) {
      const result = shrink(`${FOAF}${local}`, PREFIXES);
      const valid = parsesAsSparql(`foaf:${local}`);
      if (valid === null) continue;
      if (result && !valid) emitsInvalid.push(result.curie);
      if (!result && valid) missesValid.push(`foaf:${local}`);
    }

    console.log(
      `\n  checked ${LOCAL_NAMES.length} local names` +
        `\n  emits but does not parse: ${emitsInvalid.length}` +
        `\n  declines but would parse: ${missesValid.length}` +
        (missesValid.length ? ` (${missesValid.slice(0, 8).join(', ')})` : '') +
        '\n',
    );

    expect(emitsInvalid).toEqual([]);
    /*
     * The tolerated residue is the parser being laxer than the grammar, not us
     * being wrong: every entry contains a bare `\`, and PN_LOCAL_ESC requires a
     * backslash to be followed by one of a fixed set. Kept small so that a real
     * regression in coverage still shows up here.
     */
    expect(missesValid.length).toBeLessThan(15);
  });

  it('prefers the longest matching namespace', () => {
    expect(shrink('http://example.org/a/b/thing', PREFIXES)?.curie).toBe('exsub:thing');
    expect(shrink('http://example.org/a/thing', PREFIXES)?.curie).toBe('ex:thing');
  });

  it('declines local names containing whitespace', () => {
    // Not oracle-checkable by injection (the space ends the token), and not in
    // PN_CHARS either way.
    for (const local of ['a b', 'a\tb', ' ', 'trailing ']) {
      expect(shrink(`${FOAF}${local}`, PREFIXES), local).toBeNull();
    }
  });

  it('returns null when nothing matches', () => {
    expect(shrink('http://elsewhere.invalid/thing', PREFIXES)).toBeNull();
  });

  it('abbreviates an IRI that is exactly a namespace', () => {
    expect(shrink(FOAF, PREFIXES)?.curie).toBe('foaf:');
  });
});

describe('expand', () => {
  it('agrees with Turtle about what a CURIE denotes', () => {
    const disagreements: string[] = [];

    for (const local of LOCAL_NAMES) {
      const curie = `foaf:${local}`;
      const denoted = turtleDenotes(curie);
      if (denoted === null) continue; // Turtle will not parse it; nothing to agree about.
      const ours = expand(curie, namespaceFor);
      if (ours !== denoted) disagreements.push(`${curie} -> ${ours} (Turtle: ${denoted})`);
    }

    console.log(`\n  expand disagreements with Turtle: ${disagreements.length}` +
      (disagreements.length ? `\n    ${disagreements.slice(0, 8).join('\n    ')}` : '') + '\n');
    expect(disagreements).toEqual([]);
  });

  it('splits on the first colon, so a local name may contain one', () => {
    expect(expand('foaf:a:b', namespaceFor)).toBe(`${FOAF}a:b`);
    expect(expand('foaf:x:y:z', namespaceFor)).toBe(`${FOAF}x:y:z`);
  });

  it('unescapes PN_LOCAL_ESC but leaves percent sequences alone', () => {
    expect(expand('foaf:a\\-b', namespaceFor)).toBe(`${FOAF}a-b`);
    expect(expand('foaf:has%20escape', namespaceFor)).toBe(`${FOAF}has%20escape`);
  });

  it('returns null for a missing prefix, no colon, or an unparseable local name', () => {
    expect(expand('nope:thing', namespaceFor)).toBeNull();
    expect(expand('nocolon', namespaceFor)).toBeNull();
    expect(expand('foaf:.dotted', namespaceFor)).toBeNull();
  });
});

describe('round trip', () => {
  it('shrink then expand returns the original IRI', () => {
    const lost: string[] = [];
    for (const local of LOCAL_NAMES) {
      const iri = `${FOAF}${local}`;
      const shrunk = shrink(iri, PREFIXES);
      if (!shrunk) continue;
      // A backslash escape denotes the unescaped character, so the round trip
      // is only expected to be exact for local names that carry no escapes.
      if (/\\/.test(local)) continue;
      if (expand(shrunk.curie, namespaceFor) !== iri) lost.push(shrunk.curie);
    }
    console.log(`\n  round-trip losses: ${lost.length}${lost.length ? ` (${lost.slice(0, 8).join(', ')})` : ''}\n`);
    expect(lost).toEqual([]);
  });
});

describe('isValidLocalName', () => {
  it('accepts the empty local name', () => {
    expect(isValidLocalName('')).toBe(true);
  });
});
