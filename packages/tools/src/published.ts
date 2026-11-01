/**
 * Published tools: a library's stored queries, groups and rule sets, offered as
 * tools by name, with one plain argument per parameter.
 *
 * The catalogue in `tools.ts` is for building a library; these are the
 * application that library makes (`docs/guides/publishing-tools.md`). Both
 * kinds are a `ToolDefinition`, so both doors run them through the same
 * registry. A published query or group's request is `POST /execute` with the
 * pinned version as its target, as `execute.run` would send it; a published
 * rule set's is `POST /rule-sets/{id}/execute` with the pinned version number.
 *
 * Nothing here reads the store. The API collects a `PublishedToolSpec` per
 * tool when it starts; this module turns one into a JSON Schema, a request and
 * an OpenAPI operation. The rule that turns plain values into `VALUES` rows is
 * stated once, here, so MCP and HTTP cannot differ on it.
 */
import type { ToolDefinition, ToolRequest } from './tools.js';

/** The kinds a parameter may declare, in the order the documentation lists them. */
export const TOOL_PARAM_KINDS = [
  'iri',
  'string',
  'langString',
  'integer',
  'decimal',
  'boolean',
  'date',
  'dateTime',
  'term',
] as const;

export type ToolParamKind = (typeof TOOL_PARAM_KINDS)[number];

export type ToolParamSpec = {
  kind: ToolParamKind;
  required?: boolean;
  list?: boolean;
  description?: string;
};

/** What a published tool runs. */
export type ToolTargetKind = 'query' | 'group' | 'ruleSet';

/** The `tool` object a query, query group or rule set version carries. */
export type ToolObject = {
  name: string;
  description: string;
  params?: Record<string, ToolParamSpec>;
  /**
   * Published updates only: one message per precondition flag. A key `K`
   * names the flag the update binds as `?ok_K`; a call whose flag is not true
   * is refused with that message, `{param}` filled from the call's arguments.
   */
  refusals?: Record<string, string>;
  /**
   * Published rule sets only: the data graph the rules run on when a call
   * sends no `data` of its own. Its current version is pinned at startup.
   */
  dataGraphId?: string;
};

/**
 * What a published rule set takes: RDF to run the rules on, in place of its
 * pinned data graph, and that RDF's format.
 */
export const RULE_SET_DATA_ARGUMENT = 'data';
export const RULE_SET_FORMAT_ARGUMENT = 'format';

/** The formats a published rule set's `data` may be in. The first is the default. */
export const RULE_SET_DATA_FORMATS = ['text/turtle', 'application/n-triples', 'application/n-quads'] as const;

/** What a published rule set answers with: its inferred triples as Turtle. */
export const RULE_SET_INFERENCE_FORMAT = 'text/turtle';

/** A refusal key: what follows `?ok_` in a SPARQL variable name. */
export const REFUSAL_KEY_PATTERN = '^[A-Za-z0-9_]{1,64}$';

/** The body of a call a published update refused: `409`. */
export type RefusedBody = {
  error: string;
  refused: Array<{ flag: string; message: string }>;
};

/** A tool name: what MCP clients accept, with no `.` (the separator `/mcp` used to need). */
export const TOOL_NAME_PATTERN = '^[A-Za-z0-9_-]{1,64}$';

/** A library slug, as the `Library.slug` property declares it. */
export const LIBRARY_SLUG_PATTERN = '^[a-z0-9-]+$';

/**
 * The argument every published query takes beside its parameters, and so a
 * name no parameter may use.
 */
export const BACKEND_ARGUMENT = 'backendId';

/**
 * How `/mcp` names a published tool, which lists every library's tools at once.
 *
 * `__` because MCP clients (ChatGPT among them) accept only
 * `^[a-zA-Z0-9_-]+$`, so the `.` the design first proposed would be sanitised
 * to `_` and `queries` + `list` would become the built-in `queries_list`. A
 * slug has no `_` and no built-in name has `__`, so this collides with nothing.
 */
