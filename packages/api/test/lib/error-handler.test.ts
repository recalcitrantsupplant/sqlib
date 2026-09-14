import { describe, it, expect, vi } from 'vitest';
import { handleSparqlExecutionError, sendErrorResponse } from '../../src/lib/error-handler.js';

describe('error-handler', () => {
  it('classifies timeout errors', () => {
    const result = handleSparqlExecutionError({ code: 'ETIMEDOUT' }, 'urn:backend');
    expect(result).toEqual({
      statusCode: 504,
      error: expect.stringContaining('Connection timeout'),
    });
  });

  it('classifies AggregateError precedence', () => {
    const aggregate = {
      name: 'AggregateError',
      errors: [{ code: 'ECONNREFUSED' }, { code: 'ENETUNREACH' }],
    };
    const result = handleSparqlExecutionError(aggregate, 'urn:backend');
    expect(result.statusCode).toBe(502);
    expect(result.error).toContain('Connection refused');
  });

  it('maps HTTP status failures', () => {
    const result = handleSparqlExecutionError({ message: 'HTTP SPARQL query failed with status 418' }, 'urn:backend');
    expect(result).toEqual({
      statusCode: 502,
      error: 'Failed to connect to backend urn:backend: HTTP SPARQL query failed with status 418',
    });
  });

  it('uses fallback for unknown errors', () => {
    const result = handleSparqlExecutionError({ message: 'Unexpected issue' }, 'urn:backend');
    expect(result).toEqual({
      statusCode: 500,
      error: 'Internal server error during execution: Unexpected issue',
    });
  });

  it('sendErrorResponse writes status and payload', () => {
    const code = vi.fn().mockReturnThis();
    const send = vi.fn();
    const reply = { code, send } as any;

    sendErrorResponse(reply, { statusCode: 400, error: 'Bad request' });

    expect(code).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({ error: 'Bad request' });
  });
});
