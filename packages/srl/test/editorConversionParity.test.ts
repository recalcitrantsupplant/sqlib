/**
 * The editor's fast conversion helpers, held against this package's.
 *
 * `@kurrawongai/codemirror-lang-srl` ships `sparqlToSrl` / `srlToSparql`: pure
 * source-to-source transforms over the shared Lezer tree, with no server round
 * trip. They are what makes the quick-fix actions in an SRL editor instant
 * (`web/src/lib/codeLanguage.ts` turns them on with `sparqlConversions`), and
 * the obvious next thought is to point the *import* and *export* dialogs at
 * them too and delete the two API routes.
 *
 * This file is the reason we do not. The two converters do not decide the same
 * set, and the disagreements do not all fall the safe way:
 *
 *  - Where the editor is **stricter** than we are, nothing breaks. It declines
 *    a conversion we would have made, the author reaches for the dialog, and
 *    the worst case is a round trip they did not need.
 *  - Where the editor is **looser**, it writes a rule into the document that
 *    this package would have refused — and the three cases below are not
 *    cosmetic. A head variable the body never binds, or a `FILTER` standing
 *    before the pattern that binds it, both parse cleanly and both mean
 *    something other than what the author asked for. The editor has no
 *    well-formedness pass because it has no AST to run one over; it has a tree
 *    of spans. That is not a gap upstream should close — it is the difference
 *    between a syntax-directed rewrite and a compiler.
 *
 * So the division is: the *span*-level rewrites are the editor's (they cannot
 * move a document from valid to invalid, because they only touch text the
 * conformance linter has already marked as an error), and the *document*-level
 * conversions stay on `/srl/from-sparql` and `/srl/compile`, which run the same
 * `sparqlToRule` and `compileRule` the executor does.
 *
 * The table is asserted exactly, in both directions, so that a grammar bump
 * which widens what the editor accepts fails here rather than in a rule set.
 * A new `cm: 'accepts', srl: 'rejects'` row is the signal to look hard: either
 * upstream grew a check we can now lean on, or it grew a hole.
 */
import { describe, it, expect } from 'vitest';
import { sparqlToSrl, srlToSparql } from '@kurrawongai/codemirror-lang-srl';
import { sparqlToRule } from '../src/from-sparql.js';

const PREFIX = 'PREFIX : <http://example/>';

/** What a converter did with a case: produced text, or declined. */
type Verdict = 'accepts' | 'rejects';

interface Case {
  /** What makes this case interesting, used as the test name. */
  what: string;
  query: string;
  /** The editor's source-level transform. */
  cm: Verdict;
  /** This package's `sparqlToRule`, which is what the API route runs. */
  srl: Verdict;
  /**
   * Why they differ, when they do. Present on every row where `cm !== srl`, and
   * absent on every row where they agree — asserted below, so a row cannot be
   * added to the divergent set without saying what it costs.
   */
  why?: string;
}