export function prefixedToolName(slug: string, name: string): string {
  return `${slug}__${name}`;
}

/** What a version declares, as input detection finds it: the parameters a `tool` object may name. */
export type DetectedInputs = {
  /** One entry per table parameter (`VALUES ... { UNDEF }`), its variables in order. */
  tables: string[][];
  limits: string[];
  offsets: string[];
};

/**
 * Everything a published tool needs at call time, collected when the server
 * starts. The version is pinned: a new version takes effect at the next start.
 */
export type PublishedToolSpec = {
  slug: string;
  libraryId: string;
  name: string;
  description: string;
  /** The pinned query version, query group version or rule set version. */
  targetId: string;
  targetKind: ToolTargetKind;
  /** SELECT, ASK, CONSTRUCT or DESCRIBE, or a group of only those. A rule set always. */
  readOnly: boolean;
  params: Record<string, ToolParamSpec>;
  inputs: DetectedInputs;
  /** The query's default backend, else its library's. Queries only. */
  defaultBackendId?: string;
  /** The `tool` object's refusal messages, by flag. Published updates only. */
  refusals?: Record<string, string>;
  /** Rule sets only: the rule set and the number of its pinned version. */
  ruleSet?: {
    id: string;
    version: number;
    /** The pinned data graph's version at startup, used when a call sends no `data`. */
    dataGraphVersionId?: string;
  };
};

/** A call the published tool refuses before anything runs. Answers 400. */
export class PublishedToolArgumentError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PublishedToolArgumentError';
  }
}

const XSD = 'http://www.w3.org/2001/XMLSchema#';

const KIND_DATATYPE: Partial<Record<ToolParamKind, string>> = {
  integer: `${XSD}integer`,
  decimal: `${XSD}decimal`,
  boolean: `${XSD}boolean`,
  date: `${XSD}date`,
  dateTime: `${XSD}dateTime`,
};

const ABSOLUTE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]*$/;

// ---------------------------------------------------------------- checks --

/**
 * Check a `tool` object against the inputs its version declares.
 *
 * Returns the first problem as a message that names the offending key, or
 * null. Run when a version is saved, so a published tool never meets an input
 * its text no longer has; run again at startup for a default tool, which was
 * never saved.
 */
export function checkToolObject(
  tool: ToolObject,
  inputs: DetectedInputs,
  options: { targetKind: ToolTargetKind },
): string | null {
  if (!new RegExp(TOOL_NAME_PATTERN).test(tool.name)) {
    return `tool.name "${tool.name}" must match ${TOOL_NAME_PATTERN}: letters, digits, "_" and "-", at most 64`;
  }
  if (tool.dataGraphId !== undefined) {
    if (options.targetKind !== 'ruleSet') {
      return 'tool.dataGraphId: only a published rule set runs on a data graph';
    }
    if (typeof tool.dataGraphId !== 'string' || !tool.dataGraphId.trim()) {
      return 'tool.dataGraphId must be the id of a data graph';
    }
  }
  if (options.targetKind === 'ruleSet') {
    if (tool.params && Object.keys(tool.params).length) {
      return `tool.params: a published rule set takes no parameters, only "${RULE_SET_DATA_ARGUMENT}" and "${RULE_SET_FORMAT_ARGUMENT}"`;
    }
    if (tool.refusals !== undefined) {
      return 'tool.refusals: only a published query can have refusals, not a rule set';
    }
    return null;
  }
  const variables = new Set(inputs.tables.flat());
  const pages = new Set([...inputs.limits, ...inputs.offsets]);
  for (const [key, spec] of Object.entries(tool.params ?? {})) {
    if (options.targetKind === 'query' && key === BACKEND_ARGUMENT) {
      return `tool.params.${key}: "${BACKEND_ARGUMENT}" is reserved for the backend a published query runs on`;
    }
    if (!variables.has(key) && !pages.has(key)) {
      return `tool.params.${key} names no input of this version. Its inputs are: ${describeInputs(inputs)}`;
    }
    if (!variables.has(key) && spec.kind !== 'integer') {
      return `tool.params.${key} is a LIMIT or OFFSET parameter, so its kind must be "integer"`;
    }
    if (!variables.has(key) && spec.list) {
      return `tool.params.${key} is a LIMIT or OFFSET parameter, so it cannot be a list`;
    }
  }
  if (tool.refusals !== undefined) {
    if (options.targetKind === 'group') {
      return 'tool.refusals: only a published query can have refusals, not a query group';
    }
    if (tool.refusals === null || typeof tool.refusals !== 'object' || Array.isArray(tool.refusals)) {
      return 'tool.refusals must be an object of messages, keyed by flag';
    }
    for (const [key, message] of Object.entries(tool.refusals)) {
      if (!new RegExp(REFUSAL_KEY_PATTERN).test(key)) {
        return `tool.refusals.${key}: a key is the part of a flag after "?ok_", so it must match ${REFUSAL_KEY_PATTERN}`;
      }
      if (typeof message !== 'string' || !message.trim()) {
        return `tool.refusals.${key} must be a message`;
      }
    }
  }
  return null;
}

