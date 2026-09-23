/**
 * The callable — what an application developer can POST to, and what comes
 * back.
 *
 * Queries and query groups collapse into ONE kind here, deliberately: from the
 * caller's side a group's signature is indistinguishable from a query's, so
 * splitting them into two tables would be splitting on an implementation
 * detail. A type glyph tells them apart and a group carries a `composes N`
 * note.
 *
 * On where the signature comes from. An earlier design assumed the only source
 * was `POST /detect-inputs`, which returns bare variable names with no types
 * and no defaults, and flagged that as the screen's biggest open question. It
 * is not the only source: a *saved version* stores its I/O as entities, and the
 * expanded version response carries them — `QueryInputVariable.allowedTypes`,
 * limit and offset parameters with `defaultValue`, and input tuples whose
 * membership is explicit. So the stacked signature view has real datatypes and
 * real defaults for anything that has been saved, and detection is only needed
 * for a body that has not been saved yet.
 */
import type {
  Query,
  QueryGroup,
  QueryVersionExpanded,
  QueryGroupVersionExpanded,
} from '@sparql-query-lib/contracts';
import {
  QueryTypeIri,
  isGraphQueryType,
  isBooleanQueryType,
  toQueryTypeIri,
} from '@sparql-query-lib/types';

/**
 * SELECT, ASK and CONSTRUCT/DESCRIBE, as the design names them.
 *
 * `UPDATE` is not in the design — the mockup shows a read-side library and
 * write callables are out of scope (§11) — but an update query already stored
 * in a library has to render as something, and rendering it as BINDINGS would
 * be a lie about what a caller gets back.
 */
export type ResultKind = 'BINDINGS' | 'BOOLEAN' | 'GRAPH' | 'UPDATE';

export type CallableType = 'query' | 'group';

/** Live means "my app can call this"; draft means "the assistant wrote this". */
export type CallableState = 'live' | 'draft';

export interface CallableTupleMember {
  variableName: string;
  /** Short form where recognised (`xsd:string`), else the raw IRI. */
  datatype: string | null;
}

/**
 * A VALUES tuple is a *group* of variables, not a flat list: a callable taking
 * `[["?product","?qty"]]` takes one tuple of two members, and Try it renders it
 * as a repeatable row. Flattening it here would lose the only thing that says
 * how many values a caller has to supply together.
 */
export interface CallableInputTuple {
  id: string;
  name: string | null;
  members: CallableTupleMember[];
}

export interface CallableParameter {
  name: string;
  defaultValue: number | null;
}

export interface CallableOutput {
  variableName: string;
  description: string | null;
}

export interface Callable {
  id: string;
  name: string;
  description: string | null;
  type: CallableType;
  state: CallableState;
  /** Version number for a live callable; null for a draft. */
  version: number | null;
  libraryId: string | null;
  resultKind: ResultKind;
  inputTuples: CallableInputTuple[];
  limitParameters: CallableParameter[];
  offsetParameters: CallableParameter[];
  outputs: CallableOutput[];
  /** How many nodes a group composes. Null for a query. */
  composes: number | null;
  /**
   * The query's own text, for a surface that shows what it will run — the
   * notebook's cells. Null for a group, which composes queries rather than
   * holding one, and for a draft whose body lives in the draft record.
   */
  queryString?: string | null;
}

const XSD = 'http://www.w3.org/2001/XMLSchema#';

/**
 * Long xsd IRIs are what is stored; `xsd:integer` is what fits in a table cell.
 * Anything unrecognised is passed through whole rather than guessed at.
 */
export function shortenDatatype(iri: string | null | undefined): string | null {
  if (!iri) return null;
  if (iri.startsWith(XSD)) return `xsd:${iri.slice(XSD.length)}`;
  return iri;
}

export function resultKindForQueryType(queryType: string | null | undefined): ResultKind {
  const iri = toQueryTypeIri(queryType);
  if (!iri) return 'BINDINGS';
  if (isBooleanQueryType(iri)) return 'BOOLEAN';
  if (isGraphQueryType(iri)) return 'GRAPH';
  if (iri === QueryTypeIri.select) return 'BINDINGS';
  return 'UPDATE';
}

/** Assemble the input tuples from the expanded version's flat entity lists. */
function tuplesFrom(
  inputTuples: QueryVersionExpanded['inputTuples'],
  tupleMembers: QueryVersionExpanded['tupleMembers'],
  inputs: QueryVersionExpanded['inputs']
): CallableInputTuple[] {
  const memberById = new Map(tupleMembers.map((member) => [member.id, member]));
  const inputById = new Map(inputs.map((input) => [input.id, input]));

  return inputTuples.map((tuple) => ({
    id: tuple.id,
    name: tuple.name ?? null,
    members: (tuple.memberEntries ?? [])
      .map((memberId) => memberById.get(memberId))
      .filter((member): member is NonNullable<typeof member> => member != null)
      // Position is what orders a tuple; the memberEntries array order is not
      // guaranteed to survive a round trip through the store.
      .sort((a, b) => a.position - b.position)
      .map((member) => {
        const variable = inputById.get(member.variable);
        return {
          variableName: variable?.variableName ?? member.variable,
          datatype: shortenDatatype(variable?.allowedTypes?.[0]),
        };
      }),
  }));
}