const CASES: Case[] = [
  // ---- agreed, both convert -------------------------------------------------
  {
    what: 'a plain template and BGP',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }`,
    cm: 'accepts',
    srl: 'accepts',
  },
  {
    what: 'a FILTER carried through',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o FILTER(?o > 2) }`,
    cm: 'accepts',
    srl: 'accepts',
  },
  {
    what: 'FILTER NOT EXISTS lowered to NOT',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o FILTER NOT EXISTS { ?s :dead ?z } }`,
    cm: 'accepts',
    srl: 'accepts',
  },
  {
    what: 'a property path carried through',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p/:r ?o }`,
    cm: 'accepts',
    srl: 'accepts',
  },
  {
    what: 'BIND + FILTER(BOUND(?v)) folded into SET',
    query: `${PREFIX} CONSTRUCT { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) FILTER(BOUND(?x)) }`,
    cm: 'accepts',
    srl: 'accepts',
  },
  {
    what: 'a bare BIND becoming a SET',
    query: `${PREFIX} CONSTRUCT { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) }`,
    cm: 'accepts',
    srl: 'accepts',
  },
  {
    what: 'a blank node in the template',
    query: `${PREFIX} CONSTRUCT { ?s :q _:b } WHERE { ?s :p ?o }`,
    cm: 'accepts',
    srl: 'accepts',
  },
  {
    what: 'an INSERT … WHERE read as a rule',
    query: `${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o }`,
    cm: 'accepts',
    srl: 'accepts',
  },

  // ---- agreed, both decline -------------------------------------------------
  {
    what: 'a MINUS over disjoint variables',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o MINUS { ?a :gone ?b } }`,
    cm: 'rejects',
    srl: 'rejects',
  },
  {
    what: 'an OPTIONAL',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o OPTIONAL { ?s :m ?n } }`,
    cm: 'rejects',
    srl: 'rejects',
  },
  {
    what: 'a UNION',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { { ?s :p ?o } UNION { ?s :r ?o } }`,
    cm: 'rejects',
    srl: 'rejects',
  },
  {
    what: 'VALUES',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o VALUES ?v { 1 2 } }`,
    cm: 'rejects',
    srl: 'rejects',
  },
  {
    what: 'a GRAPH block',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { GRAPH ?g { ?s :p ?o } }`,
    cm: 'rejects',
    srl: 'rejects',
  },
  {
    what: 'a SERVICE block',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { SERVICE <http://x/> { ?s :p ?o } }`,
    cm: 'rejects',
    srl: 'rejects',
  },
  {
    what: 'a sub-SELECT',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { { SELECT ?s ?o WHERE { ?s :p ?o } } }`,
    cm: 'rejects',
    srl: 'rejects',
  },
  {
    what: 'a SELECT, which is not a rule at all',
    query: `${PREFIX} SELECT * WHERE { ?s :p ?o }`,
    cm: 'rejects',
    srl: 'rejects',
  },
  {
    what: 'FROM and the solution modifiers',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } FROM <http://g/> WHERE { ?s :p ?o } ORDER BY ?o LIMIT 5`,
    cm: 'rejects',
    srl: 'rejects',
  },
  {
    what: 'a DELETE clause',
    query: `${PREFIX} DELETE { ?s :q ?o } INSERT { ?s :r ?o } WHERE { ?s :p ?o }`,
    cm: 'rejects',
    srl: 'rejects',
  },
  {
    what: 'text that is not a query',
    query: 'not a query at all',
    cm: 'rejects',
    srl: 'rejects',
  },

  // ---- the editor is stricter (safe: a round trip the author did not need) ---
  {
    what: 'a conjunctive group around part of the body',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { { ?s :p ?o } FILTER(?o > 2) }`,
    cm: 'rejects',
    srl: 'accepts',
    why:
      'We flatten a group that is plain conjunction; the editor sees a '
      + 'GroupOrUnionGraphPattern node and cannot tell the two apart without '
      + 'resolving the branch, so it declines. Costs an import dialog, loses nothing.',
  },
  {
    what: 'a MINUS sharing variables',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o MINUS { ?s :gone ?o } }`,
    cm: 'rejects',
    srl: 'accepts',
    why:
      'We rewrite it to NOT and warn, because MINUS and NOT agree only when the '
      + 'variables overlap — a judgement that needs the scope on both sides. The '
      + 'editor declines rather than guess, which is the right call for a quick fix.',
  },

  // ---- the editor is looser (the reason the dialogs stay on the server) -----
  {
    what: 'an empty CONSTRUCT template',
    query: `${PREFIX} CONSTRUCT { } WHERE { ?s :p ?o }`,
    cm: 'accepts',
    srl: 'rejects',
    why:
      'The editor emits `RULE { } WHERE { … }`: a rule that infers nothing, which '
      + 'is valid syntax and a certain mistake. We reject it as `empty-template`.',
  },
  {
    what: 'a head variable the body never binds',
    query: `${PREFIX} CONSTRUCT { ?s :q ?missing } WHERE { ?s :p ?o }`,
    cm: 'accepts',
    srl: 'rejects',
    why:
      'SRL range restriction. The editor has spans, not scope, so it cannot see '
      + 'that ?missing is unbound; the rule it writes parses and then means '
      + 'something other than what was asked. We reject it as `well-formedness`.',
  },
  {
    what: 'a FILTER standing before the pattern that binds it',
    query: `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { FILTER(?o > 2) ?s :p ?o }`,
    cm: 'accepts',
    srl: 'rejects',
    why:
      'An SRL body is evaluated in order, so this filters an unbound ?o. Same '
      + 'root cause as the row above: no scope, no check. Rejected as `well-formedness`.',
  },
  {
    what: 'INSERT DATA as a ground DATA block',
    query: `${PREFIX} INSERT DATA { :a :p :b }`,
    cm: 'accepts',
    srl: 'rejects',
    why:
      'The one place the editor is ahead of us: it reads INSERT DATA as an SRL '
      + 'DATA block, which is exactly right, and `sparqlToRule` only knows how to '
      + 'build a RULE. Worth closing here rather than by switching converters.',
  },
];

/** Did the editor's transform produce text? */
function editorVerdict(query: string): Verdict {
  return sparqlToSrl(query).text !== undefined ? 'accepts' : 'rejects';
}

/** Did this package's converter produce a rule? */
function srlVerdict(query: string): Verdict {
  return sparqlToRule(query).rule !== null ? 'accepts' : 'rejects';
}

