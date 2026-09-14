/**
 * The rewrite, as a pure function: one SPARQL update in, the CONSTRUCT queries
 * that describe its effect out. Nothing here touches a store.
 *
 * The whole thing rests on one line of the SPARQL 1.1 Update spec: the DELETE
 * and INSERT templates of `DELETE { D } INSERT { I } WHERE { W }` are both
 * instantiated against the state of the graph store *before* the operation. So
 * `CONSTRUCT { D } WHERE { W }` and `CONSTRUCT { I } WHERE { W }`, run against
 * the store as it stands, do not approximate the update — they are its
 * definition with the mutation removed.
 *
 * Three details make that literal statement into working code:
 *
 * - **`INSERT DATA` and `DELETE DATA` are the same shape.** A ground template
 *   with `WHERE {}` — one empty solution — constructs exactly the data block, so
 *   the four data-changing forms share one path and one set of tests, and
 *   prefixed names in the block are expanded by the engine rather than here.
 * - **CONSTRUCT yields triples, not quads,** so a template is split by graph
 *   context: the default-graph portion and each `GRAPH` block become separate
 *   CONSTRUCTs over the same WHERE, and the caller stamps each result with the
 *   graph it came from.
 * - **`WITH` is a wrapper, not a dataset clause.** `WITH <g>` makes `<g>` the
 *   default graph for unqualified patterns while leaving named graphs reachable
 *   through explicit `GRAPH`, which is what `{ GRAPH <g> { W } }` means and what
 *   `FROM <g>` would have quietly broken.
 */

import { Parser } from '@traqula/parser-sparql-1-2';
import { sparql12GeneratorBuilder } from '@traqula/generator-sparql-1-2';
import { completeGeneratorContext } from '@traqula/rules-sparql-1-2';
import { UnsupportedUpdateError } from './errors.js';

/**
 * The slice of the traqula AST this module reads.
 *
 * Traqula's own node types are not exported in a form that narrows usefully
 * here, and the alternative — `any` at every access — would make a renamed
 * field a runtime surprise rather than a compile error. These describe only the
 * fields actually touched: everything else on a node stays unread and unnamed.
 */
interface AstTerm {
  type: string;
  subType: string;
  value: string;
  /** Present when the IRI was written as a prefixed name. */
  prefix?: string;
}

interface ContextDef {
  subType: string;
  key?: string;
  value: AstTerm;
}

/** One entry of a quads template: a bare triples block, or a `GRAPH` block. */
interface QuadsEntry {
  type: string;
  graph?: AstTerm;
  triples?: unknown;
}

/** The operand of a graph-management operation: `GRAPH <g>`, DEFAULT, NAMED, ALL. */
interface AstGraphRef {
  type: string;
  subType: string;
  graph?: AstTerm;
}

interface UpdateOperation {
  subType: string;
  data?: QuadsEntry[];
  insert?: QuadsEntry[];
  delete?: QuadsEntry[];
  where?: unknown;
  /** The `WITH` graph. */
  graph?: AstTerm;
  from?: { clauses?: unknown[] };
  /** Graph-management: the operand written after the keyword, or after `TO`. */
  destination?: AstGraphRef;
  /** Graph-management: the operand before `TO`, or `LOAD`'s document IRI. */
  source?: AstGraphRef | AstTerm;
  silent?: boolean;
}

interface UpdateUnit {
  context?: ContextDef[];
  operation: UpdateOperation;
}

interface UpdateAst {
  type: string;
  updates: UpdateUnit[];
}

/** The generator, addressed by rule name — which its type does not expose. */
type RuleGenerator = Record<string, (ast: unknown, context: unknown) => string>;

const parser = new Parser();
const generator = sparql12GeneratorBuilder.build() as unknown as RuleGenerator;
const generatorContext = completeGeneratorContext({});

function serialize(rule: string, ast: unknown): string {
  return generator[rule]!(ast, { ...generatorContext, origSource: '' }).trim();
}

