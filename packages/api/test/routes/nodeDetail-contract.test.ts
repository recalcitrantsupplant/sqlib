import { describe, it, expect } from 'vitest';
import { executionRequestSchema } from '@sparql-query-lib/contracts';

describe('web/API contract for nodeDetail', () => {
  it('the strict request schema accepts nodeDetail', () => {
    // The web client parses the payload through this before sending; a stale
    // contracts build would throw here and break execution outright.
    const parsed = executionRequestSchema.parse({ targetId: 'urn:sqlib:query-group:1', nodeDetail: 'results' });
    expect(parsed.nodeDetail).toBe('results');
  });

  it('rejects an unknown nodeDetail mode', () => {
    expect(() => executionRequestSchema.parse({ targetId: 'urn:sqlib:query-group:1', nodeDetail: 'everything' })).toThrow();
  });
});
