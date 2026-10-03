/**
 * Reading the vendored W3C SPARQL-RL test manifests, without a triple store.
 *
 * This package has no RDF store to load Turtle into, and the harness used to
 * make do with one regular expression over each manifest — which matched only
 * when an entry listed `rdf:type`, `mf:name` and `mf:action` in that order,
 * separated just so. An entry written any other way was silently not a test.
 *
 * This reads the subset of Turtle the manifests use — `PREFIX`/`@prefix`,
 * subject blocks with `;` and `,`, `a`, IRIs, prefixed names, literals,
 * `[ … ]` and `( … )` — into subject → predicate → objects, so the order an
 * entry states its properties in does not matter, and walks `mf:entries` for
 * which entries count, as `packages/api/src/lib/w3cRulesSuite/manifest.ts`
 * does with a real store. Anything outside that subset is an error rather than
 * a guess.
 */

const MF = 'http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
/** The suite's own vocabulary. See the API reader for why it is exactly one IRI. */
const SRLT = 'http://www.w3.org/ns/sparql-rl-tests#';

type Node =
  | { kind: 'iri'; value: string }
  | { kind: 'blank'; id: string }
  | { kind: 'literal'; value: string }
  | { kind: 'list'; items: Node[] };

type Graph = Map<string, Map<string, Node[]>>;

export interface DocumentEntry {
  name: string;
  /** Whether the check should accept the document, from the entry's `rdf:type`. */
  positive: boolean;
  file: string;
}

export interface EvalEntry {
  name: string;
  ruleset: string;
  data: string;
  result: string;
}

/** The syntax/wellformed/stratification shape: a type, a name and one file. */
export function readDocumentManifest(ttl: string): DocumentEntry[] {
  const graph = parseTurtle(ttl);
  return entries(graph).map((subject) => {
    const type = iriOf(graph, subject, `${RDF}type`);
    if (!type.startsWith(SRLT)) throw new Error(`manifest entry ${subject} has type ${type}`);
    return {
      name: literalOf(graph, subject, `${MF}name`),
      positive: type.slice(SRLT.length).startsWith('RulesPositive'),
      file: fileOf(iriOf(graph, subject, `${MF}action`)),
    };
  });
}

/** The eval/eval2/examples shape: an action naming a rule set and data, and a result. */
export function readEvalManifest(ttl: string): EvalEntry[] {
  const graph = parseTurtle(ttl);
  return entries(graph).map((subject) => {
    const type = iriOf(graph, subject, `${RDF}type`);
    if (type !== `${SRLT}RulesEvalTest`) throw new Error(`manifest entry ${subject} has type ${type}`);
    const action = one(graph, subject, `${MF}action`);
    if (action.kind !== 'blank') throw new Error(`manifest entry ${subject} has no action node`);
    const actionKey = `_:${action.id}`;
    return {
      name: literalOf(graph, subject, `${MF}name`),
      ruleset: fileOf(iriOf(graph, actionKey, `${SRLT}ruleset`)),
      data: fileOf(iriOf(graph, actionKey, `${SRLT}data`)),
      result: fileOf(iriOf(graph, subject, `${MF}result`)),
    };
  });
}

/**
 * The manifest's `mf:entries`, in order. An entry defined but left out of the
 * list is not a test — `eval2/manifest.ttl` has one, naming files that are
 * not in the directory.
 */
function entries(graph: Graph): string[] {
  const manifests = [...graph].filter(([, props]) =>
    (props.get(`${RDF}type`) ?? []).some((n) => n.kind === 'iri' && n.value === `${MF}Manifest`));
  if (manifests.length !== 1) throw new Error(`expected one mf:Manifest, found ${manifests.length}`);
  const list = manifests[0][1].get(`${MF}entries`)?.[0];
  if (list?.kind !== 'list') throw new Error('mf:Manifest has no mf:entries list');
  return list.items.map((item) => {
    if (item.kind !== 'iri') throw new Error('mf:entries holds something other than an IRI');
    return item.value;
  });
}

function one(graph: Graph, subject: string, predicate: string): Node {
  const values = graph.get(subject)?.get(predicate) ?? [];
  if (values.length !== 1) throw new Error(`${subject} has ${values.length} values for <${predicate}>, expected 1`);
  return values[0];
}

function iriOf(graph: Graph, subject: string, predicate: string): string {
  const node = one(graph, subject, predicate);
  if (node.kind !== 'iri') throw new Error(`${subject} <${predicate}> is not an IRI`);
  return node.value;
}

function literalOf(graph: Graph, subject: string, predicate: string): string {
  const node = one(graph, subject, predicate);
  if (node.kind !== 'literal') throw new Error(`${subject} <${predicate}> is not a literal`);
  return node.value;
}

/** Every file a manifest names sits beside it, so only the last segment matters. */
function fileOf(iri: string): string {
  const file = iri.split('/').pop() ?? '';
  if (!file || file.includes('\\')) throw new Error(`unusable file IRI <${iri}>`);
  return file;
}