/** Where a template's triples land. */
export type GraphTarget =
  | { kind: 'default' }
  | { kind: 'iri'; value: string }
  /** `GRAPH ?g { … }` — resolved per solution, see `derive.ts`. */
  | { kind: 'variable'; value: string };

/** One graph-homogeneous slice of a DELETE or INSERT template. */
export interface TemplatePart {
  graph: GraphTarget;
  /** The triples, as SPARQL text, relative to the operation's prologue. */
  text: string;
}

/** An operation whose effect is a set of added and removed quads. */
export interface QuadOperationPlan {
  kind: 'quads';
  form: 'insertdata' | 'deletedata' | 'deletewhere' | 'modify';
  /** `BASE`/`PREFIX` lines every generated query must carry. */
  prologue: string;
  deleteParts: TemplatePart[];
  insertParts: TemplatePart[];
  /** Group graph pattern, braces included. `{}` for the DATA forms. */
  whereText: string;
  /** `FROM`/`FROM NAMED` from `USING`, or `''`. */
  datasetText: string;
  /** Every template triple is ground, so the WHERE need not be evaluated. */
  ground: boolean;
  /** The operation as SPARQL, for replay during simulation. */
  text: string;
}

/**
 * Where a graph-management operation points.
 *
 * `DEFAULT`, `NAMED` and `ALL` are not IRIs and never become quad graphs — they
 * are scopes over the dataset, and keeping them as their own cases is what lets
 * `CLEAR ALL` be enumerated correctly instead of being mistaken for a graph
 * called "all".
 */
export type GraphRef =
  | { kind: 'default' }
  | { kind: 'named' }
  | { kind: 'all' }
  | { kind: 'iri'; value: string };

/**
 * A graph-management operation.
 *
 * These do not decompose into CONSTRUCTs the way the data-changing forms do:
 * `CLEAR GRAPH <g>` names no triples, it names a graph. So the plan keeps the
 * operands rather than a template, and `graphOps.ts` turns them into either a
 * count or — when the caller opts in — the quads they would move.
 */
export interface GraphOperationPlan {
  kind: 'graph';
  form: 'clear' | 'drop' | 'create' | 'load' | 'copy' | 'move' | 'add';
  /** `SILENT`: the operation succeeds even where its operand does not exist. */
  silent: boolean;
  /** What is cleared, dropped or created; for COPY/MOVE/ADD, the target. */
  destination: GraphRef;
  /** COPY/MOVE/ADD only: where the quads come from. */
  sourceGraph?: GraphRef;
  /** LOAD only: the document to read, which is not part of the dataset. */
  documentIri?: string;
  /** True when the operation's effect can be known without reading anything. */
  ground: boolean;
  /** The operation as SPARQL, for replay during simulation. */
  text: string;
}

export type OperationPlan = QuadOperationPlan | GraphOperationPlan;

export interface UpdatePlan {
  operations: OperationPlan[];
}

/** Build the extraction plan for one SPARQL update string. */
export function planUpdate(updateString: string): UpdatePlan {
  const ast = parser.parse(updateString) as unknown as UpdateAst;
  if (ast?.type !== 'update') {
    throw new UnsupportedUpdateError('Not a SPARQL update: parsed as a query.');
  }
  return { operations: planOperations(ast.updates) };
}

/**
 * Plan each operation under the prologue *in scope* at that point, not the one
 * written immediately before it.
 *
 * `Update ::= Prologue ( Update1 ( ';' Update )? )?` is recursive, so a `PREFIX`
 * declared once at the top of a program stays in scope for every operation
 * after it — the AST just hangs it off the unit it was written on, leaving
 * later units with an empty context. Planning each unit from its own context
 * alone dropped the prologue from operation two onward, so both the derivation
 * queries and the text simulation replays came out with prefixed names and no
 * declarations, and the store rejected them as an undefined prefix.
 */
function planOperations(updates: UpdateUnit[]): OperationPlan[] {
  let inScope: ContextDef[] = [];
  return updates.map((update) => {
    inScope = extendContext(inScope, update.context ?? []);
    return planOperation(update, inScope);
  });
}