function describeInputs(inputs: DetectedInputs): string {
  const names = [
    ...inputs.tables.flat().map(name => `?${name}`),
    ...inputs.limits.map(name => `LIMIT ${name}`),
    ...inputs.offsets.map(name => `OFFSET ${name}`),
  ];
  return names.length ? names.join(', ') : 'none';
}

/**
 * The tool a `publishAll` library gives an entry that declares none: the
 * entry's name made safe, its description, and every input as an optional
 * `term` (LIMIT and OFFSET as `integer`).
 */
export function defaultToolObject(
  entity: { name?: string | null; description?: string | null },
  inputs: DetectedInputs,
): ToolObject {
  const name = safeToolName(entity.name ?? '');
  const params: Record<string, ToolParamSpec> = {};
  for (const variable of inputs.tables.flat()) params[variable] = { kind: 'term' };
  for (const page of [...inputs.limits, ...inputs.offsets]) params[page] = { kind: 'integer' };
  return {
    name,
    description: entity.description?.trim() || entity.name?.trim() || name,
    params,
  };
}

/** A display name as a tool name: runs of other characters become `-`. */
export function safeToolName(name: string): string {
  const safe = name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return safe || 'tool';
}

// ---------------------------------------------------------------- schema --

function kindSchema(kind: ToolParamKind): Record<string, unknown> {
  const langString = {
    type: 'object',
    properties: { value: { type: 'string' }, lang: { type: 'string', minLength: 1 } },
    required: ['value', 'lang'],
    additionalProperties: false,
  };
  switch (kind) {
    case 'iri':
      return { type: 'string', format: 'iri' };
    case 'string':
      return { type: 'string' };
    case 'langString':
      return langString;
    case 'integer':
      return { type: 'integer' };
    case 'decimal':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'string', format: 'date' };
    case 'dateTime':
      return { type: 'string', format: 'date-time' };
    case 'term':
      return {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: { iri: { type: 'string', format: 'iri' } },
            required: ['iri'],
            additionalProperties: false,
          },
          langString,
          {
            type: 'object',
            properties: { value: { type: 'string' }, datatype: { type: 'string', format: 'iri' } },
            required: ['value', 'datatype'],
            additionalProperties: false,
          },
        ],
      };
  }
}

function paramSchema(spec: ToolParamSpec): Record<string, unknown> {
  const item = kindSchema(spec.kind);
  const schema = spec.list ? { type: 'array', items: item } : { ...item };
  return spec.description ? { ...schema, description: spec.description } : schema;
}

/**
 * The tool's arguments as a JSON Schema: one property per parameter, plus
 * `backendId` for a query. A rule set's are `data` and `format`. Unknown
 * arguments are refused.
 */
