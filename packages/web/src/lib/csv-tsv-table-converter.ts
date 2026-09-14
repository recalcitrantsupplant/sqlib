/**
 * Parses CSV and TSV content into tabular format.
 * Supports both plain text values and RDF syntax (N-Triples style).
 */

/**
 * Represents a cell value that can be either plain string or structured RDF term
 */
export interface RdfTermValue {
  value: string;
  type: 'uri' | 'bnode' | 'literal';
  datatype?: string;
  'xml:lang'?: string;
}

export interface TabularRow {
  [key: string]: string | RdfTermValue;
}

/**
 * Parses a cell value that might be in RDF syntax (N-Triples style for TSV, plain for CSV)
 * Returns a structured RdfTermValue if it matches RDF syntax, otherwise returns the plain string
 */
function parseRdfValue(value: string, detectPlainUris: boolean = false): string | RdfTermValue {
  const trimmed = value.trim();

  // URI with angle brackets: <http://example.org> (N-Triples/TSV style)
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return {
      value: trimmed.slice(1, -1),
      type: 'uri',
    };
  }

  // Blank node: _:b0
  if (trimmed.startsWith('_:')) {
    return {
      value: trimmed,
      type: 'bnode',
    };
  }

  // Literal with datatype: "value"^^<datatype> (N-Triples/TSV style)
  const datatypeMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"(?:\^\^<([^>]+)>)?(?:@([a-zA-Z\-]+))?$/);
  if (datatypeMatch) {
    const literalValue = datatypeMatch[1]
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');

    const result: RdfTermValue = {
      value: literalValue,
      type: 'literal',
    };

    if (datatypeMatch[3]) {
      // Language tag
      result['xml:lang'] = datatypeMatch[3];
    } else if (datatypeMatch[2] && datatypeMatch[2] !== 'http://www.w3.org/2001/XMLSchema#string') {
      // Datatype (skip xsd:string as it's default)
      result.datatype = datatypeMatch[2];
    }

    return result;
  }

  // Plain URI detection for CSV (without angle brackets)
  if (detectPlainUris) {
    // Detect URIs by common prefixes
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('urn:') ||
      trimmed.startsWith('ftp://') ||
      trimmed.startsWith('file://')
    ) {
      return {
        value: trimmed,
        type: 'uri',
      };
    }

    // Detect blank nodes without angle brackets (plain _:xxx)
    if (trimmed.startsWith('_:')) {
      return {
        value: trimmed,
        type: 'bnode',
      };
    }
  }

  // Plain string (literal without quotes or unknown format)
  // If it looks like it might be a typed literal value, mark it as literal
  if (detectPlainUris && trimmed.length > 0) {
    return {
      value: trimmed,
      type: 'literal',
    };
  }

  return trimmed;
}

/**
 * Parses CSV content into an array of objects.
 * Handles different line ending styles: \r\n (Windows), \n (Unix), \r (old Mac)
 */
export function parseCsv(content: string): TabularRow[] {
  // Normalize line endings to \n, then split
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedContent.trim().split('\n');

  if (lines.length === 0) {
    return [];
  }

  const headers = lines[0].split(',').map(h => h.trim());

  const rows: TabularRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row: TabularRow = {};
    headers.forEach((header, index) => {
      // CSV uses plain URIs without angle brackets, so enable plain URI detection
      row[header] = parseRdfValue(values[index] || '', true);
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Parses TSV content into an array of objects.
 * Handles different line ending styles: \r\n (Windows), \n (Unix), \r (old Mac)
 */
export function parseTsv(content: string): TabularRow[] {
  // Normalize line endings to \n, then split
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedContent.trim().split('\n');

  if (lines.length === 0) {
    return [];
  }

  const headers = lines[0].split('\t').map(h => h.trim());

  const rows: TabularRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row: TabularRow = {};
    headers.forEach((header, index) => {
      // TSV uses N-Triples syntax with angle brackets, so no plain URI detection needed
      row[header] = parseRdfValue(values[index] || '', false);
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Determines if content type is CSV.
 */
export function isCsvContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return normalized === 'text/csv';
}

/**
 * Determines if content type is TSV.
 */
export function isTsvContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return normalized === 'text/tab-separated-values';
}