/**
 * The prologue after a further set of declarations, with later ones winning.
 *
 * Re-declaring a prefix is legal and replaces the earlier binding, so this is a
 * keyed merge rather than a concatenation — otherwise `renderPrologue` would
 * emit the same prefix twice and `expandIri`, which takes the first match,
 * would resolve it to the binding that had been superseded.
 */
function extendContext(inScope: ContextDef[], declared: ContextDef[]): ContextDef[] {
  if (declared.length === 0) return inScope;
  const keyOf = (def: ContextDef) => (def.subType === 'base' ? 'base' : `prefix:${def.key}`);
  const merged = new Map(inScope.map((def) => [keyOf(def), def]));
  for (const def of declared) merged.set(keyOf(def), def);
  return [...merged.values()];
}

function planOperation(update: UpdateUnit, context: ContextDef[]): OperationPlan {
  const operation = update.operation;
  const prologue = renderPrologue(context);
  // Every plan carries its own SPARQL text: simulating a multi-operation
  // program means replaying operation N on a copy before deriving N+1, and the
  // operation as written is the only faithful thing to replay. It is serialized
  // under the prologue in scope rather than the unit's own, so an operation
  // that inherited its prefixes replays with them.
  const text = serialize('queryOrUpdate', { type: 'update', updates: [{ ...update, context }] });

  switch (operation.subType) {
    case 'insertdata':
      return {
        kind: 'quads',
        form: 'insertdata',
        prologue,
        deleteParts: [],
        insertParts: splitTemplate(operation.data, context),
        whereText: '{}',
        datasetText: '',
        ground: true,
        text,
      };

    case 'deletedata':
      return {
        kind: 'quads',
        form: 'deletedata',
        prologue,
        deleteParts: splitTemplate(operation.data, context),
        insertParts: [],
        whereText: '{}',
        datasetText: '',
        ground: true,
        text,
      };

    case 'deletewhere': {
      // `DELETE WHERE { P }` is `DELETE { P } WHERE { P }`, and P is a quads
      // pattern, so one split serves as both template and body.
      const parts = splitTemplate(operation.data, context);
      return {
        kind: 'quads',
        form: 'deletewhere',
        prologue,
        deleteParts: parts,
        insertParts: [],
        whereText: partsToPattern(parts),
        datasetText: '',
        ground: false,
        text,
      };
    }

    case 'modify': {
      const withGraph = operation.graph ? expandIri(operation.graph, context) : undefined;
      const datasetText = operation.from?.clauses?.length ? serialize('datasetClauses', operation.from) : '';
      const body = serialize('generatePattern', operation.where);
      // USING defines the dataset outright when present; only then does WITH
      // stop applying to the WHERE clause (SPARQL 1.1 Update §3.1.3).
      const whereText = withGraph && !datasetText ? `{ GRAPH <${withGraph}> ${body} }` : body;
      const fallback: GraphTarget = withGraph ? { kind: 'iri', value: withGraph } : { kind: 'default' };
      return {
        kind: 'quads',
        form: 'modify',
        prologue,
        deleteParts: splitTemplate(operation.delete ?? [], context, fallback),
        insertParts: splitTemplate(operation.insert ?? [], context, fallback),
        whereText,
        datasetText,
        ground: false,
        text,
      };
    }

    case 'clear':
    case 'drop':
    case 'create':
      return {
        kind: 'graph',
        form: operation.subType,
        silent: operation.silent === true,
        destination: graphRef(operation.destination, context),
        // CREATE moves no triples, so nothing has to be read to know its
        // effect; CLEAR and DROP move whatever the graph happens to hold.
        ground: operation.subType === 'create',
        text,
      };

    case 'copy':
    case 'move':
    case 'add':
      return {
        kind: 'graph',
        form: operation.subType,
        silent: operation.silent === true,
        destination: graphRef(operation.destination, context),
        sourceGraph: graphRef(operation.source as AstGraphRef | undefined, context),
        ground: false,
        text,
      };

    case 'load':
      return {
        kind: 'graph',
        form: 'load',
        silent: operation.silent === true,
        destination: operation.destination
          ? graphRef(operation.destination, context)
          : { kind: 'default' },
        // The document is not in the dataset, so no query against the store can
        // say what it holds. That is why LOAD is the one form enumeration
        // cannot rescue.
        documentIri: expandIri(operation.source as AstTerm | undefined, context),
        ground: false,
        text,
      };

    default:
      throw new UnsupportedUpdateError(`Unrecognised update operation: ${String(operation.subType)}`);
  }
}

