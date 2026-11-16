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
 * Parses a TSV cell, which SPARQL TSV writes in N-Triples syntax.
 * Returns a structured RdfTermValue if it matches RDF syntax, otherwise returns the plain string
 */
function parseRdfValue(value: string): string | RdfTermValue {
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
  const datatypeMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"(?:\^\^<([^>]+)>)?(?:@([a-zA-Z-]+))?$/);
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

  return trimmed;
}

/**
 * Splits CSV text into records of fields, per RFC 4180.
 *
 * A field in double quotes may hold commas, line breaks and `""` (one escaped
 * quote). Record separators are `\r\n`, `\n` or `\r`. Blank lines are left out.
 */
export function splitCsvRecords(content: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endRecord = () => {
    record.push(field);
    field = '';
    if (record.length > 1 || record[0] !== '') {
      records.push(record);
    }
    record = [];
  };

  while (i < content.length) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (ch === ',') {
      record.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      endRecord();
      i += ch === '\r' && content[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== '' || record.length > 0) {
    endRecord();
  }
  return records;
}

/**
 * Parses CSV content into an array of objects, per RFC 4180.
 */
export function parseCsv(content: string): TabularRow[] {
  const records = splitCsvRecords(content);

  if (records.length === 0) {
    return [];
  }

  const headers = records[0].map(h => h.trim());

  const rows: TabularRow[] = [];

  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    const row: TabularRow = {};
    headers.forEach((header, index) => {
      row[header] = parseCsvValue(values[index] ?? '');
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Reads one unquoted CSV field. SPARQL CSV writes every term without
 * N-Triples syntax, so only IRIs and blank nodes are told apart by prefix.
 * The value is kept as written: a literal may start or end with spaces.
 */
function parseCsvValue(value: string): string | RdfTermValue {
  const trimmed = value.trim();
  if (trimmed === '') {
    // An unbound variable is an empty field.
    return '';
  }
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('urn:') ||
    trimmed.startsWith('ftp://') ||
    trimmed.startsWith('file://')
  ) {
    return { value: trimmed, type: 'uri' };
  }
  if (trimmed.startsWith('_:')) {
    return { value: trimmed, type: 'bnode' };
  }
  return { value, type: 'literal' };
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
      row[header] = parseRdfValue(values[index] || '');
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
