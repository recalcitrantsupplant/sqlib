/**
 * Bundle builders for the reader's own tests.
 *
 * These are a *second* implementation of the exporter, written for probing the
 * validator: a marked-up query string is far easier to perturb than a real
 * compile, and most tests here are about what happens when a span is wrong.
 *
 * Which means they are not evidence about the format. Nothing compares what this
 * file builds against what `packages/api` writes, so the two can drift with every
 * test in both packages still green. The arbiter is
 * `test/fixtures/bundle-v1.json` — a real exported bundle, committed — and
 * `test/bundleFormat.test.ts` is what reads it. Assertions about the *format*
 * belong there; assertions about the validator's edges belong here.
 */

import type {
  ExportBundle,
  ExportedQuery,
  ExportedQueryType,
  PageParameterSpan,
} from '../src/bundle.js';
import { hashTemplateText } from '../src/bundle.js';
import type { QueryTemplate } from '../src/query-template.js';

/**
 * Build a template from text containing `«VALUES ...»` markers.
 *
 * Spans are derived from the marked-up source rather than written out by hand,
 * because a test that hard-codes offsets stops testing the thing it is about the
 * moment someone reflows the query string.
 */
export function template(marked: string, prefixes: QueryTemplate['prefixes'] = []): QueryTemplate {
  const slots: QueryTemplate['slots'] = [];
  let text = '';
  let rest = marked;

  for (;;) {
    const open = rest.indexOf('«');
    if (open === -1) break;
    const close = rest.indexOf('»', open);
    if (close === -1) throw new Error('Unclosed slot marker in fixture.');

    text += rest.slice(0, open);
    const block = rest.slice(open + 1, close);
    const vars = [...block.matchAll(/\?([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
    slots.push({ start: text.length, end: text.length + block.length, vars });
    text += block;
    rest = rest.slice(close + 1);
  }

  return { text: text + rest, slots, prefixes };
}

/**
 * Locate `LIMIT 000n` / `OFFSET 000n` placeholders in a fixture's text.
 *
 * The real export finds these by compiling with a sentinel integer, since the
 * generator rewrites the placeholder. A fixture's text is written by hand and
 * still carries them literally, so here a scan is enough — but the *result* is
 * the same shape the exporter records, which is what the runtime consumes.
 */
export function pageParametersOf(text: string): PageParameterSpan[] {
  const spans: PageParameterSpan[] = [];
  for (const [kind, keyword] of [
    ['limit', 'LIMIT'],
    ['offset', 'OFFSET'],
  ] as const) {
    // Placeholder names are whatever the author called the parameter, not just
    // digits — `LIMIT 000page` is as common as `LIMIT 0001`.
    const pattern = new RegExp(`\\b${keyword}\\s+000([A-Za-z0-9_]+)\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      spans.push({ name: match[1], kind, start: match.index, end: match.index + match[0].length });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export async function exportedQuery(
  tpl: QueryTemplate,
  overrides: Partial<ExportedQuery> = {},
): Promise<ExportedQuery> {
  const pageParameters = pageParametersOf(tpl.text);
  return {
    template: tpl,
    queryType: 'SELECT' as ExportedQueryType,
    limitParameters: pageParameters.filter((p) => p.kind === 'limit').map((p) => p.name),
    offsetParameters: pageParameters.filter((p) => p.kind === 'offset').map((p) => p.name),
    ...(pageParameters.length > 0 ? { pageParameters } : {}),
    inferredInputs: tpl.slots.map((slot) => [...slot.vars].sort()),
    textHash: await hashTemplateText(tpl.text),
    ...overrides,
  };
}

export async function bundleOf(
  queries: Record<string, QueryTemplate | ExportedQuery>,
): Promise<ExportBundle> {
  const entries = await Promise.all(
    Object.entries(queries).map(async ([name, value]) => [
      name,
      'template' in value ? value : await exportedQuery(value),
    ]),
  );
  return {
    version: 1,
    library: { id: 'urn:sqlib:library:test', name: 'Test' },
    queries: Object.fromEntries(entries) as Record<string, ExportedQuery>,
  };
}