export function publishedInputSchema(spec: PublishedToolSpec): Record<string, unknown> & { type: 'object' } {
  if (spec.targetKind === 'ruleSet') return ruleSetInputSchema(spec);
  const properties: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(spec.params)) properties[key] = paramSchema(param);
  if (spec.targetKind === 'query') {
    properties[BACKEND_ARGUMENT] = {
      type: 'string',
      format: 'iri',
      description: spec.defaultBackendId
        ? `The backend to run on. Defaults to ${spec.defaultBackendId}.`
        : 'The backend to run on. Required: neither the query nor its library has a default backend.',
    };
  }
  const required = Object.entries(spec.params)
    .filter(([, param]) => param.required)
    .map(([key]) => key);
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function ruleSetInputSchema(spec: PublishedToolSpec): Record<string, unknown> & { type: 'object' } {
  const pinned = Boolean(spec.ruleSet?.dataGraphVersionId);
  return {
    type: 'object',
    properties: {
      [RULE_SET_DATA_ARGUMENT]: {
        type: 'string',
        description: pinned
          ? 'RDF to run the rules on, in place of the data graph this tool runs on by default.'
          : 'RDF to run the rules on. Without it the rules run on their own data blocks only.',
      },
      [RULE_SET_FORMAT_ARGUMENT]: {
        type: 'string',
        enum: [...RULE_SET_DATA_FORMATS],
        description: `The format of "${RULE_SET_DATA_ARGUMENT}". Defaults to ${RULE_SET_DATA_FORMATS[0]}.`,
      },
    },
    additionalProperties: false,
  };
}

// ------------------------------------------------------------- arguments --

type SparqlTerm = { type: 'uri' | 'literal'; value: string; datatype?: string; 'xml:lang'?: string };

function requireIri(param: string, value: unknown): string {
  if (typeof value !== 'string' || !ABSOLUTE_IRI.test(value)) {
    throw new PublishedToolArgumentError(`${param}: ${JSON.stringify(value)} is not an absolute IRI`);
  }
  return value;
}

function wrongKind(param: string, kind: ToolParamKind, value: unknown): never {
  throw new PublishedToolArgumentError(`${param}: ${JSON.stringify(value)} is not a valid ${kind}`);
}

/** One plain value as a SPARQL Results JSON term, by the parameter's kind. */
export function toSparqlTerm(param: string, kind: ToolParamKind, value: unknown): SparqlTerm {
  switch (kind) {
    case 'iri':
      return { type: 'uri', value: requireIri(param, value) };
    case 'string':
      if (typeof value !== 'string') wrongKind(param, kind, value);
      return { type: 'literal', value };
    case 'langString': {
      const lang = value as { value?: unknown; lang?: unknown } | null;
      if (!lang || typeof lang.value !== 'string' || typeof lang.lang !== 'string' || !lang.lang) {
        wrongKind(param, kind, value);
      }
      return { type: 'literal', value: lang.value as string, 'xml:lang': lang.lang as string };
    }
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) wrongKind(param, kind, value);
      return { type: 'literal', value: String(value), datatype: KIND_DATATYPE.integer };
    case 'decimal':
      if (typeof value !== 'number' || !Number.isFinite(value)) wrongKind(param, kind, value);
      return { type: 'literal', value: String(value), datatype: KIND_DATATYPE.decimal };
    case 'boolean':
      if (typeof value !== 'boolean') wrongKind(param, kind, value);
      return { type: 'literal', value: String(value), datatype: KIND_DATATYPE.boolean };
    case 'date':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) wrongKind(param, kind, value);
      return { type: 'literal', value, datatype: KIND_DATATYPE.date };
    case 'dateTime':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) wrongKind(param, kind, value);
      return { type: 'literal', value, datatype: KIND_DATATYPE.dateTime };
    case 'term': {
      if (typeof value === 'string') return { type: 'literal', value };
      const term = value as { iri?: unknown; value?: unknown; lang?: unknown; datatype?: unknown } | null;
      if (term && typeof term === 'object') {
        if (term.iri !== undefined) return { type: 'uri', value: requireIri(param, term.iri) };
        if (typeof term.value === 'string' && typeof term.lang === 'string' && term.lang) {
          return { type: 'literal', value: term.value, 'xml:lang': term.lang };
        }
        if (typeof term.value === 'string' && term.datatype !== undefined) {
          return { type: 'literal', value: term.value, datatype: requireIri(param, term.datatype) };
        }
      }
      return wrongKind(param, kind, value);
    }
  }
}