const TOKEN = new RegExp(
  [
    String.raw`(?<ws>\s+|#[^\n]*)`,
    String.raw`(?<iri><[^<>"{}|^\x60\\\s]*>)`,
    String.raw`(?<string>"(?:[^"\\\n]|\\.)*")(?:@[A-Za-z]+(?:-[A-Za-z0-9]+)*|\^\^(?:<[^>\s]*>|[A-Za-z][\w-]*:[\w-]*))?`,
    String.raw`(?<prefixDecl>@prefix|PREFIX\b)`,
    String.raw`(?<pname>(?:[A-Za-z](?:[\w-]|\.(?=[\w-]))*)?:(?:[\w-]|\.(?=[\w-]))*)`,
    String.raw`(?<a>a)(?=[\s<\[("])`,
    String.raw`(?<punct>[;,.\[\]()])`,
  ].join('|'),
  'y',
);

type Token = { type: 'iri' | 'string' | 'prefixDecl' | 'pname' | 'a' | 'punct'; text: string };

function tokenize(ttl: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < ttl.length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(ttl);
    if (!match?.groups) throw new Error(`manifest: cannot read Turtle at offset ${at}: ${ttl.slice(at, at + 30)}`);
    const [type, text] = Object.entries(match.groups).find(([, value]) => value !== undefined)!;
    if (type !== 'ws') tokens.push({ type: type as Token['type'], text });
  }
  return tokens;
}

function parseTurtle(ttl: string): Graph {
  const tokens = tokenize(ttl);
  const prefixes = new Map<string, string>();
  const graph: Graph = new Map();
  let at = 0;
  let blanks = 0;

  const peek = () => tokens[at];
  const next = () => {
    const token = tokens[at++];
    if (!token) throw new Error('manifest: unexpected end of Turtle');
    return token;
  };
  const expect = (text: string) => {
    const token = next();
    if (token.text !== text) throw new Error(`manifest: expected \`${text}\`, found \`${token.text}\``);
  };
  const add = (subject: string, predicate: string, object: Node) => {
    const props = graph.get(subject) ?? new Map<string, Node[]>();
    graph.set(subject, props);
    props.set(predicate, [...(props.get(predicate) ?? []), object]);
  };
  const resolve = (token: Token): string => {
    if (token.type === 'iri') return token.text.slice(1, -1);
    if (token.type === 'a') return `${RDF}type`;
    if (token.type === 'pname') {
      const colon = token.text.indexOf(':');
      const namespace = prefixes.get(token.text.slice(0, colon));
      if (namespace === undefined) throw new Error(`manifest: undeclared prefix in \`${token.text}\``);
      return namespace + token.text.slice(colon + 1);
    }
    throw new Error(`manifest: expected an IRI, found \`${token.text}\``);
  };

  const key = (node: Node): string => {
    if (node.kind === 'iri') return node.value;
    if (node.kind === 'blank') return `_:${node.id}`;
    throw new Error('manifest: a literal or list cannot be a subject');
  };

  const object = (): Node => {
    const token = next();
    if (token.type === 'string') {
      // Only the lexical form is read back; tag and datatype ride along unused.
      const lexical = /^"((?:[^"\\]|\\.)*)"/.exec(token.text)![1];
      return { kind: 'literal', value: lexical.replace(/\\(.)/g, '$1') };
    }
    if (token.text === '[') {
      const node: Node = { kind: 'blank', id: `b${blanks++}` };
      if (peek()?.text !== ']') predicateObjects(key(node));
      expect(']');
      return node;
    }
    if (token.text === '(') {
      const items: Node[] = [];
      while (peek()?.text !== ')') items.push(object());
      expect(')');
      return { kind: 'list', items };
    }
    return { kind: 'iri', value: resolve(token) };
  };

  // `p o, o ; p o ;` — a trailing `;` before the terminator is legal Turtle.
  function predicateObjects(subject: string): void {
    for (;;) {
      const predicate = resolve(next());
      add(subject, predicate, object());
      while (peek()?.text === ',') {
        next();
        add(subject, predicate, object());
      }
      while (peek()?.text === ';') next();
      const ahead = peek()?.text;
      if (ahead === '.' || ahead === ']' || ahead === undefined) return;
    }
  }

  while (at < tokens.length) {
    const token = peek();
    if (token.type === 'prefixDecl') {
      next();
      const label = next();
      const namespace = next();
      if (label.type !== 'pname' || !label.text.endsWith(':') || namespace.type !== 'iri') {
        throw new Error(`manifest: malformed prefix declaration at \`${label.text}\``);
      }
      prefixes.set(label.text.slice(0, -1), namespace.text.slice(1, -1));
      if (token.text === '@prefix') expect('.');
      continue;
    }
    const subject = key(object());
    predicateObjects(subject);
    expect('.');
  }
  return graph;
}
