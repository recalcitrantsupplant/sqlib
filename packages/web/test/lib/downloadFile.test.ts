/**
 * Naming a downloaded report.
 *
 * The server names the file it rendered, and the SPA takes that name rather
 * than keeping its own table of extensions in step with the format registry.
 * So what matters is that a name is read when one is offered and that a header
 * this does not understand falls back rather than guessing.
 */
import { describe, it, expect } from 'vitest';
import { filenameFromDisposition } from '@/lib/downloadFile';

describe('filenameFromDisposition', () => {
  it('reads the name the server asked for', () => {
    expect(filenameFromDisposition('attachment; filename="test-results.ttl"'))
      .toBe('test-results.ttl');
  });

  it('falls back rather than guessing at a form it does not parse', () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('attachment')).toBeNull();
    // RFC 5987's encoded form is not what these responses send; inventing a
    // decode for it here would be untested guessing at a name.
    expect(filenameFromDisposition("attachment; filename*=UTF-8''results.ttl")).toBeNull();
  });
});
