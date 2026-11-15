/**
 * The mapping that the preview proposes for a new pipeline. A text column
 * whose sample values are all IRIs maps to an IRI.
 */
import { describe, it, expect, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ preview: vi.fn() }));

vi.mock('../../src/lib/DuckDbService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/DuckDbService.js')>();
  return {
    ...actual,
    duckDbService: { isAvailable: () => true, preview: hoisted.preview },
  };
});

import { EtlService } from '../../src/lib/EtlService.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

describe('EtlService.preview', () => {
  it('maps an IRI-valued text column to an IRI and other columns to literals', async () => {
    hoisted.preview.mockResolvedValue({
      schema: [
        { columnName: 'subject', duckdbType: 'VARCHAR', nullable: true },
        { columnName: 'label', duckdbType: 'VARCHAR', nullable: true },
        { columnName: 'value', duckdbType: 'DOUBLE', nullable: true },
      ],
      rows: [
        { subject: 'https://example.org/site/1', label: 'red', value: 12 },
        { subject: 'urn:example:site:2', label: 'green', value: 3.5 },
        { subject: null, label: 'blue', value: 3 },
      ],
    });

    const result = await new EtlService().preview({ sql: 'SELECT 1', limit: 100 });

    expect(hoisted.preview).toHaveBeenCalledWith('SELECT 1', 100);
    expect(result.inferredMapping.columns).toEqual([
      { columnName: 'subject', targetVariable: 'subject', termType: 'uri', nullPolicy: 'undef' },
      { columnName: 'label', targetVariable: 'label', termType: 'literal', datatypeIri: `${XSD}string`, nullPolicy: 'undef' },
      { columnName: 'value', targetVariable: 'value', termType: 'literal', datatypeIri: `${XSD}double`, nullPolicy: 'undef' },
    ]);
  });
});