/**
 * Split a quads template into graph-homogeneous parts.
 *
 * `fallback` is where triples written outside any `GRAPH` block go — the default
 * graph, or the `WITH` graph when the operation has one.
 */
function splitTemplate(
  quads: QuadsEntry[] | undefined,
  context: ContextDef[],
  fallback: GraphTarget = { kind: 'default' },
): TemplatePart[] {
  const parts: TemplatePart[] = [];
  for (const entry of quads ?? []) {
    if (entry.type === 'graph') {
      parts.push({ graph: graphTarget(entry.graph, context), text: serialize('triplesBlock', entry.triples) });
    } else {
      parts.push({ graph: fallback, text: serialize('triplesBlock', entry) });
    }
  }
  return parts.filter((part) => part.text.length > 0);
}

/** Re-render split parts as a group graph pattern (for `DELETE WHERE`). */
function partsToPattern(parts: TemplatePart[]): string {
  const inner = parts
    .map((part) => {
      switch (part.graph.kind) {
        case 'default':
          return part.text;
        case 'iri':
          return `GRAPH <${part.graph.value}> { ${part.text} }`;
        case 'variable':
          return `GRAPH ?${part.graph.value} { ${part.text} }`;
      }
    })
    .join('\n');
  return `{\n${inner}\n}`;
}

/** The operand of a graph-management operation, with prefixed names expanded. */
function graphRef(ref: AstGraphRef | undefined, context: ContextDef[]): GraphRef {
  switch (ref?.subType) {
    case 'default':
      return { kind: 'default' };
    case 'named':
      return { kind: 'named' };
    case 'all':
      return { kind: 'all' };
    case 'specific':
      return { kind: 'iri', value: expandIri(ref.graph, context) };
    default:
      throw new UnsupportedUpdateError(
        `Unrecognised graph reference in a graph-management operation: ${String(ref?.subType)}`,
      );
  }
}

function graphTarget(term: AstTerm | undefined, context: ContextDef[]): GraphTarget {
  if (term?.subType === 'variable') return { kind: 'variable', value: term.value };
  return { kind: 'iri', value: expandIri(term, context) };
}

/**
 * Absolute IRI for a term in graph position.
 *
 * Only graph position needs this: everything else is handed to the engine as
 * SPARQL text under the operation's own prologue, and the engine expands it.
 * Graph IRIs are the exception because they end up stamped on quads.
 */
function expandIri(term: AstTerm | undefined, context: ContextDef[]): string {
  if (term?.type !== 'term' || term.subType !== 'namedNode') {
    throw new UnsupportedUpdateError(`Expected an IRI in graph position, got ${String(term?.subType)}`);
  }
  if (typeof term.prefix === 'string') {
    const prefix = context.find((def) => def.subType === 'prefix' && def.key === term.prefix);
    if (!prefix) throw new UnsupportedUpdateError(`Undefined prefix '${term.prefix}:' in graph position`);
    return `${prefix.value.value}${term.value}`;
  }
  const base = context.find((def) => def.subType === 'base');
  if (base && !/^[a-z][a-z0-9+.-]*:/i.test(term.value)) {
    return new URL(term.value, base.value.value).href;
  }
  return term.value;
}

function renderPrologue(context: ContextDef[]): string {
  return context
    .map((def) =>
      def.subType === 'base' ? `BASE <${def.value.value}>` : `PREFIX ${def.key}: <${def.value.value}>`,
    )
    .join('\n');
}
