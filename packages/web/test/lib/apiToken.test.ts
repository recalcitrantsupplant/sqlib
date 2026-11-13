import { describe, it, expect } from 'vitest';
import { formatExpiry, tokenExportLine } from '@/lib/apiToken';

describe('tokenExportLine', () => {
  it('exports the token under the name every snippet reads', () => {
    expect(tokenExportLine('eyJhbGciOi.eyJzdWIi.c2ln-_')).toBe("export SQLIB_TOKEN='eyJhbGciOi.eyJzdWIi.c2ln-_'");
  });

  it('refuses a value that would need quoting', () => {
    expect(() => tokenExportLine("abc'; rm -rf ~; '")).toThrow();
    expect(() => tokenExportLine('')).toThrow();
  });
});

describe('formatExpiry', () => {
  it('gives a clock time with minutes', () => {
    expect(formatExpiry(new Date(2026, 10, 11, 18, 31), 'en-AU')).toMatch(/^6:31\s?pm$/i);
  });
});