export function callableFromQueryVersion(
  query: Query,
  expanded: QueryVersionExpanded
): Callable {
  return {
    id: query.id,
    name: query.name,
    description: query.description ?? null,
    type: 'query',
    state: 'live',
    version: expanded.queryVersion.version,
    libraryId: query.isPartOf[0] ?? null,
    resultKind: resultKindForQueryType(expanded.queryVersion.queryType),
    inputTuples: tuplesFrom(expanded.inputTuples, expanded.tupleMembers, expanded.inputs),
    limitParameters: expanded.limitParameters.map((parameter) => ({
      name: parameter.name,
      defaultValue: parameter.defaultValue ?? null,
    })),
    offsetParameters: expanded.offsetParameters.map((parameter) => ({
      name: parameter.name,
      defaultValue: parameter.defaultValue ?? null,
    })),
    outputs: expanded.outputs.map((output) => ({
      variableName: output.variableName,
      description: output.description ?? null,
    })),
    composes: null,
    queryString: expanded.queryVersion.queryString ?? null,
  };
}

export function callableFromGroupVersion(
  group: QueryGroup,
  expanded: QueryGroupVersionExpanded
): Callable {
  /*
   * A group's result kind comes from what its end node emits, not from any one
   * member query: a group whose last step is a CONSTRUCT returns a graph even
   * though every query before it returned bindings.
   */
  let resultKind: ResultKind = 'BINDINGS';
  if (expanded.rdfOutputs.length > 0) resultKind = 'GRAPH';
  else if (expanded.booleanOutputs.length > 0) resultKind = 'BOOLEAN';

  const composes =
    expanded.queryNodes.length + expanded.dynamicQueryNodes.length + expanded.ruleSetNodes.length;

  return {
    id: group.id,
    name: group.name,
    description: group.description ?? null,
    type: 'group',
    state: 'live',
    version: expanded.queryGroupVersion.version,
    // A group belongs to exactly one library; a query's isPartOf is an array.
    libraryId: group.isPartOf ?? null,
    resultKind,
    inputTuples: tuplesFrom(expanded.inputTuples, expanded.tupleMembers, expanded.inputs),
    limitParameters: [],
    offsetParameters: [],
    outputs: expanded.outputs.map((output) => ({
      variableName: output.variableName,
      description: output.description ?? null,
    })),
    composes,
  };
}

/** Every input variable a caller has to supply, tuple grouping flattened away. */
export function inputVariableNames(callable: Callable): string[] {
  return callable.inputTuples.flatMap((tuple) => tuple.members.map((member) => member.variableName));
}

/**
 * The compact one-line input summary: tuple variables first, then the LIMIT and
 * OFFSET parameter names. Built from the three lists the API actually has,
 * not from invented argument names (§6.1).
 */
export function inputSummary(callable: Callable): string {
  const parts = [
    ...inputVariableNames(callable),
    ...callable.limitParameters.map((parameter) => parameter.name),
    ...callable.offsetParameters.map((parameter) => parameter.name),
  ];
  return parts.length === 0 ? 'none' : parts.join(', ');
}

export function outputSummary(callable: Callable): string {
  if (callable.resultKind === 'BOOLEAN') return 'true / false';
  if (callable.resultKind === 'GRAPH') return '?s ?p ?o';
  if (callable.outputs.length === 0) return 'none';
  return callable.outputs.map((output) => output.variableName).join(', ');
}

/**
 * Signature matching (§7).
 *
 * Two callables compose when the source's output variable names cover every
 * input variable the candidate needs. This is cheap to compute in the client
 * and is the thing that keeps a chat-built library coherent rather than forty
 * unrelated queries.
 *
 * A callable that takes no inputs is excluded: everything would "accept" it,
 * which is true and useless.
 */
export interface SignatureMatch {
  callable: Callable;
  sharedVariables: string[];
}

export function callablesAcceptingOutput(
  source: Callable,
  candidates: Callable[]
): SignatureMatch[] {
  if (source.resultKind !== 'BINDINGS') return [];

  const available = new Set(source.outputs.map((output) => normaliseVariable(output.variableName)));
  const matches: SignatureMatch[] = [];

  for (const candidate of candidates) {
    if (candidate.id === source.id) continue;
    const required = inputVariableNames(candidate).map(normaliseVariable);
    if (required.length === 0) continue;
    if (!required.every((name) => available.has(name))) continue;
    matches.push({
      callable: candidate,
      sharedVariables: required.map((name) => `?${name}`),
    });
  }

  return matches;
}

/**
 * Output variables are stored with a leading `?` in some places and without in
 * others, and a match must not turn on which.
 */
function normaliseVariable(name: string): string {
  return name.startsWith('?') ? name.slice(1) : name;
}

/**
 * Where a row opens.
 *
 * A draft is not addressable as a query: its id is `urn:ui-temp:…`, which
 * resolves nowhere on the server, so routing one to `?query=` opens an empty
 * work area. Two kinds, and they differ by whether anything sits behind them —
 * a draft of an existing query opens that query with the draft laid over it,
 * and a draft with nothing behind it is browser-local, which `?scratch=` says.
 */
export function workAreaRouteFor(
  callable: Pick<Callable, 'id' | 'type' | 'state'>,
  basedOn: string | null
): Record<string, string> {
  if (callable.state === 'draft') {
    return basedOn ? { query: basedOn } : { scratch: callable.id };
  }
  return callable.type === 'group' ? { queryGroup: callable.id } : { query: callable.id };
}
