/**
 * Inputs for the cross-runtime golden cases.
 *
 * `../conformance.test.ts` runs each case through this runtime and records the
 * outcome in `goldens.json`. The .NET runtime in `dotnet/` reads the same file
 * and must give the same outcome for every case. See
 * `docs/guides/dotnet-runtime.md`, "Conformance".
 *
 * Bundles and payloads are stored as JSON text, so that a number such as
 * `25.0` reaches both runtimes as it is written. A `JSON.stringify` round trip
 * would write it as `25`.
 */

import type { ExportBundle, ExportedQuery } from '../../src/bundle.js';
import { bundleOf, exportedQuery, template } from '../helpers.js';

export type BundleSource = { fixture: string } | { json: string };

export interface LoadCase {
  name: string;
  bundle: string;
}

export interface CallCase {
  name: string;
  bundle: string;
  query: string;
  payload: string;
}

export interface PatternCase {
  name: string;
  pattern: string;
  value: string;
}

export interface CaseInputs {
  bundles: Record<string, BundleSource>;
  load: LoadCase[];
  calls: CallCase[];
  valuePatterns: PatternCase[];
}

const EX = 'http://example.org/';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

const uri = (value: string) => ({ type: 'uri', value });
const lit = (value: string, extra: Record<string, string> = {}) => ({ type: 'literal', value, ...extra });
const set = (vars: string[], bindings: unknown[]) => ({ head: { vars }, results: { bindings } });
const payload = (value: unknown) => JSON.stringify(value);

