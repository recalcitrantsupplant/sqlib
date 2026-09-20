/**
 * The tool registry: validate arguments, call the API, hand back the result.
 *
 * This is the shared trunk both doors reach. It was private to `createMcpServer`
 * until the in-app assistant needed it; nothing about it was MCP-specific, only
 * its visibility was wrong.
 *
 * Two dependencies are injected rather than imported, and for the same reason
 * in both cases — this package must not depend on the API package:
 *
 * - `compile` comes from the API's own ajv, because `coerceTypes` and
 *   `useDefaults` change what a handler receives. A second configuration here
 *   would be free to drift from the one production validates with, which is
 *   the drift the whole schema-consolidation track exists to remove.
 * - `callApi` is whatever the caller uses to reach the routes. In practice that
 *   is `app.inject`, in the same process, for both doors.
 */
import { tools as defaultTools, type ToolDefinition, type ToolRequest, type ToolUiBinding } from './tools.js';

export type ToolCallResult = {
  statusCode: number;
  headers: Record<string, unknown>;
  body: unknown;
  /** The body as text, which is what a model is given. */
  text: string;
};

/**
 * `authorization` is the caller's own bearer token, forwarded per request.
 *
 * The registry never inspects or stores it — it is threaded straight through to
 * the API so a tool call runs under the grants of whoever made it rather than
 * an ambient service identity. Doors that have no caller token (the in-app
 * assistant, stdio MCP) simply pass none.
 */
export type ApiCaller = (
  request: ToolRequest,
  authorization?: string
) => Promise<{
  statusCode: number;
  headers: Record<string, unknown>;
  payload: string;
}>;

/**
 * The slice of ajv the registry uses. Structural rather than imported so this
 * package takes no ajv dependency of its own.
 */
export type AjvErrorObject = {
  instancePath?: string;
  message?: string;
  params?: Record<string, unknown>;
};

export type CompiledValidator = ((data: unknown) => boolean) & {
  errors?: AjvErrorObject[] | null;
};

export type ToolValidatorCompiler = {
  compile: (schema: Record<string, unknown>) => CompiledValidator;
};

export type ToolRegistryOptions = {
  /** Unused when `validators` is supplied. */
  compiler: ToolValidatorCompiler;
  callApi: ApiCaller;
  /** Defaults to the full catalogue. An allowlist narrows it. */
  definitions?: ToolDefinition[];
  /**
   * Pre-compiled validators, when the caller builds a registry more than once
   * over the same catalogue. Compiling all 79 schemas measures ~105ms, which an
   * MCP server would otherwise pay per session for an identical result.
   *
   * Sharing them is safe despite ajv storing the last run's errors on the
   * function object: `validate()` and the read of `validate.errors` happen in
   * one synchronous expression in `callTool`, with no await between them.
   */
  validators?: Map<string, CompiledValidator>;
  /** Rename on the way out — MCP sanitises dots, the assistant does not. */
  publicName?: (name: string) => string;
};

export type ListedTool = {
  name: string;
  /** MCP's `Tool.title`: the human-readable name, absent when the description already is one. */
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The View that renders this tool's result, when the catalogue binds one. */
  ui?: ToolUiBinding;
};

/**
 * Render ajv errors the way the zod parse used to: `path: message`, joined.
 *
 * A missing required property reports at the *parent* path with the name in
 * `params.missingProperty`, so the name is lifted out — otherwise every missing
 * argument would report against the empty path and read identically.
 */
