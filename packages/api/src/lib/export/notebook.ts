/**
 * The library, exported as a Jupyter notebook: worked calls, not live parameterisation.
 *
 * One markdown cell plus one code cell per query. The code cell holds the query's
 * text *already substituted* — by the real runtime, at export time — against its
 * first recorded example (or an all-wildcard call when the query has none), and a
 * small `run()` helper that POSTs it to whatever `ENDPOINT` is set to.
 *
 * There is deliberately no live argument substitution in Python: that would mean
 * reimplementing SPARQL term escaping in a second language, and term serialisation
 * is the security boundary this whole design keeps in exactly one place
 * (`@sparql-query-lib/runtime`). Supplied example arguments are well-formed by
 * construction — they come from the library's own tests — so a user who mutates
 * a cell badly just re-runs the good one. See
 * `docs/guides/static-export.md`.
 */

import { fromBundle, type CallPayload, type ExportBundle, type ExportedQuery } from '@sparql-query-lib/runtime';

export interface NotebookOptions {
  /** Queries and tests left out of the export, listed on a markdown cell. */
  skipped?: Array<{ name: string; reason: string }>;
  /** Prefills the `ENDPOINT` constant in the setup cell. */
  endpoint?: string;
}

interface NotebookCell {
  id: string;
  cell_type: 'markdown' | 'code';
  metadata: Record<string, never>;
  source: string;
  execution_count?: null;
  outputs?: never[];
}

/** nbformat 4.5: `^[a-zA-Z0-9-_]+$`, between 1 and 64 characters. */
const MAX_CELL_ID_LENGTH = 64;

/**
 * Mint cell ids that are derived from the library rather than from a counter.
 *
 * nbformat 4.5 requires an `id` on every cell, and a reader that finds none
 * invents one — differently on every read, since it is a random string. Two
 * downloads of an unchanged library would then differ cell for cell the moment
 * anyone opened and saved them, which is precisely the diff and merge that cell
 * ids were added to the format to make possible. Deriving the id from the
 * query's bundle key keeps it stable across exports, so a re-export of a library
 * with one query changed is a one-cell diff.
 */
function cellIds(): (candidate: string) => string {
  const used = new Set<string>();
  return (candidate) => {
    const base =
      candidate.replace(/[^a-zA-Z0-9\-_]+/g, '-').slice(0, MAX_CELL_ID_LENGTH) || 'cell';
    let id = base;
    // Bundle keys are already unique, so only truncation can collide — same
    // numeric-suffix convention the keys themselves use.
    for (let suffix = 2; used.has(id); suffix++) {
      const tail = `-${suffix}`;
      id = `${base.slice(0, MAX_CELL_ID_LENGTH - tail.length)}${tail}`;
    }
    used.add(id);
    return id;
  };
}

function markdownCell(id: string, source: string): NotebookCell {
  return { id, cell_type: 'markdown', metadata: {}, source };
}

function codeCell(id: string, source: string): NotebookCell {
  return { id, cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source };
}

/**
 * Render `text` as a Python triple-double-quoted string literal.
 *
 * Escaping every backslash and every `"` (rather than only the sequences that
 * would break `"""`) means the result is correct for *any* input — including a
 * SPARQL long string literal that itself uses `"""` — at the cost of losing some
 * of the triple-quote's readability advantage on the rare query that needs it.
 */
