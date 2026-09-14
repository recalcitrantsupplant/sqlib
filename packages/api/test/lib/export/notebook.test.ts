import { describe, expect, it } from 'vitest';
import { buildExportBundle } from '../../../src/lib/export/queryBundle.js';
import { generateNotebook } from '../../../src/lib/export/notebook.js';

async function bundleOf(
  queries: Array<{ name: string; queryString: string; description?: string }>,
) {
  return buildExportBundle({
    library: { id: 'urn:sqlib:library:test', name: 'Test Library' },
    queries,
    generatedAt: '2026-08-26T00:00:00.000Z',
  });
}

const PEOPLE = {
  name: 'People by city',
  queryString:
    'PREFIX ex: <http://example.org/>\nSELECT ?name WHERE { VALUES (?city) { (UNDEF) } ?p ex:livesIn ?city ; ex:name ?name }',
};

async function notebookOf(
  queries = [PEOPLE],
  options: Parameters<typeof generateNotebook>[1] = {},
) {
  const bundle = await bundleOf(queries);
  return generateNotebook(bundle, options);
}

function parse(notebook: string) {
  return JSON.parse(notebook);
}

describe('notebook structure', () => {
  it('produces a valid nbformat 4 document', async () => {
    const notebook = parse(await notebookOf());
    expect(notebook.nbformat).toBe(4);
    expect(notebook.metadata.kernelspec.language).toBe('python');
    expect(Array.isArray(notebook.cells)).toBe(true);
  });

  it('gives each query a markdown cell and a code cell', async () => {
    const notebook = parse(await notebookOf());
    const markdown = notebook.cells.filter((c: { cell_type: string }) => c.cell_type === 'markdown');
    const code = notebook.cells.filter((c: { cell_type: string }) => c.cell_type === 'code');
    expect(markdown.some((c: { source: string }) => c.source.includes('people-by-city'))).toBe(true);
    expect(code.some((c: { source: string }) => c.source.includes('def run('))).toBe(true);
  });

  it('starts with a setup cell defining ENDPOINT', async () => {
    const notebook = parse(await notebookOf());
    expect(notebook.cells[1].cell_type).toBe('code');
    expect(notebook.cells[1].source).toContain('import requests');
    expect(notebook.cells[1].source).toContain('ENDPOINT =');
  });

  it('prefills the endpoint when given one', async () => {
    const notebook = parse(await notebookOf([PEOPLE], { endpoint: 'https://dbpedia.org/sparql' }));
    expect(notebook.cells[1].source).toContain('https://dbpedia.org/sparql');
  });

  it('spells out the signature', async () => {
    const notebook = parse(await notebookOf());
    const markdown = notebook.cells.find((c: { source: string }) => c.source.includes('slot 1'));
    expect(markdown.source).toContain('slot 1: ?city');
  });

  it('reports what the export left out', async () => {
    const notebook = parse(
      await notebookOf([PEOPLE], { skipped: [{ name: 'Draft', reason: 'The query has no current version.' }] }),
    );
    const callout = notebook.cells.find((c: { source: string }) => c.source.includes('not in this export'));
    expect(callout.source).toContain('Draft — The query has no current version.');
  });

  it('renders an empty library without breaking', async () => {
    const notebook = parse(await notebookOf([]));
    expect(notebook.cells).toHaveLength(2); // intro + setup, no queries
  });
});

describe('worked calls', () => {
  it('substitutes a wildcard call when the query has no example', async () => {
    // A single all-UNDEF row is the wildcard: applyTemplateArguments drops the
    // VALUES clause entirely (mode 'unconstrained'), same as the exported HTML
    // page's default call for a query with no recorded example.
    const notebook = parse(await notebookOf());
    const code = notebook.cells.find((c: { source: string }) => c.cell_type === 'code' && c.source.includes('QUERY ='));
    expect(code.source).not.toContain('VALUES');
    const markdown = notebook.cells.find((c: { source: string }) => c.source.includes('slot 1'));
    expect(markdown.source).toContain('wildcard');
  });

  it('substitutes the first recorded example', async () => {
    const bundle = await bundleOf([PEOPLE]);
    bundle.queries['people-by-city'].examples = [
      {
        name: 'Perth',
        arguments: [
          {
            head: { vars: ['city'] },
            arguments: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] },
          },
        ],
      },
    ];
    const notebook = parse(generateNotebook(bundle));
    const code = notebook.cells.find((c: { source: string }) => c.cell_type === 'code' && c.source.includes('QUERY ='));
    expect(code.source).toContain('VALUES ?city { ex:Perth }');
    const markdown = notebook.cells.find((c: { source: string }) => c.source.includes('people-by-city'));
    expect(markdown.source).toContain('Perth');
  });

  it('never emits live Python argument substitution', async () => {
    // The whole point of the design: no term-escaping logic duplicated in Python.
    const notebook = parse(await notebookOf());
    const code = notebook.cells.filter((c: { cell_type: string }) => c.cell_type === 'code');
    for (const cell of code) {
      expect(cell.source).not.toMatch(/serializeTerm|escapeLiteral/);
    }
  });
});

describe('escaping', () => {
  it('embeds a query containing a literal triple double-quote', async () => {
    const bundle = await bundleOf([
      { name: 'Odd', queryString: 'SELECT ?x WHERE { ?x ?p "a \\"\\"\\" b" }' },
    ]);
    const notebook = generateNotebook(bundle);
    // Must still be valid JSON (the outer document), and the only unescaped
    // `"""` runs in the cell must be the two triple-quote delimiters we added —
    // every quote from the query itself is individually backslash-escaped, so
    // none can combine with a neighbour to close the string early.
    const parsed = parse(notebook);
    const code = parsed.cells.find((c: { source: string }) => c.cell_type === 'code' && c.source.includes('QUERY ='));
    expect(code.source.match(/"""/g)).toHaveLength(2);
  });

  it('embeds a query containing a backslash', async () => {
    const bundle = await bundleOf([
      { name: 'Backslash', queryString: 'SELECT ?x WHERE { ?x ?p "a\\\\b" }' },
    ]);
    const notebook = parse(generateNotebook(bundle));
    const code = notebook.cells.find((c: { source: string }) => c.cell_type === 'code' && c.source.includes('QUERY ='));
    expect(code.source).toContain('a\\\\\\\\b');
  });
});
