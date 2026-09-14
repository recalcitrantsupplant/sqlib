/**
 * The query vocabulary both Phase 2 layers draw from.
 *
 * Every template runs against `test/scenarios/data/phase2-graph.ttl` and is
 * small enough that its result set can be written down, because the matrix and
 * the fuzz oracle both assert exact multisets rather than "more than zero rows".
 *
 * Two conventions are load-bearing:
 *
 * 1. A parameter slot is always spelled `VALUES (?a ?b) { (UNDEF UNDEF) }` on one
 *    line. The reference interpreter substitutes by regex over that exact shape,
 *    so it never touches `SparqlQueryParser.applyArguments` - the oracle must not
 *    inherit the implementation's bugs (docs §2.3).
 * 2. `outputVars` is sorted. `detectQueryOutputs` sorts, so the auto output tuple
 *    minted for a SELECT carries its members in sorted order, and positional edge
 *    mapping runs over that order. Writing the sorted order down here keeps the
 *    oracle's rename arithmetic honest.
 */

export type TemplateResultKind = 'bindings' | 'rdf' | 'boolean' | 'update';

export interface QueryTemplate {
  key: string;
  sparql: string;
  kind: TemplateResultKind;
  /** SELECT projection, sorted - the auto output tuple's member order. */
  outputVars: string[];
  /** One entry per VALUES parameter slot, each sorted, in detection order. */
  inputSlots: string[][];
}

const PREFIX = 'PREFIX ex: <http://example.org/>';

const template = (
  key: string,
  kind: TemplateResultKind,
  outputVars: string[],
  inputSlots: string[][],
  body: string,
): QueryTemplate => ({
  key,
  kind,
  outputVars: [...outputVars].sort(),
  inputSlots,
  sparql: `${PREFIX}\n${body.trim()}\n`,
});

/** Sources: no parameter slot, so they can open a chain. */
export const SOURCE_TEMPLATES: QueryTemplate[] = [
  template('things', 'bindings', ['thing'], [], `
SELECT ?thing WHERE { ?thing a ex:Thing . }
`),
  template('labelledThings', 'bindings', ['thing'], [], `
SELECT ?thing WHERE { ?thing ex:label ?label . }
`),
  template('groups', 'bindings', ['group'], [], `
SELECT ?group WHERE { ?group a ex:Group . }
`),
  // Matches nothing: the empty-upstream case that whenEmpty exists to govern.
  template('noThings', 'bindings', ['thing'], [], `
SELECT ?thing WHERE { ?thing a ex:Missing . }
`),
  // Two rows for one subject, so fan-in dedupe has something to dedupe.
  template('thingLabelPairs', 'bindings', ['label', 'thing'], [], `
SELECT ?label ?thing WHERE { ?thing ex:label ?label . }
`),
];

/** Filters: exactly one single-variable parameter slot. */
export const FILTER_TEMPLATES: QueryTemplate[] = [
  template('thingByThing', 'bindings', ['thing'], [['thing']], `
SELECT ?thing WHERE {
  VALUES (?thing) { (UNDEF) }
  ?thing a ex:Thing .
}
`),
  // Output variable differs from the input variable: the rename path.
  template('groupByThing', 'bindings', ['group'], [['thing']], `
SELECT ?group WHERE {
  VALUES (?thing) { (UNDEF) }
  ?thing ex:group ?group .
}
`),
  template('labelByThing', 'bindings', ['label'], [['thing']], `
SELECT ?label WHERE {
  VALUES (?thing) { (UNDEF) }
  ?thing ex:label ?label .
}
`),
  template('nameByGroup', 'bindings', ['name'], [['group']], `
SELECT ?name WHERE {
  VALUES (?group) { (UNDEF) }
  ?group ex:name ?name .
}
`),
  // Projects the parameter straight back out, so a boolean or a literal fed into
  // it is observable in the result rather than silently joining to nothing.
  template('echoThing', 'bindings', ['thing'], [['thing']], `
SELECT ?thing WHERE {
  VALUES (?thing) { (UNDEF) }
}
`),
];

/**
 * Two-variable slots, for arity and member-order coverage - and for edge
 * variable mappings, which only become observable above arity 1.
 *
 * Variable *names* are picked deliberately. Tuple members always end up in
 * sorted order (both `detectQueryOutputs` and `detectInputs` sort), so for the
 * default edge mapping - exact name matches first, then the leftovers paired by
 * position - to differ from plain positional pairing, the shared name has to sit
 * at different indices on the two sides. `label,rank` feeding `group,label` does
 * that: name-matching pairs label->label and rank->group, positional pairing
 * would give label->group and rank->label. A corpus where the two rules
 * coincide tests neither of them.
 */