function pythonTripleQuoted(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"""${escaped}"""`;
}

/** The signature, as one line: what to supply, and what may be paged. */
function signatureLine(query: ExportedQuery): string {
  const parts = query.inferredInputs.map(
    (vars, index) => `slot ${index + 1}: ${vars.map((v) => `?${v}`).join(', ')}`,
  );
  if (parts.length === 0) parts.push('no arguments');
  if (query.limitParameters.length > 0) parts.push(`limit ${query.limitParameters.join(', ')}`);
  if (query.offsetParameters.length > 0) parts.push(`offset ${query.offsetParameters.join(', ')}`);
  return parts.join(' · ');
}

/** The payload used for the query's one worked call. */
function workedPayload(query: ExportedQuery): { payload: CallPayload; exampleName: string | null } {
  const example = query.examples?.[0];
  if (example) {
    return {
      payload: { arguments: example.arguments, limits: example.limits, offsets: example.offsets },
      exampleName: example.name,
    };
  }
  // One all-UNDEF row per slot — the wildcard call, same convention the exported
  // HTML page opens on when a query has no recorded example.
  return {
    payload: { arguments: query.inferredInputs.map(() => ({ bindings: [{}] })) },
    exampleName: null,
  };
}

function queryMarkdown(slug: string, query: ExportedQuery, exampleName: string | null): string {
  const lines = [`### \`${slug}\``, '', `**${query.queryType}** — ${signatureLine(query)}`];
  if (query.description) lines.push('', query.description);
  lines.push(
    '',
    exampleName
      ? `Worked call below uses the recorded example "${exampleName}".`
      : 'This query has no recorded example; the call below uses wildcard (UNDEF) arguments.',
  );
  return lines.join('\n');
}

function queryCode(query: ExportedQuery, queryText: string): string {
  return [
    `QUERY_TYPE = ${JSON.stringify(query.queryType)}`,
    `QUERY = ${pythonTripleQuoted(queryText)}`,
    '',
    'def run(query=QUERY, query_type=QUERY_TYPE, endpoint=ENDPOINT):',
    '    is_bindings = query_type in ("SELECT", "ASK")',
    '    accept = "application/sparql-results+json" if is_bindings else "text/turtle"',
    '    response = requests.post(endpoint, data={"query": query}, headers={"Accept": accept})',
    '    response.raise_for_status()',
    '    return response.json() if is_bindings else response.text',
    '',
    'run()',
  ].join('\n');
}

/**
 * Render the library as an `.ipynb` document (nbformat 4).
 *
 * Returned as a JSON string, ready to send: there is nothing else to inline (no
 * runtime, no browser bundle), because substitution already happened here rather
 * than in the notebook.
 */
export function generateNotebook(bundle: ExportBundle, options: NotebookOptions = {}): string {
  const slugs = Object.keys(bundle.queries);
  const skipped = options.skipped ?? [];
  const title = bundle.library.name ?? bundle.library.id;
  const lib = fromBundle(bundle);
  const nextId = cellIds();

  const cells: NotebookCell[] = [];

  const intro = [
    `# ${title}`,
    '',
    `${slugs.length} quer${slugs.length === 1 ? 'y' : 'ies'}${bundle.generatedAt ? ` · exported ${bundle.generatedAt}` : ''}`,
    '',
    'Each query below is a worked call: the query text is already substituted with ' +
      "a well-formed example, and a small `run()` helper POSTs it to `ENDPOINT`. " +
      'Edit `ENDPOINT` and re-run a cell to call it against your own data — arguments ' +
      'themselves are not re-substituted in this notebook, only the query text is.',
  ];
  cells.push(markdownCell(nextId('intro'), intro.join('\n')));

  cells.push(
    codeCell(
      nextId('setup'),
      ['import requests', '', `ENDPOINT = ${JSON.stringify(options.endpoint ?? 'https://example.org/sparql')}  # set this to your SPARQL endpoint`].join(
        '\n',
      ),
    ),
  );

  if (skipped.length > 0) {
    const lines = [
      `**${skipped.length} ${skipped.length === 1 ? 'query is' : 'queries are'} in this library but not in this export:**`,
      '',
      ...skipped.map((entry) => `- ${entry.name} — ${entry.reason}`),
    ];
    cells.push(markdownCell(nextId('skipped'), lines.join('\n')));
  }

  for (const slug of slugs) {
    const query = bundle.queries[slug];
    const { payload, exampleName } = workedPayload(query);
    const queryText = lib.query(slug).text(payload);
    cells.push(markdownCell(nextId(`md-${slug}`), queryMarkdown(slug, query, exampleName)));
    cells.push(codeCell(nextId(`code-${slug}`), queryCode(query, queryText)));
  }

  const notebook = {
    cells,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };

  return JSON.stringify(notebook, null, 1);
}