describe('SPARQL → SRL: the editor against sparqlToRule', () => {
  it.each(CASES)('$what', ({ query, cm, srl }) => {
    expect(editorVerdict(query)).toBe(cm);
    expect(srlVerdict(query)).toBe(srl);
  });

  it('records a reason on every divergence and none where they agree', () => {
    for (const c of CASES) {
      if (c.cm === c.srl) expect(c.why, c.what).toBeUndefined();
      else expect(c.why, c.what).toBeTruthy();
    }
  });

  /**
   * The load-bearing assertion. Everything else here is a table that can be
   * extended; this one says the *looser* set has not grown. A row appearing in
   * this list that is not in the literal below means a grammar bump taught the
   * editor to accept a query we refuse — which is a rule that would land in a
   * document and misbehave, not a lint nit.
   */
  it('pins the queries the editor accepts and we refuse', () => {
    const looser = CASES.filter((c) => c.cm === 'accepts' && c.srl === 'rejects').map((c) => c.what);
    expect(looser).toEqual([
      'an empty CONSTRUCT template',
      'a head variable the body never binds',
      'a FILTER standing before the pattern that binds it',
      'INSERT DATA as a ground DATA block',
    ]);

    // And the table is the whole truth: every row still decides as recorded.
    for (const c of CASES) {
      expect([c.what, editorVerdict(c.query), srlVerdict(c.query)])
        .toEqual([c.what, c.cm, c.srl]);
    }
  });
});

/**
 * The other direction, which is where the editor's losses are documented rather
 * than surprising — but they are still losses, and they are still why `GET
 * /:id/srl` and `/srl/compile` are the export path.
 */
describe('SRL → SPARQL: what the editor drops', () => {
  it('exports a single rule to CONSTRUCT', () => {
    const out = srlToSparql(`${PREFIX} RULE { ?s :q ?o } WHERE { ?s :p ?o }`, { form: 'construct' });
    expect(out.text).toContain('CONSTRUCT { ?s :q ?o }');
  });

  it('raises SET back to BIND with its BOUND guard', () => {
    const out = srlToSparql(`${PREFIX} RULE { ?s :q ?x } WHERE { ?s :p ?o SET ( ?x := ?o + 1 ) }`, {
      form: 'construct',
    });
    expect(out.text).toContain('BIND(?o + 1 AS ?x)');
    expect(out.text).toContain('FILTER(BOUND(?x))');
  });

  it('demotes a rule IRI to a comment, which will not survive a re-import', () => {
    const out = srlToSparql(`${PREFIX} RULE <http://example/r1> { ?s :q ?o } WHERE { ?s :p ?o }`, {
      form: 'construct',
    });
    // The name is preserved only as prose. `sparqlToRule` takes the name as an
    // option instead, so a round trip through the editor loses rule identity —
    // which a rule set cannot afford, since stratification is reported per rule.
    expect(out.text).toContain('# SRL rule IRI: <http://example/r1>');
    expect(sparqlToRule(out.text!).rule).not.toContain('http://example/r1');
  });

  it('exports one block at a time, so a rule set is not a unit it can handle', () => {
    const out = srlToSparql(
      `${PREFIX} RULE { ?s :q ?o } WHERE { ?s :p ?o } RULE { ?o :back ?s } WHERE { ?s :p ?o }`,
      { form: 'construct' },
    );
    expect(out.text).toBeUndefined();
    expect(out.diagnostics.map((d) => d.message))
      .toContain('Export exactly one SRL RULE or DATA block at a time.');
  });
});

/**
 * Prefixes are the quiet one. The editor copies the source prologue verbatim,
 * which is correct for a snippet and wrong for an import: the target document
 * has a prologue of its own, and two documents that spell the same label
 * differently must resolve to the query's IRI under the target's name.
 * `sparqlToRule` does that with `targetPrologue`; there is no editor-side
 * equivalent, and nowhere to get the target's prologue from inside one editor.
 */
describe('prefix reconciliation, which only the server converter does', () => {
  const query = 'PREFIX x: <http://query/> CONSTRUCT { ?s x:q ?o } WHERE { ?s x:p ?o }';

  it('re-abbreviates against the target so the target wins', () => {
    const result = sparqlToRule(query, { targetPrologue: 'PREFIX x: <http://target/>' });
    expect(result.rule).toContain('<http://query/q>');
    expect(result.prefixes.find((p) => p.prefix === 'x')?.conflicts).toBe(true);
  });

  it('is not something the editor transform attempts', () => {
    // It carries `x:` through under the source's binding, which in a document
    // that binds `x:` elsewhere silently re-points every term in the new rule.
    expect(sparqlToSrl(query).text).toContain('x:q');
  });
});
