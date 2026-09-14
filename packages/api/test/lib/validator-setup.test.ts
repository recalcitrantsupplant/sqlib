import { describe, it, expect, vi } from 'vitest';
import { setupValidator } from '../../src/lib/validator-setup.js';

describe('validator-setup', () => {
  it('registers AJV compiler with IRI format support', () => {
    const setValidatorCompiler = vi.fn();
    const app = { setValidatorCompiler } as any;

    setupValidator(app);
    expect(setValidatorCompiler).toHaveBeenCalledTimes(1);

    const compilerFactory = setValidatorCompiler.mock.calls[0][0];
    const validator = compilerFactory({ schema: { type: 'string', format: 'iri' } });

    expect(validator('https://example.org/resource')).toBe(true);
    expect(validator(' not-an-iri ')).toBe(false);
    expect(Array.isArray(validator.errors)).toBe(true);
  });
});
