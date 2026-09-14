import { expect, test } from 'vitest';
// See the note in toolSchemaParity.test.ts: the package root drags in
// @sparql-query-lib/srl, which needs a prior build. This module needs only ajv.
import { createValidatorAjv } from '../../api/src/lib/validator-setup.js';
import { formatValidationErrors, sanitizeToolName } from '../src/index.js';
import { tools } from '../../tools/src/tools.js';

test('sanitizeToolName keeps MCP-compatible names', () => {
  expect(sanitizeToolName('backends.list')).toBe('backends_list');
  expect(sanitizeToolName('execute/run')).toBe('execute_run');
  expect(sanitizeToolName('alpha-1_beta')).toBe('alpha-1_beta');
});

test('sanitized tool names stay unique', () => {
  const names = tools.map(tool => sanitizeToolName(tool.name));
  expect(new Set(names).size).toBe(names.length);
});

/**
 * Was: "contract schemas convert to JSON schema for MCP tool registration".
 *
 * Phase C2 removed the conversion — the schemas *are* JSON Schema now — so the
 * assertion moves to what the tools actually publish. Same intent (every tool
 * offers the client a usable object schema), one fewer round-trip.
 */
/**
 * The error text is user-visible — it is what an MCP client shows when a tool
 * call is rejected — and §5 of the C2 handoff called out that ajv's wording
 * differs from zod's custom messages. This pins the shape it is rendered in:
 * `path: message`, with a missing property reported against its own name rather
 * than against the empty parent path.
 */
test('validation errors name the argument at fault', () => {
  const ajv = createValidatorAjv();
  const backendsUpdate = tools.find(tool => tool.name === 'backends.update')!;
  const validate = ajv.compile(backendsUpdate.inputSchema);

  expect(validate({})).toBe(false);
  const message = formatValidationErrors(validate.errors);
  expect(message).toContain('id');
  expect(message).toContain('body');
  expect(message).not.toMatch(/^:/);
});

test('formatValidationErrors survives an empty error list', () => {
  expect(formatValidationErrors(null)).toBe('invalid arguments');
  expect(formatValidationErrors([])).toBe('invalid arguments');
});

test('every tool publishes a compilable object JSON Schema', () => {
  const ajv = createValidatorAjv();
  expect(tools.length).toBeGreaterThan(0);

  for (const tool of tools) {
    expect(tool.inputSchema.type, `${tool.name} must publish an object schema`).toBe('object');
    expect(() => ajv.compile(tool.inputSchema), `${tool.name} must compile`).not.toThrow();
  }
});