async function query(marked: string, overrides: Partial<ExportedQuery> = {}, prefixes: [string, string][] = []) {
  return exportedQuery(template(marked, prefixes), overrides);
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const DELETE = Symbol('delete');
type Change = Json | typeof DELETE | ((current: Json) => Json);

/**
 * A copy of a bundle with changes applied. Each key is a dotted path into the
 * bundle. A `*` segment steps into the first member of a map.
 */
function edited(bundle: ExportBundle, changes: Record<string, Change>): string {
  const copy = JSON.parse(JSON.stringify(bundle)) as JsonObject;
  for (const [path, change] of Object.entries(changes)) {
    const keys = path.split('.');
    let node = copy;
    for (const key of keys.slice(0, -1)) {
      node = (key === '*' ? Object.values(node)[0] : node[key]) as JsonObject;
    }
    const last = keys[keys.length - 1];
    if (change === DELETE) delete node[last];
    else if (typeof change === 'function') node[last] = change(node[last]);
    else node[last] = change;
  }
  return JSON.stringify(copy);
}

const append = (text: Json) => `${String(text)} `;

export async function buildCases(fixtures: Record<string, ExportBundle>): Promise<CaseInputs> {
  const bundles: Record<string, BundleSource> = {
    'fixture-v1': { fixture: 'bundle-v1.json' },
    'fixture-v2': { fixture: 'bundle-v2.json' },
    'fixture-v1-minimal': { fixture: 'bundle-v1-minimal.json' },
  };
  const load: LoadCase[] = [];
  const calls: CallCase[] = [];

  for (const id of Object.keys(bundles)) load.push({ name: `${id} loads`, bundle: id });

  // Every example in every committed fixture.
  for (const [id, file] of [
    ['fixture-v1', 'bundle-v1.json'],
    ['fixture-v2', 'bundle-v2.json'],
  ] as const) {
    for (const [name, q] of Object.entries(fixtures[file].queries)) {
      for (const example of q.examples ?? []) {
        calls.push({
          name: `${id} ${name} example '${example.name}'`,
          bundle: id,
          query: name,
          payload: payload({
            arguments: example.arguments,
            ...(example.limits ? { limits: example.limits } : {}),
            ...(example.offsets ? { offsets: example.offsets } : {}),
          }),
        });
      }
    }
  }
  calls.push(
    { name: 'fixture-v2 people-by-city open', bundle: 'fixture-v2', query: 'people-by-city', payload: '{}' },
    {
      name: 'fixture-v2 paged-things page parameters',
      bundle: 'fixture-v2',
      query: 'paged-things',
      payload: payload({ arguments: [set(['type'], [{ type: uri(`${EX}City`) }])], limits: [{ name: '1', value: 10 }], offsets: [{ name: '2', value: 30 }] }),
    },
    { name: 'fixture-v2 paged-things propagateEmpty', bundle: 'fixture-v2', query: 'paged-things', payload: '{}' },
    { name: 'fixture-v2 labels no slots', bundle: 'fixture-v2', query: 'labels', payload: '{}' },
    { name: 'fixture-v1-minimal people', bundle: 'fixture-v1-minimal', query: 'people', payload: payload({ arguments: [set(['city'], [{ city: lit('Perth', { 'xml:lang': 'en' }) }])] }) },
    { name: 'unknown query name', bundle: 'fixture-v2', query: 'nope', payload: '{}' },
  );

  // Terms, prefixes and rows.
  const prefixes: [string, string][] = [
    ['ex', EX],
    ['exa', `${EX}a/`],
    ['', `${EX}e/`],
    ['1bad', `${EX}n/`],
  ];
  const terms = await bundleOf({
    one: await query(`SELECT ?x WHERE { «VALUES ?x { UNDEF }» ?s ?p ?x . }`, {}, prefixes),
    multi: await query(`SELECT * WHERE { «VALUES (?a ?b ?c) { (UNDEF UNDEF UNDEF) }» ?a ?b ?c . }`, {}, prefixes),
    twin: await query(
      `SELECT * WHERE { «VALUES ?k { UNDEF }» ?k ?p ?o . «VALUES ?k { UNDEF }» ?o ?q ?k . «VALUES ?z { UNDEF }» }`,
    ),
    wide: await query(
      `SELECT * WHERE { { SELECT ?s WHERE { ?s ?p "é😀𝔸" } LIMIT 000page } «VALUES ?x { UNDEF }» ?s ?q "𝔸" . ?s ?r ?x } OFFSET 000skip`,
    ),
    union: await query(
      `SELECT * WHERE { { SELECT ?s WHERE { «VALUES ?t { UNDEF }» ?s a ?t } LIMIT 000page } UNION { SELECT ?s WHERE { ?s a ?t } LIMIT 000page OFFSET 000page } }`,
    ),
    graph: await query(`CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }`, { queryType: 'CONSTRUCT' }),
  });
  bundles.terms = { json: JSON.stringify(terms) };
  load.push({ name: 'terms loads', bundle: 'terms' });

  const one = (name: string, bindings: unknown[], extra: Record<string, unknown> = {}) =>
    calls.push({ name: `one: ${name}`, bundle: 'terms', query: 'one', payload: payload({ arguments: [set(['x'], bindings)], ...extra }) });

  one('IRI abbreviated', [{ x: uri(`${EX}thing`) }]);
  one('IRI under the longer namespace', [{ x: uri(`${EX}a/b`) }]);
  one('IRI with slash in local name', [{ x: uri(`${EX}city/perth`) }]);
  one('IRI local name ends with dot', [{ x: uri(`${EX}thing.`) }]);
  one('IRI local name starts with hyphen', [{ x: uri(`${EX}-x`) }]);
  one('IRI equal to a namespace', [{ x: uri(EX) }]);
  one('IRI under an empty prefix', [{ x: uri(`${EX}e/thing`) }]);
  one('IRI under an unsafe prefix label', [{ x: uri(`${EX}n/thing`) }]);
  one('IRI with non-ASCII local name', [{ x: uri(`${EX}café`) }]);
  one('IRI with emoji', [{ x: uri(`urn:x:😀`) }]);
  one('plain literal with every escape', [{ x: lit('a"b\\c\nd\re\tf g😀\u0000h\u007f') }]);
  one('language tag', [{ x: lit('Perth', { 'xml:lang': 'en-AU' }) }]);
  one('language tag wins over datatype', [{ x: lit('Perth', { 'xml:lang': 'en', datatype: `${XSD}string` }) }]);
  one('typed literal', [{ x: lit('25', { datatype: `${XSD}integer` }) }]);
  one('datatype under a prefix stays full', [{ x: lit('v', { datatype: `${EX}dt` }) }]);
  one('typed-literal without datatype', [{ x: { type: 'typed-literal', value: 'v' } }]);
  one('typed-literal with datatype', [{ x: { type: 'typed-literal', value: '1', datatype: `${XSD}int` } }]);
  one('several rows', [{ x: uri(`${EX}a`) }, { x: lit('b') }, { x: null }]);
  one('zero rows', []);
  one('one empty row', [{}]);
  one('one null row', [null]);
  one('null row mixed with a bound row', [null, { x: uri(`${EX}a`) }]);
  one('empty row mixed with a bound row', [{ x: uri(`${EX}a`) }, {}]);
  one('row with only an undeclared key', [{ y: uri(`${EX}a`) }]);
  one('row with an undeclared key', [{ x: uri(`${EX}a`), y: uri(`${EX}b`) }]);
  one('IRI with a space', [{ x: uri('http://example.org/a b') }]);
  one('IRI with an angle bracket', [{ x: uri('http://example.org/a>b') }]);
  one('IRI with a control character', [{ x: uri('http://example.org/a\u0001') }]);
  one('empty IRI', [{ x: uri('') }]);
  one('language tag with trailing newline', [{ x: lit('a', { 'xml:lang': 'en\n' }) }]);
  one('language tag with underscore', [{ x: lit('a', { 'xml:lang': 'en_AU' }) }]);
  one('language tag with non-ASCII letter', [{ x: lit('a', { 'xml:lang': 'ен' }) }]);
  one('language tag starting with a digit', [{ x: lit('a', { 'xml:lang': '1en' }) }]);
  one('datatype with a space', [{ x: lit('a', { datatype: 'http://example.org/a b' }) }]);
  one('blank node', [{ x: { type: 'bnode', value: 'b0' } }]);
  one('unknown term type', [{ x: { type: 'triple', value: 'x' } }]);
  one('term with no type', [{ x: { value: 'x' } }]);
  one('value is a number', [{ x: { type: 'literal', value: 3 } }]);
  one('term is a string', [{ x: 'http://example.org/a' }]);
  one('row is an array', [[uri(`${EX}a`)]]);
  one('row is a string', ['x']);

  calls.push(
    { name: 'one: extra members are dropped', bundle: 'terms', query: 'one', payload: payload({ arguments: [{ ...set(['x'], [{ x: uri(`${EX}a`) }]), extra: true }] }) },
    { name: 'one: omitted', bundle: 'terms', query: 'one', payload: '{}' },
    { name: 'one: empty arguments', bundle: 'terms', query: 'one', payload: payload({ arguments: [] }) },
    { name: 'one: short form', bundle: 'terms', query: 'one', payload: payload({ arguments: [{ bindings: [{ x: uri(`${EX}a`) }] }] }) },
    { name: 'one: short form with a null row', bundle: 'terms', query: 'one', payload: payload({ arguments: [{ bindings: [null] }] }) },
    { name: 'one: too many short forms', bundle: 'terms', query: 'one', payload: payload({ arguments: [{ bindings: [] }, { bindings: [] }] }) },
    { name: 'one: unknown slot', bundle: 'terms', query: 'one', payload: payload({ arguments: [set(['nope'], [])] }) },
    { name: 'one: two sets for one slot', bundle: 'terms', query: 'one', payload: payload({ arguments: [set(['x'], []), set(['x'], [])] }) },
    { name: 'one: no head', bundle: 'terms', query: 'one', payload: payload({ arguments: [{ results: { bindings: [] } }] }) },
    { name: 'one: head vars not strings', bundle: 'terms', query: 'one', payload: payload({ arguments: [{ head: { vars: [1] }, results: { bindings: [] } }] }) },
    { name: 'one: rows under arguments', bundle: 'terms', query: 'one', payload: payload({ arguments: [{ head: { vars: ['x'] }, arguments: [] }] }) },
    { name: 'one: no results', bundle: 'terms', query: 'one', payload: payload({ arguments: [{ head: { vars: ['x'] } }] }) },
    { name: 'one: bindings not an array', bundle: 'terms', query: 'one', payload: payload({ arguments: [{ head: { vars: ['x'] }, results: { bindings: {} } }] }) },
    { name: 'one: duplicate key keeps the last value', bundle: 'terms', query: 'one', payload: '{"arguments":[{"head":{"vars":["x"]},"results":{"bindings":[{"x":{"type":"uri","value":"http://example.org/first"},"x":{"type":"uri","value":"http://example.org/last"}}]}}]}' },
    { name: 'one: JSON escapes in the payload', bundle: 'terms', query: 'one', payload: '{"arguments":[{"head":{"vars":["x"]},"results":{"bindings":[{"x":{"type":"literal","value":"\\u00e9\\ud835\\udd38\\/\\b\\f"}}]}}]}' },
  );

  const multi = (name: string, sets: unknown[]) =>
    calls.push({ name: `multi: ${name}`, bundle: 'terms', query: 'multi', payload: payload({ arguments: sets }) });
  multi('partial rows', [set(['a', 'b', 'c'], [{ a: uri(`${EX}a`) }, { b: lit('b'), c: lit('c') }])]);
  multi('head order differs from slot order', [set(['c', 'a', 'b'], [{ a: uri(`${EX}1`), b: uri(`${EX}2`), c: uri(`${EX}3`) }])]);
  multi('zero rows', [set(['a', 'b', 'c'], [])]);
  multi('one empty row', [set(['a', 'b', 'c'], [{}])]);
  multi('subset of the variables', [set(['a', 'b'], [{ a: uri(`${EX}a`) }])]);
  multi('a row with every cell null', [set(['a', 'b', 'c'], [{ a: null, b: null, c: null }])]);
  multi('rows with every cell null and a bound row', [set(['a', 'b', 'c'], [{ a: null }, { a: uri(`${EX}a`) }])]);

  const twin = (name: string, sets: unknown[]) =>
    calls.push({ name: `twin: ${name}`, bundle: 'terms', query: 'twin', payload: payload({ arguments: sets }) });
  twin('two sets fill the twin slots in order', [set(['k'], [{ k: uri(`${EX}1`) }]), set(['k'], [{ k: uri(`${EX}2`) }])]);
  twin('one set fills the first twin', [set(['k'], [{ k: uri(`${EX}1`) }])]);
  twin('sets out of slot order', [set(['z'], [{ z: uri(`${EX}z`) }]), set(['k'], [{ k: uri(`${EX}1`) }])]);
  twin('three sets for two twins', [set(['k'], []), set(['k'], []), set(['k'], [])]);
  twin('short forms fill slots by position', [{ bindings: [{ k: uri(`${EX}1`) }] }, { bindings: [] }, { bindings: [{ z: lit('z') }] }]);

  const wide = (name: string, value: unknown) =>
    calls.push({ name: `wide: ${name}`, bundle: 'terms', query: 'wide', payload: typeof value === 'string' ? value : payload(value) });
  wide('page and slot after non-BMP text', { arguments: [set(['x'], [{ x: lit('𝔸😀') }])], limits: [{ name: 'page', value: 25 }], offsets: [{ name: 'skip', value: 1000 }] });
  wide('page parameters as a map', { limits: { page: 5 }, offsets: { skip: 0 } });
  wide('unsupplied page parameters keep their placeholders', { arguments: [set(['x'], [{ x: lit('a') }])] });
  wide('only the offset', { offsets: [{ name: 'skip', value: 7 }] });
  wide('a name with no span is ignored', { limits: [{ name: 'other', value: 3 }] });
  wide('limit 25.0', '{"limits":[{"name":"page","value":25.0}]}');
  wide('limit 2.5e1', '{"limits":[{"name":"page","value":2.5e1}]}');
  wide('limit 0', { limits: [{ name: 'page', value: 0 }] });
  wide('limit -0', '{"limits":[{"name":"page","value":-0}]}');
  wide('limit 2^53-1', '{"limits":[{"name":"page","value":9007199254740991}]}');
  wide('limit 2^53', '{"limits":[{"name":"page","value":9007199254740992}]}');
  wide('limit -1', { limits: [{ name: 'page', value: -1 }] });
  wide('limit 1.5', { limits: [{ name: 'page', value: 1.5 }] });
  wide('limit 1e21', '{"limits":[{"name":"page","value":1e21}]}');
  wide('limit 1e-7', '{"limits":[{"name":"page","value":1e-7}]}');
  wide('limit 123456.789', '{"limits":[{"name":"page","value":123456.789}]}');
  wide('limit as a string', { limits: [{ name: 'page', value: '25' }] });
  wide('limit as null', { limits: [{ name: 'page', value: null }] });
  wide('offset -2', { offsets: { skip: -2 } });

  const union = (name: string, value: unknown) =>
    calls.push({ name: `union: ${name}`, bundle: 'terms', query: 'union', payload: payload(value) });
  union('repeated name fills every span', { limits: [{ name: 'page', value: 10 }], offsets: [{ name: 'page', value: 4 }] });
  union('the last value of a repeated name wins', { limits: [{ name: 'page', value: 10 }, { name: 'page', value: 20 }] });
  union('slot inside a sub-select with page spans after it', { arguments: [set(['t'], [{ t: uri(`${EX}T`) }])], limits: { page: 3 } });

  calls.push({ name: 'graph: CONSTRUCT with no slots', bundle: 'terms', query: 'graph', payload: '{}' });
  calls.push({ name: 'graph: argument for a query with no slots', bundle: 'terms', query: 'graph', payload: payload({ arguments: [set(['x'], [])] }) });

  // Slot policies and identity slots.
  const policies = await bundleOf({
    policy: await query(
      `SELECT * WHERE { «VALUES ?r { UNDEF }» «VALUES ?e { UNDEF }» «VALUES ?u { UNDEF }» «VALUES ?n { UNDEF }» «VALUES ?t { UNDEF }» «VALUES (?p ?q) { (UNDEF UNDEF) }» }`,
      {
        inputPolicies: [
          { vars: ['r'], whenEmpty: 'require' },
          { vars: ['e'], whenEmpty: 'propagateEmpty' },
          { vars: ['u'], whenEmpty: 'unconstrained' },
          { vars: ['t'], valuePattern: '^[A-Za-z0-9 ]{1,10}$' },
          { vars: ['q', 'p'], whenEmpty: 'require', valuePattern: '^(?:https?://|[a-z]+$)' },
        ],
      },
    ),
    identity: await query(`SELECT * WHERE { «VALUES ?authUser { UNDEF }» «VALUES ?x { UNDEF }» «VALUES ?authGroup { UNDEF }» ?x ?p ?authUser }`),
    identityMixed: await query(`SELECT * WHERE { «VALUES (?authUser ?x) { (UNDEF UNDEF) }» }`),
  });
  bundles.policies = { json: JSON.stringify(policies) };
  load.push({ name: 'policies loads', bundle: 'policies' });

  const r = set(['r'], [{ r: lit('r') }]);
  const pq = set(['p', 'q'], [{ p: lit('p'), q: uri('http://example.org/q') }]);
  const policy = (name: string, sets: unknown[]) =>
    calls.push({ name: `policy: ${name}`, bundle: 'policies', query: 'policy', payload: payload({ arguments: sets }) });
  policy('nothing supplied', []);
  policy('required slots supplied', [r, pq]);
  policy('required slot with zero rows', [set(['r'], []), pq]);
  policy('required slot with one empty row', [set(['r'], [{}]), pq]);
  policy('multi-variable required slot omitted', [r]);
  policy('propagateEmpty with one empty row', [r, pq, set(['e'], [{}])]);
  policy('propagateEmpty with rows', [r, pq, set(['e'], [{ e: lit('e') }])]);
  policy('unconstrained with zero rows', [r, pq, set(['u'], [])]);
  policy('no policy with zero rows', [r, pq, set(['n'], [])]);
  policy('no policy with one empty row', [r, pq, set(['n'], [{}])]);
  policy('value pattern matches', [r, pq, set(['t'], [{ t: lit('Perth 2') }])]);
  policy('value pattern refuses', [r, pq, set(['t'], [{ t: lit('Perth"; DROP') }])]);
  policy('value pattern refuses a non-BMP value', [r, pq, set(['t'], [{ t: lit('😀') }])]);
  policy('value pattern skips UNDEF cells', [r, set(['p', 'q'], [{ p: lit('abc') }])]);
  policy('value pattern on an IRI', [r, set(['p', 'q'], [{ p: lit('abc'), q: uri('ftp://x') }])]);
  policy('value pattern runs before the require check', [set(['r'], []), set(['p', 'q'], [{ p: lit('A') }])]);

  const identity = (name: string, q: string, sets: unknown[]) =>
    calls.push({ name: `identity: ${name}`, bundle: 'policies', query: q, payload: payload({ arguments: sets }) });
  identity('identity slots get zero rows', 'identity', [set(['x'], [{ x: lit('x') }])]);
  identity('an argument naming authUser', 'identity', [set(['authUser'], [{ authUser: uri(`${EX}me`) }])]);
  identity('an argument naming authGroup and another variable', 'identity', [set(['x', 'authGroup'], [])]);
  identity('identity variable inside a multi-variable slot', 'identityMixed', []);

  // Bundles that load or are refused.
  const v2 = fixtures['bundle-v2.json'];
  const refuse = (name: string, json: string) => {
    bundles[name] = { json };
    load.push({ name: `refuse: ${name}`, bundle: name });
  };
  const accept = (name: string, json: string) => {
    bundles[name] = { json };
    load.push({ name: `accept: ${name}`, bundle: name });
  };

  accept('version 1.0', JSON.stringify(v2).replace('"version":2', '"version":1.0'));
  accept('unknown fields', edited(v2, {
    futureField: { a: 1 },
    'queries.people-by-city.futureField': [1, 2],
    'queries.people-by-city.template.futureField': 'x',
  }));
  accept('no queries', JSON.stringify({ version: 2, library: { id: 'urn:x' }, queries: {} }));
  accept('queries as an empty array', JSON.stringify({ version: 2, library: { id: 'urn:x' }, queries: [] }));
  refuse('version 3', edited(v2, { version: 3 }));
  refuse('version as a string', edited(v2, { version: '2' }));
  refuse('version missing', edited(v2, { version: DELETE }));
  refuse('version null', edited(v2, { version: null }));
  refuse('version 2.5', edited(v2, { version: 2.5 }));
  refuse('not an object', '[1,2]');
  refuse('null bundle', 'null');
  refuse('library id missing', edited(v2, { 'library.id': DELETE }));
  refuse('queries missing', edited(v2, { queries: DELETE }));
  refuse('query is null', edited(v2, { 'queries.bad': null }));
  refuse('unsupported query type', edited(v2, { 'queries.people-by-city.queryType': 'UPDATE' }));
  refuse('template text edited', edited(v2, {
    'queries.people-by-city.template.text': (text) => String(text).replace('?name ?city', '?city ?name'),
  }));
  refuse('update text edited', edited(v2, { 'updates.*.template.text': append }));
  refuse('ETL job text edited', edited(v2, { 'etlJobs.*.template.text': append }));
  refuse('rule set text edited', edited(v2, { 'ruleSets.*.srl': append }));
  refuse('text hash without prefix', edited(v2, { 'queries.people-by-city.textHash': 'abc' }));
  refuse('slot moved off VALUES', edited(v2, { 'queries.people-by-city.template.slots.0.start': (start) => Number(start) + 1 }));
  refuse('slot outside the text', edited(v2, { 'queries.people-by-city.template.slots.0.end': 100000 }));
  refuse('slot with fractional bounds', edited(v2, { 'queries.people-by-city.template.slots.0.end': 117.5 }));
  refuse('slot with no variables', edited(v2, { 'queries.people-by-city.template.slots.0.vars': [] }));
  refuse('slot with an unsafe variable', edited(v2, { 'queries.people-by-city.template.slots.0.vars': ['a-b'] }));
  refuse('slot with a duplicate variable', edited(v2, { 'queries.people-by-city.template.slots.0.vars': ['city', 'city'] }));
  refuse('template text empty', edited(v2, { 'queries.people-by-city.template.text': '' }));
  refuse('template prefixes missing', edited(v2, { 'queries.people-by-city.template.prefixes': DELETE }));
  refuse('inferred inputs length', edited(v2, { 'queries.people-by-city.inferredInputs': [] }));
  refuse('page span off LIMIT', edited(v2, { 'queries.paged-things.pageParameters.0.start': (start) => Number(start) + 1 }));
  refuse('page span with unknown kind', edited(v2, { 'queries.paged-things.pageParameters.0.kind': 'top' }));
  refuse('page span outside the text', edited(v2, { 'queries.paged-things.pageParameters.1.end': 100000 }));
  refuse('page spans overlap', edited(v2, {
    'queries.paged-things.pageParameters.1.start': v2.queries['paged-things'].pageParameters![0].start,
    'queries.paged-things.pageParameters.1.kind': 'limit',
  }));
  refuse('policy names an undeclared slot', edited(v2, { 'queries.paged-things.inputPolicies.0.vars': ['nope'] }));
  refuse('policy with an unknown mode', edited(v2, { 'queries.paged-things.inputPolicies.0.whenEmpty': 'always' }));
  refuse('policy with neither field', edited(v2, { 'queries.paged-things.inputPolicies.0.whenEmpty': DELETE }));
  refuse('policy with an invalid pattern', edited(v2, { 'queries.paged-things.inputPolicies.0.valuePattern': '(' }));
  refuse('policy with an empty pattern', edited(v2, { 'queries.paged-things.inputPolicies.0.valuePattern': '' }));
  refuse('policy with a long pattern', edited(v2, { 'queries.paged-things.inputPolicies.0.valuePattern': 'a'.repeat(201) }));
  refuse('example with too many arguments', edited(v2, {
    'queries.people-by-city.examples.0.arguments': (sets) => [...(sets as Json[]), ...(sets as Json[])],
  }));
  refuse('example with no name', edited(v2, { 'queries.people-by-city.examples.0.name': '' }));
  refuse('group names a missing query', edited(v2, { 'groups.*.nodes.*.query': 'nope' }));
  refuse('group edge fills an undeclared slot', edited(v2, {
    'groups.*.edges': (edges) => {
      const list = edges as JsonObject[];
      return [...list, { ...list[0], from: list[0].to, to: list[0].from }];
    },
  }));
  refuse('group with a cycle', edited(terms, {
    groups: {
      loop: {
        nodes: { a: { query: 'one' }, b: { query: 'one' } },
        edges: [
          { from: 'a', to: 'b', targetVars: ['x'], mappings: [{ source: 'x', target: 'x' }] },
          { from: 'b', to: 'a', targetVars: ['x'], mappings: [] },
        ],
        resultNode: 'b',
      },
    },
  }));
  refuse('group edge from a CONSTRUCT', edited(terms, {
    groups: {
      bad: {
        nodes: { a: { query: 'graph' }, b: { query: 'one' } },
        edges: [{ from: 'a', to: 'b', targetVars: ['x'], mappings: [], whenEmpty: 'require' }],
        resultNode: 'b',
      },
    },
  }));
  accept('group that walks', edited(terms, {
    groups: {
      walk: {
        nodes: { a: { query: 'one' }, b: { query: 'one' } },
        edges: [{ from: 'a', to: 'b', targetVars: ['x'], mappings: [{ source: 'x', target: 'x' }], whenEmpty: 'propagateEmpty' }],
        resultNode: 'b',
      },
    },
  }));
  refuse('ETL job with no columns', edited(v2, { 'etlJobs.*.columns': [] }));
  refuse('rule set with no SRL', edited(v2, { 'ruleSets.*.srl': ' ' }));

  // An exported text with non-BMP characters, hashed over UTF-8.
  const nonBmp = await bundleOf({ q: await query(`SELECT * WHERE { ?s ?p "𝔸😀é" . «VALUES ?x { UNDEF }» }`) });
  bundles['non-BMP text'] = { json: JSON.stringify(nonBmp) };
  load.push({ name: 'non-BMP text loads', bundle: 'non-BMP text' });
  calls.push({ name: 'non-BMP text: slot after astral characters', bundle: 'non-BMP text', query: 'q', payload: payload({ arguments: [set(['x'], [{ x: lit('é') }])] }) });
  const lone = await bundleOf({ q: await query(`SELECT * WHERE { ?s ?p "\ud800" . «VALUES ?x { UNDEF }» }`) });
  bundles['lone surrogate text'] = { json: JSON.stringify(lone) };
  load.push({ name: 'lone surrogate text loads', bundle: 'lone surrogate text' });

  calls.push(...randomCalls());
  return { bundles, load, calls, valuePatterns: [...patternCases(), ...randomPatternCases()] };
}

/** mulberry32: a small seeded generator, so the random cases are the same on every run. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T,>(items: readonly T[]): T => items[int(items.length)];
  return { next, int, pick };
}

const PIECES = [
  'a', 'Z', '0', '9', '_', '-', '.', '/', ':', '#', ' ', '"', '\\', '\n', '\r', '\t', '\u0000', '\u0001', '\u001f', '\u007f',
  '<', '>', '{', '}', '|', '^', '`', 'é', 'ü', 'ſ', 'K', '\u00a0', '\u2028', '\u2029', '\ufeff', '\u0085',
  '😀', '𝔸', '\ud800', '\udc00', 'Ω', '١', 'ﬀ',
];

function randomText(rng: ReturnType<typeof generator>, max: number): string {
  let out = '';
  const length = rng.int(max + 1);
  for (let i = 0; i < length; i++) out += rng.pick(PIECES);
  return out;
}

function randomTerm(rng: ReturnType<typeof generator>): unknown {
  switch (rng.int(9)) {
    case 0:
      return null;
    case 1:
    case 2:
      return uri(`${rng.pick([EX, `${EX}a/`, `${EX}e/`, 'urn:x:', 'http://other.org/'])}${randomText(rng, 4)}`);
    case 3:
      return lit(randomText(rng, 8));
    case 4:
      return lit(randomText(rng, 4), { 'xml:lang': rng.pick(['en', 'en-AU', 'de-1996', 'x', 'EN-gb', 'en-', '-en', 'e n', 'en\n', 'ен', 'a1']) });
    case 5:
      return lit(randomText(rng, 4), { datatype: rng.pick([`${XSD}integer`, `${EX}dt`, 'urn:dt', 'http://x/a b', '']) });
    case 6:
      return { type: 'typed-literal', value: randomText(rng, 4) };
    case 7:
      return lit(randomText(rng, 3), { 'xml:lang': 'en', datatype: `${XSD}string` });
    default:
      return rng.pick([{ type: 'bnode', value: 'b' }, { type: 'uri', value: 1 }, 'x', { type: 'other', value: 'v' }]);
  }
}

function randomCalls(): CallCase[] {
  const rng = generator(252);
  const cases: CallCase[] = [];
  for (let i = 0; i < 160; i++) {
    const kind = rng.int(4);
    if (kind === 0) {
      const rows = Array.from({ length: rng.int(4) }, () => (rng.int(8) === 0 ? null : { x: randomTerm(rng) }));
      cases.push({ name: `random ${i}: one`, bundle: 'terms', query: 'one', payload: payload({ arguments: [set(['x'], rows)] }) });
    } else if (kind === 1) {
      const vars = ['a', 'b', 'c'];
      const rows = Array.from({ length: rng.int(4) }, () => {
        const row: Record<string, unknown> = {};
        for (const v of vars) if (rng.int(3) > 0) row[v] = randomTerm(rng);
        return row;
      });
      // A Fisher-Yates shuffle. Array.prototype.sort with a random comparator
      // gives a different order on each engine version.
      const head = [...vars];
      for (let j = head.length - 1; j > 0; j--) {
        const k = rng.int(j + 1);
        [head[j], head[k]] = [head[k], head[j]];
      }
      cases.push({ name: `random ${i}: multi`, bundle: 'terms', query: 'multi', payload: payload({ arguments: [set(head, rows)] }) });
    } else if (kind === 2) {
      const value = () => rng.pick([0, 1, 7, 25, 1000, -1, 1.5, 2 ** 53 - 1, 2 ** 53, 1e21, 0.1, 123456789]);
      const limits = rng.int(2) ? { page: value() } : [{ name: 'page', value: value() }, { name: 'page', value: value() }];
      const offsets = rng.int(2) ? [{ name: 'skip', value: value() }] : {};
      const args = rng.int(2) ? [set(['x'], [{ x: lit(randomText(rng, 5)) }])] : [];
      cases.push({ name: `random ${i}: wide`, bundle: 'terms', query: 'wide', payload: payload({ arguments: args, limits, offsets }) });
    } else {
      const sets: unknown[] = [set(['r'], [{ r: lit('r') }])];
      sets.push(set(['q', 'p'], [{ p: lit(rng.pick(['abc', 'A', 'http://x', ''])), q: uri(rng.pick(['https://x', 'ftp://y', 'urn:z'])) }]));
      if (rng.int(2)) sets.push(set(['t'], Array.from({ length: 1 + rng.int(2) }, () => ({ t: lit(randomText(rng, 6)) }))));
      if (rng.int(2)) sets.push(set(['e'], rng.int(2) ? [] : [{}]));
      cases.push({ name: `random ${i}: policy`, bundle: 'policies', query: 'policy', payload: payload({ arguments: sets }) });
    }
  }
  return cases;
}

function randomPatternCases(): PatternCase[] {
  const rng = generator(2520);
  const patterns = [
    '^[A-Za-z0-9 ]{1,20}$', '^.{1,3}$', '^[^a-z]+$', '^\\S+$', '\\s', '^\\w+$', '\\W', '^\\D*$', '\\bé', '\\B',
    '^(?:[a-z]|😀)+$', '^[\\u00e0-\\u00ff]$', '.\\z', '^$', '(?<=a).', '(?<!\\d)\\d$', '^(?=.*😀).*$', '^[^]*$', '[^\\s\\d]',
  ];
  const cases: PatternCase[] = [];
  for (let i = 0; i < 120; i++) {
    const pattern = rng.pick(patterns.filter((p) => p !== '.\\z'));
    const value = randomText(rng, 5);
    cases.push({ name: `random pattern ${i}: ${JSON.stringify(pattern)} on ${JSON.stringify(value)}`, pattern, value });
  }
  return cases;
}

/** Value patterns and values, for the match result of each. */
function patternCases(): PatternCase[] {
  const cases: [string, string][] = [
    ['^[A-Za-z0-9 ]{1,20}$', 'Perth 2'],
    ['^[A-Za-z0-9 ]{1,20}$', 'Perth\n'],
    ['^abc$', 'abc'],
    ['^abc$', 'abc\n'],
    ['^abc$', 'ABC'],
    ['abc', 'xxabcxx'],
    ['^a.c$', 'abc'],
    ['^a.c$', 'a\nc'],
    ['^a.c$', 'a\rc'],
    ['^a.c$', 'a c'],
    ['^a.c$', 'a c'],
    ['^a.c$', 'a\u0085c'],
    ['^a.c$', 'a😀c'],
    ['^.$', '😀'],
    ['^.{2}$', '😀'],
    ['^.{2}$', 'é😀'],
    ['^[^a]$', '😀'],
    ['^[^a]{2}$', '😀'],
    ['^[^]$', '\n'],
    ['^[^]$', '😀'],
    ['[]', 'a'],
    ['^\\d+$', '0123456789'],
    ['^\\d+$', '١٢'],
    ['^\\D$', '😀'],
    ['^\\D$', '1'],
    ['^\\w+$', 'a_Z9'],
    ['^\\w+$', 'é'],
    ['^\\w$', 'ſ'],
    ['^\\W$', 'é'],
    ['^\\W$', '😀'],
    ['\\s', '﻿'],
    ['\\s', '\u0085'],
    ['\\s', ' '],
    ['\\s', '᠎'],
    ['\\s', '　'],
    ['^\\S+$', 'a b'],
    ['^\\S$', '😀'],
    ['\\bfoo\\b', 'éfooé'],
    ['\\bfoo\\b', 'afoo'],
    ['\\Bfoo', 'afoo'],
    ['^K$', 'K'],
    ['^k$', 'K'],
    ['^(?:ab|cd)+$', 'abcdab'],
    ['^(ab|cd)+$', 'abce'],
    ['^a{2,3}?$', 'aaa'],
    ['^a{2,}$', 'a'],
    ['^a{2}$', 'aa'],
    ['^(?=.*\\d)(?=.*[a-z]).{6,}$', 'abc123'],
    ['^(?!.*admin).*$', 'superadmin'],
    ['(?<=\\$)\\d+', '$12'],
    ['(?<!\\$)\\b\\d+', '$12'],
    ['^(?<year>\\d{4})-\\d{2}$', '2026-11'],
    ['^\\u{1F600}$', '😀'],
    ['^\\u{1F600}+$', '😀😀'],
    ['^😀+$', '😀😀'],
    ['^\\uD83D\\uDE00$', '😀'],
    ['^\\x41\\u0042$', 'AB'],
    ['^\\t\\n\\v\\f\\r$', '\t\n\v\f\r'],
    ['^\\cJ$', '\n'],
    ['^\\0$', '\u0000'],
    ['^[\\-a]+$', '-a-'],
    ['^[a-z-]+$', 'ab-c'],
    ['^[\\b]$', '\b'],
    ['^\\/path$', '/path'],
    ['^\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\^\\$\\\\$', '.*+?()[]{}|^$\\'],
    ['^a|b$', 'xb'],
    ['^[é-ü]+$', 'éü'],
    ['^[\\u00e9-\\u00fc]+$', 'éfü'],
    ['^[\\d_]+$', '1_2'],
    ['^[\\w.-]+@[\\w.-]+$', 'a.b@c-d.e'],
    ['^[\\s]+$', ' \t '],
    ['[$]', 'a$'],
    ['^[^\\d\\s]+$', 'ab'],
    ['^[^\\d\\s]+$', 'a b'],
    ['^(?:a|)$', ''],
    ['^$', ''],
    ['(', 'a'],
    ['a{', 'a'],
    ['a{1', 'a'],
    ['}', '}'],
    [']', ']'],
    ['\\-', '-'],
    ['[b-a]', 'a'],
    ['a**', 'a'],
    ['\\8', '8'],
    ['\\00', '0'],
    ['\\c1', 'x'],
    ['(?=a)+', 'a'],
    ['(?<!a)*', 'a'],
    ['a{3,2}', 'a'],
    ['\\u{110000}', 'a'],
    ['[\\d-z]', 'a'],
    ['(?<n>a)(?<n>b)', 'ab'],
    ['\\q', 'q'],
  ];
  return cases.map(([pattern, value], index) => ({ name: `pattern ${index}: ${JSON.stringify(pattern)} on ${JSON.stringify(value)}`, pattern, value }));
}
