import type { JsonValue, ResultTerm } from './types.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

const INTEGER_TYPES = new Set(
  [
    'integer',
    'int',
    'long',
    'short',
    'byte',
    'nonNegativeInteger',
    'nonPositiveInteger',
    'negativeInteger',
    'positiveInteger',
    'unsignedLong',
    'unsignedInt',
    'unsignedShort',
    'unsignedByte',
  ].map(name => `${XSD}${name}`),
);

const DECIMAL_TYPES = new Set(['decimal', 'double', 'float'].map(name => `${XSD}${name}`));

/** Whether a literal's datatype is one of XSD's numeric types. */
export function isNumericDatatype(datatype: string | undefined): boolean {
  return datatype !== undefined && (INTEGER_TYPES.has(datatype) || DECIMAL_TYPES.has(datatype));
}

/**
 * One RDF term as a GeoJSON property value.
 *
 * Numbers and booleans become JSON numbers and booleans when that loses
 * nothing: an integer past 2^53, `NaN` and the infinities stay strings. An IRI
 * is its string, a blank node `_:label`, any other literal its lexical form.
 */
export function propertyValue(term: ResultTerm): JsonValue {
  if (term.type === 'bnode') return `_:${term.value}`;
  if (term.type !== 'literal' && term.type !== 'typed-literal') return term.value;
  const { datatype, value } = term;
  if (datatype && INTEGER_TYPES.has(datatype)) {
    if (!/^[-+]?\d+$/.test(value.trim())) return value;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : value;
  }
  if (datatype && DECIMAL_TYPES.has(datatype)) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && value.trim() !== '' ? parsed : value;
  }
  if (datatype === `${XSD}boolean`) {
    const trimmed = value.trim();
    if (trimmed === 'true' || trimmed === '1') return true;
    if (trimmed === 'false' || trimmed === '0') return false;
  }
  return value;
}