export function formatValidationErrors(errors: AjvErrorObject[] | null | undefined): string {
  if (!errors?.length) return 'invalid arguments';
  return errors
    .map((error) => {
      const missing = error.params?.missingProperty;
      const instancePath = (error.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.');
      const path = instancePath || (typeof missing === 'string' ? missing : '');
      const message = error.message ?? 'is invalid';
      return path ? `${path}: ${message}` : message;
    })
    .join('; ');
}

/**
 * A tool call that ajv rejected before it ever reached the API.
 *
 * Distinct from a plain `Error` so a caller (the assistant turn loop) can tell
 * "the model got the shape wrong" apart from a 404 or a network failure —
 * the former is worth a free retry, the latter is not.
 */
export class ToolValidationError extends Error {
  readonly toolName: string;
  readonly errors: AjvErrorObject[] | null | undefined;
  readonly schema: Record<string, unknown>;

  constructor(toolName: string, errors: AjvErrorObject[] | null | undefined, schema: Record<string, unknown>) {
    super(`Invalid arguments for tool ${toolName}: ${formatValidationErrors(errors)}`);
    this.name = 'ToolValidationError';
    this.toolName = toolName;
    this.errors = errors;
    this.schema = schema;
  }
}

/**
 * Narrow a tool's input schema down to the properties an ajv failure actually
 * names, so a repair retry is shown the shape it got wrong rather than the
 * whole schema again. Falls back to the full schema when a failing path
 * cannot be resolved to a top-level property (e.g. a schema with no
 * `properties`, or a nested failure).
 */
export function schemaFragmentForErrors(
  schema: Record<string, unknown>,
  errors: AjvErrorObject[] | null | undefined
): Record<string, unknown> {
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties || !errors?.length) return schema;

  const names = new Set<string>();
  for (const error of errors) {
    const missing = error.params?.missingProperty;
    if (typeof missing === 'string') {
      names.add(missing);
      continue;
    }
    const top = (error.instancePath ?? '').replace(/^\//, '').split('/')[0];
    if (top) names.add(top);
  }

  const picked: Record<string, unknown> = {};
  for (const name of names) {
    if (name in properties) picked[name] = properties[name];
  }
  if (Object.keys(picked).length === 0) return schema;

  const required = Array.isArray(schema.required)
    ? (schema.required as string[]).filter((name) => names.has(name))
    : undefined;

  return {
    type: 'object',
    properties: picked,
    ...(required?.length ? { required } : {}),
  };
}

export function compileToolValidators(
  compiler: ToolValidatorCompiler,
  definitions: ToolDefinition[]
): Map<string, CompiledValidator> {
  const validators = new Map<string, CompiledValidator>();
  for (const def of definitions) {
    validators.set(def.name, compiler.compile(def.inputSchema));
  }
  return validators;
}

export type ToolRegistry = {
  listTools: () => ListedTool[];
  callTool: (
    name: string,
    args: Record<string, unknown>,
    authorization?: string
  ) => Promise<ToolCallResult>;
  /** The catalogue this registry was built over, after any allowlist. */
  definitions: ToolDefinition[];
};

/**
 * Rewrite every mention of a catalogue tool in `text` to its public name.
 *
 * A description that says "save the text with queries.createVersion" is only
 * useful if that is a name the model can call — and through MCP it is
 * `queries_createVersion`. The catalogue is written once, with dots, and each
 * door renders cross-references its own way; this is the rendering. Matching
 * is on whole names only, so `head.vars` and `urn:...` are untouched.
 */
export function rewriteToolNames(
  text: string,
  names: Iterable<string>,
  publicName: (name: string) => string
): string {
  const escaped = Array.from(names, (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return text;
  // Longest first so `queries.listVersions` is not eaten by `queries.list`.
  escaped.sort((a, b) => b.length - a.length);
  // A name may end a sentence, so a following `.` is allowed; a following
  // identifier character is not, which is what keeps `demo.echo` out of
  // `demo.echoes`.
  const pattern = new RegExp(`(?<![A-Za-z0-9_.])(${escaped.join('|')})(?![A-Za-z0-9_])`, 'g');
  return text.replace(pattern, (name) => publicName(name));
}

export function createToolRegistry(options: ToolRegistryOptions): ToolRegistry {
  const definitions = options.definitions ?? defaultTools;
  const publicName = options.publicName ?? ((name: string) => name);
  const validators = options.validators ?? compileToolValidators(options.compiler, definitions);
  const catalogueNames = definitions.map((def) => def.name);

  const byPublicName = new Map<string, ToolDefinition>();
  for (const def of definitions) {
    byPublicName.set(publicName(def.name), def);
  }

  return {
    definitions,

    listTools: () =>
      Array.from(byPublicName.entries()).map(([name, def]) => ({
        name,
        ...(def.title ? { title: def.title } : {}),
        // Cross-references inside a description are rendered as the names
        // this door publishes, so what the model reads it can call. The
        // listing used to append `(id: queries.create)` instead when a door
        // renamed — 89 tools × ~6 tokens, about 9% of the whole listing, for
        // an id the model never produces. The dotted id stays on `definitions`.
        description: rewriteToolNames(def.description, catalogueNames, publicName),
        // Already JSON Schema — the protocol's native format.
        inputSchema: def.inputSchema,
        ...(def.ui ? { ui: def.ui } : {}),
      })),

    callTool: async (name, args, authorization) => {
      const def = byPublicName.get(name);
      if (!def) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const validate = validators.get(def.name);
      if (!validate) {
        throw new Error(`No validator compiled for tool ${name}`);
      }

      // ajv validates in place — it coerces and fills defaults — so validate a
      // copy and forward that, rather than mutating the caller's arguments.
      const validatedArgs = structuredClone(args);
      if (!validate(validatedArgs)) {
        throw new ToolValidationError(name, validate.errors, def.inputSchema);
      }

      const response = await options.callApi(def.buildRequest(validatedArgs), authorization);
      const contentType = String(response.headers['content-type'] || '');
      let body: unknown = response.payload;
      if (contentType.includes('application/json')) {
        try {
          body = response.payload ? JSON.parse(response.payload) : null;
        } catch {
          body = response.payload;
        }
      }

      return {
        statusCode: response.statusCode,
        headers: response.headers,
        body,
        text: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
      };
    },
  };
}
