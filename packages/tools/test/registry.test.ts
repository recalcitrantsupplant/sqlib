import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry, formatValidationErrors } from '../src/registry.js';
import { defineTool, type ToolRequest } from '../src/tools.js';

/**
 * The registry is the shared trunk both doors reach, so what is asserted here
 * is the thing that must not vary between them: same validation, same request,
 * same result shape, whoever asked.
 */

const echo = defineTool({
  name: 'demo.echo',
  description: 'Echo a message',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' }, count: { type: 'number', default: 1 } },
    required: ['message'],
    additionalProperties: false,
  },
  buildRequest: ({ message, count }) => ({
    method: 'POST',
    url: '/echo',
    payload: { message, count },
    headers: { 'content-type': 'application/json' },
  }),
});

/** A stand-in for the API's ajv: required-only, plus one default. */
function stubCompiler() {
  return {
    compile: (schema: Record<string, unknown>) => {
      const required = (schema.required as string[] | undefined) ?? [];
      const properties = (schema.properties as Record<string, { default?: unknown }>) ?? {};
      const validate = (data: unknown) => {
        if (typeof data !== 'object' || data === null) {
          validate.errors = [{ message: 'must be object' }];
          return false;
        }
        const record = data as Record<string, unknown>;
        for (const key of required) {
          if (!(key in record)) {
            validate.errors = [{ instancePath: '', params: { missingProperty: key }, message: "must have required property" }];
            return false;
          }
        }
        // useDefaults: fills in place, which is why callTool clones first.
        for (const [key, spec] of Object.entries(properties)) {
          if (!(key in record) && spec.default !== undefined) record[key] = spec.default;
        }
        validate.errors = null;
        return true;
      };
      validate.errors = null as ReturnType<typeof Object> | null;
      return validate as never;
    },
  };
}

function jsonCaller(body: unknown, statusCode = 200) {
  return vi.fn(async (_request: ToolRequest) => ({
    statusCode,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  }));
}

describe('tool registry', () => {
  it('validates, builds the request, and parses the response', async () => {
    const callApi = jsonCaller({ ok: true });
    const registry = createToolRegistry({ compiler: stubCompiler(), callApi, definitions: [echo] });

    const result = await registry.callTool('demo.echo', { message: 'hi' });

    expect(callApi).toHaveBeenCalledWith(
      {
        method: 'POST',
        url: '/echo',
        // The default was filled by validation, so the tool saw count: 1.
        payload: { message: 'hi', count: 1 },
        headers: { 'content-type': 'application/json' },
      },
      // No caller token: a door that has none passes none.
      undefined
    );
    expect(result.body).toEqual({ ok: true });
    expect(result.statusCode).toBe(200);
  });

  it('forwards the caller’s token to the API rather than holding one of its own', async () => {
    const callApi = jsonCaller({ ok: true });
    const registry = createToolRegistry({ compiler: stubCompiler(), callApi, definitions: [echo] });

    await registry.callTool('demo.echo', { message: 'hi' }, 'Bearer caller-token');

    expect(callApi).toHaveBeenCalledWith(expect.anything(), 'Bearer caller-token');
  });

  it('does not mutate the caller’s arguments while filling defaults', async () => {
    const registry = createToolRegistry({
      compiler: stubCompiler(),
      callApi: jsonCaller({}),
      definitions: [echo],
    });

    const args = { message: 'hi' };
    await registry.callTool('demo.echo', args);

    // ajv validates in place; the clone is what stops that reaching the caller.
    expect(args).toEqual({ message: 'hi' });
  });

  it('rejects invalid arguments before calling the API', async () => {
    const callApi = jsonCaller({});
    const registry = createToolRegistry({ compiler: stubCompiler(), callApi, definitions: [echo] });

    await expect(registry.callTool('demo.echo', {})).rejects.toThrow(/message/);
    expect(callApi).not.toHaveBeenCalled();
  });

  it('rejects an unknown tool rather than calling anything', async () => {
    const callApi = jsonCaller({});
    const registry = createToolRegistry({ compiler: stubCompiler(), callApi, definitions: [echo] });

    await expect(registry.callTool('demo.nope', {})).rejects.toThrow(/Unknown tool/);
    expect(callApi).not.toHaveBeenCalled();
  });

  it('keeps a non-JSON body as text', async () => {
    const registry = createToolRegistry({
      compiler: stubCompiler(),
      callApi: async () => ({ statusCode: 200, headers: { 'content-type': 'text/turtle' }, payload: '<a> <b> <c> .' }),
      definitions: [echo],
    });

    const result = await registry.callTool('demo.echo', { message: 'hi' });
    expect(result.body).toBe('<a> <b> <c> .');
    expect(result.text).toBe('<a> <b> <c> .');
  });

  it('surfaces an error status as a result rather than throwing', async () => {
    const registry = createToolRegistry({
      compiler: stubCompiler(),
      callApi: jsonCaller({ error: 'Not found' }, 404),
      definitions: [echo],
    });

    // The model is told what the API said; a 404 is information, not a crash.
    const result = await registry.callTool('demo.echo', { message: 'hi' });
    expect(result.statusCode).toBe(404);
    expect(result.body).toEqual({ error: 'Not found' });
  });

  it('renames on the way out and still resolves the definition', async () => {
    const registry = createToolRegistry({
      compiler: stubCompiler(),
      callApi: jsonCaller({}),
      definitions: [echo],
      publicName: (name) => name.replace(/\./g, '_'),
    });

    const [listed] = registry.listTools();
    expect(listed!.name).toBe('demo_echo');
    // The description is published as written: the model calls the public
    // name and the registry maps it back, so the dotted id is not its concern.
    expect(listed!.description).toBe(echo.description);
    expect(listed!.description).not.toContain('demo.echo');
    await expect(registry.callTool('demo_echo', { message: 'hi' })).resolves.toBeDefined();
  });

  it('renders cross-references in descriptions as public names too', () => {
    const referrer = defineTool({
      name: 'demo.referrer',
      description: 'Like demo.echo, but see demo.echoes first; head.vars is not a tool. Then call demo.echo.',
      inputSchema: { type: 'object', properties: {} },
      buildRequest: () => ({ method: 'GET', url: '/referrer' }),
    });
    const registry = createToolRegistry({
      compiler: stubCompiler(),
      callApi: jsonCaller({}),
      definitions: [echo, referrer],
      publicName: (name) => name.replace(/\./g, '_'),
    });
    const listed = registry.listTools().find((tool) => tool.name === 'demo_referrer');
    // `demo.echo` is renamed; `demo.echoes` is not a tool and so is not a
    // prefix match either; `head.vars` is left alone.
    expect(listed!.description).toBe('Like demo_echo, but see demo.echoes first; head.vars is not a tool. Then call demo_echo.');
  });

  it('lists only what it was given — this is how the allowlist works', () => {
    const registry = createToolRegistry({
      compiler: stubCompiler(),
      callApi: jsonCaller({}),
      definitions: [echo],
    });
    expect(registry.listTools().map((tool) => tool.name)).toEqual(['demo.echo']);
    expect(registry.definitions).toHaveLength(1);
  });
});