export const PAIR_TEMPLATES: QueryTemplate[] = [
  template('pairFilter', 'bindings', ['label', 'thing'], [['label', 'thing']], `
SELECT ?label ?thing WHERE {
  VALUES (?label ?thing) { (UNDEF UNDEF) }
  ?thing ex:label ?label .
}
`),
  template('echoPair', 'bindings', ['label', 'thing'], [['label', 'thing']], `
SELECT ?label ?thing WHERE {
  VALUES (?label ?thing) { (UNDEF UNDEF) }
}
`),
  // Echoes its slot straight back out, so whichever value landed in whichever
  // variable is visible in the final result rather than being joined away.
  template('echoGroupLabel', 'bindings', ['group', 'label'], [['group', 'label']], `
SELECT ?group ?label WHERE {
  VALUES (?group ?label) { (UNDEF UNDEF) }
}
`),
  template('echoLabelRank', 'bindings', ['label', 'rank'], [['label', 'rank']], `
SELECT ?label ?rank WHERE {
  VALUES (?label ?rank) { (UNDEF UNDEF) }
}
`),
];

/** Two-variable sources, so a pair chain has something to start from. */
export const PAIR_SOURCE_TEMPLATES: QueryTemplate[] = [
  template('labelRankPairs', 'bindings', ['label', 'rank'], [], `
SELECT ?label ?rank WHERE { ?thing ex:label ?label ; ex:rank ?rank . }
`),
  template('groupLabelPairs', 'bindings', ['group', 'label'], [], `
SELECT ?group ?label WHERE { ?thing ex:group ?group ; ex:label ?label . }
`),
  // The empty-upstream case at arity 2.
  template('noPairs', 'bindings', ['label', 'rank'], [], `
SELECT ?label ?rank WHERE { ?thing ex:missingLabel ?label ; ex:missingRank ?rank . }
`),
];

/** Non-SELECT result shapes. */
export const CONSTRUCT_TEMPLATES: QueryTemplate[] = [
  template('constructThings', 'rdf', [], [], `
CONSTRUCT { ?thing a ex:Copy . } WHERE { ?thing a ex:Thing . }
`),
  template('constructByThing', 'rdf', [], [['thing']], `
CONSTRUCT { ?thing a ex:Copy . } WHERE {
  VALUES (?thing) { (UNDEF) }
  ?thing a ex:Thing .
}
`),
];

export const ASK_TEMPLATES: QueryTemplate[] = [
  template('askThings', 'boolean', [], [], `
ASK { ?thing a ex:Thing . }
`),
  template('askMissing', 'boolean', [], [], `
ASK { ?thing a ex:Missing . }
`),
  template('askByThing', 'boolean', [], [['thing']], `
ASK {
  VALUES (?thing) { (UNDEF) }
  ?thing a ex:Thing .
}
`),
];

export const DESCRIBE_TEMPLATES: QueryTemplate[] = [
  template('describeThings', 'rdf', [], [], `
DESCRIBE ?thing WHERE { ?thing a ex:Thing . }
`),
  template('describeByThing', 'rdf', [], [['thing']], `
DESCRIBE ?thing WHERE {
  VALUES (?thing) { (UNDEF) }
}
`),
];

/**
 * Updates write into a named graph. Every other template reads the default
 * graph only, so an UPDATE node anywhere in a generated DAG cannot perturb
 * another node's result and break determinism (P5).
 */
export const UPDATE_TEMPLATES: QueryTemplate[] = [
  template('updateScratch', 'update', [], [], `
INSERT { GRAPH <urn:phase2:scratch> { ?thing a ex:Touched . } }
WHERE { ?thing a ex:Thing . }
`),
  template('updateByThing', 'update', [], [['thing']], `
INSERT { GRAPH <urn:phase2:scratch> { ?thing a ex:Touched . } }
WHERE {
  VALUES (?thing) { (UNDEF) }
}
`),
];

/**
 * Projects a blank node. Excluded from the fuzz corpus on purpose: chaining a
 * bnode is a named error, and the mutation suite asserts that deliberately
 * rather than leaving it to chance.
 */
export const BNODE_TEMPLATE: QueryTemplate = template('bnodeSource', 'bindings', ['thing'], [], `
SELECT ?thing WHERE { ?s ex:annotation ?thing . }
`);

/** Reads back what an UPDATE node wrote, so its effect is assertable. */
export const SCRATCH_TEMPLATES: QueryTemplate[] = [
  template('scratchThings', 'bindings', ['thing'], [], `
SELECT ?thing WHERE { GRAPH <urn:phase2:scratch> { ?thing a ex:Touched . } }
`),
];

export const ALL_TEMPLATES: QueryTemplate[] = [
  ...SCRATCH_TEMPLATES,
  ...SOURCE_TEMPLATES,
  ...FILTER_TEMPLATES,
  ...PAIR_SOURCE_TEMPLATES,
  ...PAIR_TEMPLATES,
  ...CONSTRUCT_TEMPLATES,
  ...ASK_TEMPLATES,
  ...DESCRIBE_TEMPLATES,
  ...UPDATE_TEMPLATES,
];

export const templateByKey = new Map(ALL_TEMPLATES.map(t => [t.key, t]));

export const getTemplate = (key: string): QueryTemplate => {
  const found = templateByKey.get(key);
  if (!found) throw new Error(`Unknown query template ${key}`);
  return found;
};

/** A SELECT returning exactly the given IRI, for seeding a QUERY_ID edge. */
export const queryIdSelect = (iri: string): string =>
  `${PREFIX}\nSELECT ?q WHERE { VALUES (?q) { (<${iri}>) } }\n`;
