import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESULT_CHAR_CAP,
  DEFAULT_RESULT_ROW_CAP,
  RESULT_TOOL_NAMES,
  pageStoredResult,
  shapeResultText,
} from '../../src/assistant/result-shaping.js';

describe('shapeResultText', () => {
  it('leaves a small bare array untouched', () => {
    const text = JSON.stringify([{ id: 'q1' }, { id: 'q2' }]);
    const shaped = shapeResultText(text, 'r1', { rowCap: 50 });
    expect(shaped).toEqual({ text, truncated: false });
  });

  it('truncates a bare array over the row cap and names the resultId', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `q${i}` }));
    const text = JSON.stringify(rows);

    const shaped = shapeResultText(text, 'r1', { rowCap: 2 });

    expect(shaped.truncated).toBe(true);
    const [body, note] = splitNote(shaped.text);
    expect(JSON.parse(body)).toEqual([{ id: 'q0' }, { id: 'q1' }]);
    expect(note).toContain('Showing 2 of 5 rows');
    expect(note).toContain('resultId "r1"');
    expect(note).toContain('offset 2');
  });

  it('truncates SPARQL JSON results by their bindings array, keeping head/vars intact', () => {
    const bindings = Array.from({ length: 4 }, (_, i) => ({ s: { value: `urn:${i}` } }));
    const text = JSON.stringify({ head: { vars: ['s'] }, results: { bindings } });

    const shaped = shapeResultText(text, 'r2', { rowCap: 1 });

    expect(shaped.truncated).toBe(true);
    const [body] = splitNote(shaped.text);
    const parsed = JSON.parse(body);
    expect(parsed.head).toEqual({ vars: ['s'] });
    expect(parsed.results.bindings).toEqual([{ s: { value: 'urn:0' } }]);
  });

  it('falls back to a character cap for non-JSON text (e.g. Turtle, RDF Patch)', () => {
    const text = 'A '.repeat(50).trim();
    const shaped = shapeResultText(text, 'r3', { charCap: 10 });

    expect(shaped.truncated).toBe(true);
    const [body, note] = splitNote(shaped.text);
    expect(body).toBe(text.slice(0, 10));
    expect(note).toContain(`of ${text.length} characters`);
  });

  it('does not apply the character cap to JSON under the row cap', () => {
    // The JSON below is longer than a tiny char cap but has only two rows —
    // rows are what gates a JSON body, not raw length.
    const rows = [{ id: 'q1', description: 'x'.repeat(200) }, { id: 'q2' }];
    const text = JSON.stringify(rows);

    const shaped = shapeResultText(text, 'r4', { rowCap: 50, charCap: 10 });

    expect(shaped).toEqual({ text, truncated: false });
  });

  it('is not truncated when the row count exactly meets the cap', () => {
    const text = JSON.stringify([{ id: 'q1' }, { id: 'q2' }]);
    const shaped = shapeResultText(text, 'r5', { rowCap: 2 });
    expect(shaped.truncated).toBe(false);
  });
});

describe('pageStoredResult', () => {
  it('serves the next page of a truncated row array from the given offset', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `q${i}` }));
    const stored = { text: JSON.stringify(rows) };

    const page = pageStoredResult(stored, 'r1', 2, undefined, { rowCap: 2 });

    const [body, note] = splitNote(page);
    expect(JSON.parse(body)).toEqual([{ id: 'q2' }, { id: 'q3' }]);
    expect(note).toContain('offset 4');
  });

  it('says nothing is left once the last page is reached', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `q${i}` }));
    const stored = { text: JSON.stringify(rows) };

    const page = pageStoredResult(stored, 'r1', 2, undefined, { rowCap: 2 });

    expect(page).toContain('all of it — nothing left to page');
  });

  it('caps a requested limit at the configured row cap', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}` }));
    const stored = { text: JSON.stringify(rows) };

    const page = pageStoredResult(stored, 'r1', 0, 1000, { rowCap: 3 });

    const [body] = splitNote(page);
    expect(JSON.parse(body)).toHaveLength(3);
  });

  it('pages a non-JSON body by characters', () => {
    const text = '0123456789'.repeat(5); // 50 chars
    const stored = { text };

    const page = pageStoredResult(stored, 'r2', 10, 10, { charCap: 20 });

    const [body] = splitNote(page);
    expect(body).toBe(text.slice(10, 20));
  });
});

describe('the results.more tool', () => {
  it('is the only tool this module offers', () => {
    expect(RESULT_TOOL_NAMES).toEqual(['results.more']);
  });
});

it('exports sane defaults', () => {
  expect(DEFAULT_RESULT_ROW_CAP).toBeGreaterThan(0);
  expect(DEFAULT_RESULT_CHAR_CAP).toBeGreaterThan(0);
});

/** Every shaped/paged text is `<JSON or raw slice>\n\n[note]`. */
function splitNote(text: string): [string, string] {
  const at = text.indexOf('\n\n[');
  if (at === -1) throw new Error(`expected a trailing note in: ${text}`);
  return [text.slice(0, at), text.slice(at)];
}