describe('formatValidationErrors', () => {
  it('lifts a missing property name out of params', () => {
    expect(formatValidationErrors([{ instancePath: '', params: { missingProperty: 'id' }, message: 'is required' }]))
      .toBe('id: is required');
  });

  it('renders a nested path with dots', () => {
    expect(formatValidationErrors([{ instancePath: '/body/name', message: 'must be string' }]))
      .toBe('body.name: must be string');
  });

  it('falls back rather than rendering nothing', () => {
    expect(formatValidationErrors([])).toBe('invalid arguments');
    expect(formatValidationErrors(null)).toBe('invalid arguments');
  });
});

/**
 * `title` is the human-readable name MCP asks for, and the registry is the one
 * place both doors read it from — so what matters is that it survives listing
 * and that its absence is absence, not an empty string a client would render.
 */
describe('tool titles', () => {
  const titled = defineTool({
    name: 'demo.titled',
    title: 'Do the thing',
    description: 'A description written for a model, at length.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    buildRequest: () => ({ method: 'GET', url: '/titled' }),
  });

  it('carries a title through to the listing MCP serves', () => {
    const registry = createToolRegistry({
      compiler: stubCompiler(),
      definitions: [titled],
      callApi: async () => ({ statusCode: 200, headers: {}, payload: '{}' }),
    });

    const [listed] = registry.listTools();
    expect(listed?.title).toBe('Do the thing');
    // The description is untouched: it is what the model reads to choose a tool.
    expect(listed?.description).toBe('A description written for a model, at length.');
  });

  it('omits the key entirely when a tool has no title', () => {
    const registry = createToolRegistry({
      compiler: stubCompiler(),
      definitions: [echo],
      callApi: async () => ({ statusCode: 200, headers: {}, payload: '{}' }),
    });

    const [listed] = registry.listTools();
    // Not `""` and not `null` — an absent optional, so a client falls back to
    // `name` per the protocol rather than rendering a blank header.
    expect(listed && 'title' in listed).toBe(false);
  });
});