export type PublishedExecuteBody = {
  targetId: string;
  backendId?: string;
  arguments?: Array<{ head: { vars: string[] }; results: { bindings: Array<Record<string, SparqlTerm>> } }>;
  limits?: Array<{ name: string; value: number }>;
  offsets?: Array<{ name: string; value: number }>;
};

/**
 * The `POST /execute` body for a call with these plain values.
 *
 * Per table: a single value is repeated in every row, a list spreads over
 * rows (item *i* in row *i*, `UNDEF` past its end), and the table has as many
 * rows as its longest list, at least one. Two lists in one table are zipped,
 * not crossed. A value left out is `UNDEF`; a table given nothing at all is
 * left out, which runs it unconstrained, the same as one all-`UNDEF` row.
 */
export function buildPublishedExecuteBody(
  spec: PublishedToolSpec,
  values: Record<string, unknown>,
): PublishedExecuteBody {
  for (const key of Object.keys(values)) {
    if (key in spec.params) continue;
    if (key === BACKEND_ARGUMENT && spec.targetKind === 'query') continue;
    throw new PublishedToolArgumentError(`${key}: this tool takes no such argument`);
  }
  for (const [key, param] of Object.entries(spec.params)) {
    if (param.required && (values[key] === undefined || values[key] === null)) {
      throw new PublishedToolArgumentError(`${key}: is required`);
    }
  }

  const body: PublishedExecuteBody = { targetId: spec.targetId };

  if (spec.targetKind === 'query') {
    const backendId = values[BACKEND_ARGUMENT] ?? spec.defaultBackendId;
    if (typeof backendId !== 'string' || !backendId) {
      throw new PublishedToolArgumentError(
        'backendId is required: neither the query nor its library has a default backend',
      );
    }
    body.backendId = backendId;
  }

  const tables: NonNullable<PublishedExecuteBody['arguments']> = [];
  for (const table of spec.inputs.tables) {
    const columns: Array<{ variable: string; terms: SparqlTerm[]; list: boolean }> = [];
    for (const variable of table) {
      const param = spec.params[variable];
      const value = values[variable];
      if (!param || value === undefined || value === null) continue;
      if (param.list) {
        if (!Array.isArray(value)) wrongKind(variable, param.kind, value);
        columns.push({ variable, terms: value.map(item => toSparqlTerm(variable, param.kind, item)), list: true });
      } else {
        columns.push({ variable, terms: [toSparqlTerm(variable, param.kind, value)], list: false });
      }
    }
    if (columns.length === 0) continue;
    const rowCount = Math.max(1, ...columns.filter(c => c.list).map(c => c.terms.length));
    const bindings: Array<Record<string, SparqlTerm>> = [];
    for (let row = 0; row < rowCount; row += 1) {
      const binding: Record<string, SparqlTerm> = {};
      for (const column of columns) {
        const term = column.list ? column.terms[row] : column.terms[0];
        if (term) binding[column.variable] = term;
      }
      bindings.push(binding);
    }
    tables.push({ head: { vars: [...table] }, results: { bindings } });
  }
  if (tables.length) body.arguments = tables;

  const pages = (names: string[]) =>
    names
      .filter(name => spec.params[name] && values[name] !== undefined && values[name] !== null)
      .map(name => {
        const value = values[name];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          throw new PublishedToolArgumentError(`${name}: ${JSON.stringify(value)} is not a non-negative integer`);
        }
        return { name, value };
      });
  const limits = pages(spec.inputs.limits);
  const offsets = pages(spec.inputs.offsets);
  if (limits.length) body.limits = limits;
  if (offsets.length) body.offsets = offsets;

  return body;
}

