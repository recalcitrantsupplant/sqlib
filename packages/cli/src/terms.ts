/**
 * Arguments on the command line: `--arg city=<http://example.org/Perth>`.
 *
 * A term is written as in SPARQL: an IRI in angle brackets, a quoted literal
 * with an optional `@lang` or `^^<datatype>`, or a bare number or boolean.
 * Each `--arg` is one row; several for the same variable make several rows of
 * that slot. A slot that binds more than one variable takes `--args` with a
 * SPARQL Results JSON file instead.
 */
import type { TemplateArgumentSet, TermValue } from '@sparql-query-lib/runtime';
import { CliError } from './io.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

function unescape(text: string): string {
  return text.replace(/\\(.)/g, (_, char: string) => ({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[char] ?? char);
}

/** One term in SPARQL syntax. */
export function parseTerm(text: string): TermValue {
  const source = text.trim();
  const iri = /^<([^<>"{}|^`\\\s]*)>$/.exec(source);
  if (iri) return { type: 'uri', value: iri[1]! };

  const quoted = /^"((?:[^"\\]|\\.)*)"(?:@([a-zA-Z]+(?:-[a-zA-Z0-9]+)*)|\^\^<([^<>\s]*)>)?$/.exec(source);
  if (quoted) {
    const term: TermValue = { type: 'literal', value: unescape(quoted[1]!) };
    if (quoted[2]) term['xml:lang'] = quoted[2];
    if (quoted[3]) term.datatype = quoted[3];
    return term;
  }

  if (/^[+-]?\d+$/.test(source)) return { type: 'literal', value: source, datatype: `${XSD}integer` };
  if (/^[+-]?\d*\.\d+$/.test(source)) return { type: 'literal', value: source, datatype: `${XSD}decimal` };
  if (/^[+-]?(\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(source)) return { type: 'literal', value: source, datatype: `${XSD}double` };
  if (source === 'true' || source === 'false') return { type: 'literal', value: source, datatype: `${XSD}boolean` };

  throw new CliError(
    `Cannot read '${text}' as a term. Write an IRI as <http://…>, a literal as "text", "text"@en or "1"^^<datatype>, or a bare number or boolean.`,
  );
}

/** `--arg` values, grouped into one argument set per variable. */
export function argumentSetsFromArgs(values: readonly string[]): TemplateArgumentSet[] {
  const rows = new Map<string, TermValue[]>();
  for (const value of values) {
    const at = value.indexOf('=');
    if (at <= 0) throw new CliError(`--arg takes variable=term, as in city=<http://example.org/Perth>; got '${value}'.`);
    const name = value.slice(0, at).replace(/^[?$]/, '');
    const term = parseTerm(value.slice(at + 1));
    rows.set(name, [...(rows.get(name) ?? []), term]);
  }
  return [...rows].map(([name, terms]) => ({
    head: { vars: [name] },
    results: { bindings: terms.map(term => ({ [name]: term })) },
  }));
}

/** An `--args` file: one SPARQL Results JSON document, or an array of them. */
export function argumentSetsFromJson(text: string, file: string): TemplateArgumentSet[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliError(`${file} is not JSON: ${(error as Error).message}`);
  }
  return (Array.isArray(parsed) ? parsed : [parsed]) as TemplateArgumentSet[];
}

/** `--limit 1=20` and `--offset 2=40`: a parameter name and a value. */
export function pageParameters(values: readonly string[], option: string): Record<string, number> {
  const parameters: Record<string, number> = {};
  for (const value of values) {
    const match = /^(\d+)=(\d+)$/.exec(value);
    if (!match) throw new CliError(`--${option} takes name=value, as in 1=20; got '${value}'.`);
    parameters[match[1]!] = Number(match[2]);
  }
  return parameters;
}