export type PublishedRuleSetBody = {
  version: number;
  inferenceFormat: string;
  dataGraphVersionId?: string;
  dataGraphInline?: string;
  dataGraphInlineFormat?: string;
};

/**
 * The `POST /rule-sets/{id}/execute` body for a call to a published rule set:
 * the pinned version, and the caller's `data` if it sent any, else the pinned
 * data graph, else neither, so the rules run on their own data blocks.
 */
export function buildPublishedRuleSetBody(
  spec: PublishedToolSpec,
  values: Record<string, unknown>,
): PublishedRuleSetBody {
  const ruleSet = spec.ruleSet;
  if (spec.targetKind !== 'ruleSet' || !ruleSet) {
    throw new Error(`${spec.name} is not a published rule set`);
  }
  for (const key of Object.keys(values)) {
    if (key === RULE_SET_DATA_ARGUMENT || key === RULE_SET_FORMAT_ARGUMENT) continue;
    throw new PublishedToolArgumentError(`${key}: this tool takes no such argument`);
  }
  const data = values[RULE_SET_DATA_ARGUMENT];
  const format = values[RULE_SET_FORMAT_ARGUMENT];
  if (data !== undefined && data !== null && typeof data !== 'string') {
    throw new PublishedToolArgumentError(`${RULE_SET_DATA_ARGUMENT}: must be RDF text`);
  }
  if (format !== undefined && format !== null
    && !(RULE_SET_DATA_FORMATS as readonly unknown[]).includes(format)) {
    throw new PublishedToolArgumentError(
      `${RULE_SET_FORMAT_ARGUMENT}: ${JSON.stringify(format)} is not one of ${RULE_SET_DATA_FORMATS.join(', ')}`,
    );
  }
  if (typeof format === 'string' && typeof data !== 'string') {
    throw new PublishedToolArgumentError(`${RULE_SET_FORMAT_ARGUMENT}: needs "${RULE_SET_DATA_ARGUMENT}"`);
  }

  const body: PublishedRuleSetBody = { version: ruleSet.version, inferenceFormat: RULE_SET_INFERENCE_FORMAT };
  if (typeof data === 'string') {
    body.dataGraphInline = data;
    body.dataGraphInlineFormat = typeof format === 'string' ? format : RULE_SET_DATA_FORMATS[0];
  } else if (ruleSet.dataGraphVersionId) {
    body.dataGraphVersionId = ruleSet.dataGraphVersionId;
  }
  return body;
}

/** The path a published rule set's call posts to, below any base path. */
export function publishedRuleSetExecutePath(ruleSetId: string): string {
  return `/rule-sets/${encodeURIComponent(ruleSetId)}/execute`;
}

/** The API request a published tool's call makes. */
export function buildPublishedRequest(spec: PublishedToolSpec, values: Record<string, unknown>): ToolRequest {
  if (spec.targetKind === 'ruleSet') {
    return {
      method: 'POST',
      url: publishedRuleSetExecutePath(spec.ruleSet!.id),
      headers: { 'content-type': 'application/json' },
      payload: buildPublishedRuleSetBody(spec, values),
    };
  }
  return {
    method: 'POST',
    url: '/execute',
    headers: { 'content-type': 'application/json' },
    payload: buildPublishedExecuteBody(spec, values),
  };
}

/**
 * A published tool as a catalogue entry, so the registry both doors use can
 * list it, validate its arguments and run it.
 */
export function publishedToolDefinition(spec: PublishedToolSpec, name: string = spec.name): ToolDefinition {
  return {
    name,
    description: spec.description,
    readOnly: spec.readOnly,
    annotations: { readOnlyHint: spec.readOnly },
    inputSchema: publishedInputSchema(spec),
    buildRequest: (input) => buildPublishedRequest(spec, input),
  };
}

// ------------------------------------------------------------------ HTTP --

/**
 * `GET` for a query or group that only reads, `POST` for one that writes. A
 * rule set is `POST`: it only reads, but its `data` can be far longer than a
 * URL.
 */
export function publishedHttpMethod(spec: PublishedToolSpec): 'GET' | 'POST' {
  return spec.readOnly && spec.targetKind !== 'ruleSet' ? 'GET' : 'POST';
}

/**
 * A `GET` call's query string as the tool's plain values.
 *
 * A list is the key repeated. A `langString` or `term` written as an object is
 * its JSON spelling; a `term` that does not start with `{` is a plain literal.
 * Numbers and booleans are parsed by kind, so ajv sees the types the tool
 * declares.
 */
export function valuesFromQueryString(
  spec: PublishedToolSpec,
  query: Record<string, string | string[] | undefined>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined) continue;
    const all = Array.isArray(raw) ? raw : [raw];
    const param = spec.params[key];
    if (!param) {
      values[key] = all[all.length - 1];
      continue;
    }
    const parsed = all.map(item => parseQueryValue(key, param.kind, item));
    values[key] = param.list ? parsed : parsed[parsed.length - 1];
  }
  return values;
}

function parseQueryValue(param: string, kind: ToolParamKind, raw: string): unknown {
  switch (kind) {
    case 'integer':
    case 'decimal': {
      const number = Number(raw);
      return raw.trim() !== '' && Number.isFinite(number) ? number : raw;
    }
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : raw;
    case 'langString':
    case 'term':
      if (raw.trimStart().startsWith('{')) {
        try {
          return JSON.parse(raw);
        } catch {
          throw new PublishedToolArgumentError(`${param}: ${JSON.stringify(raw)} is not valid JSON`);
        }
      }
      return raw;
    default:
      return raw;
  }
}

/** The path of a tool's route, below any base path. */
export function publishedToolPath(slug: string, name: string): string {
  return `/tools/${slug}/${name}`;
}

/**
 * The OpenAPI 3.1 document for one library's published tools: one operation
 * per tool, typed from its parameters, so a page's client can be generated
 * from it and a generic client can read it at run time.
 */
export function publishedOpenApiDocument(options: {
  slug: string;
  title: string;
  description?: string | null;
  specs: PublishedToolSpec[];
  basePath?: string;
}): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const spec of options.specs) {
    const schema = publishedInputSchema(spec);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const required = new Set((schema.required as string[] | undefined) ?? []);
    const responses = {
      200: {
        description: spec.targetKind === 'ruleSet'
          ? 'What `POST /rule-sets/{id}/execute` returns for the pinned version, the inferred triples as Turtle.'
          : 'What `POST /execute` returns for the pinned version.',
      },
      400: { description: 'An argument is missing, unknown or of the wrong kind.' },
      ...(spec.refusals
        ? {
            409: {
              description: 'The update wrote nothing: a precondition failed. `refused` names each failed flag with its message.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['error', 'refused'],
                    properties: {
                      error: { type: 'string' },
                      refused: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['flag', 'message'],
                          properties: { flag: { enum: Object.keys(spec.refusals) }, message: { type: 'string' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          }
        : {}),
    };
    const operation: Record<string, unknown> = {
      operationId: spec.name,
      summary: spec.name,
      description: spec.description,
      responses,
    };
    if (publishedHttpMethod(spec) === 'GET') {
      operation.parameters = Object.entries(properties).map(([name, property]) => {
        const objectValued = JSON.stringify(property).includes('"type":"object"');
        return {
          name,
          in: 'query',
          required: required.has(name),
          ...(property.description ? { description: property.description } : {}),
          ...(objectValued
            ? { content: { 'application/json': { schema: property } } }
            : { schema: property, ...(property.type === 'array' ? { explode: true } : {}) }),
        };
      });
      paths[publishedToolPath(options.slug, spec.name)] = { get: operation };
    } else {
      operation.requestBody = { required: true, content: { 'application/json': { schema } } };
      paths[publishedToolPath(options.slug, spec.name)] = { post: operation };
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: '1',
      ...(options.description ? { description: options.description } : {}),
    },
    ...(options.basePath ? { servers: [{ url: options.basePath }] } : {}),
    paths,
  };
}
