/**
 * A small WKT reader: the seven OGC simple feature types, with Z, M and ZM.
 *
 * Z is kept as the third coordinate; M is dropped, since GeoJSON has no place
 * for it. An `EMPTY` geometry reads as `null`. Keywords are case-insensitive.
 * Axis order is left as written: the CRS rule is applied by the caller.
 */
import type { Geometry, Position } from './types.js';

export class WktError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WktError';
  }
}

type Token = { kind: 'word' | 'number' | '(' | ')' | ','; text: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:([A-Za-z]+)|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([(),]))/y;
  let index = 0;
  while (index < text.length) {
    if (/^\s*$/.test(text.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (!match) throw new WktError(`Unexpected character at ${index}: "${text.slice(index, index + 10)}"`);
    if (match[1] !== undefined) tokens.push({ kind: 'word', text: match[1].toUpperCase() });
    else if (match[2] !== undefined) tokens.push({ kind: 'number', text: match[2] });
    else tokens.push({ kind: match[3] as '(' | ')' | ',', text: match[3]! });
    index = pattern.lastIndex;
  }
  return tokens;
}

class Reader {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.index];
  }

  next(): Token {
    const token = this.tokens[this.index++];
    if (!token) throw new WktError('Unexpected end of WKT');
    return token;
  }

  expect(kind: Token['kind']): Token {
    const token = this.next();
    if (token.kind !== kind) throw new WktError(`Expected "${kind}", found "${token.text}"`);
    return token;
  }

  atEnd(): boolean {
    return this.index >= this.tokens.length;
  }
}

type Dimensions = { hasZ: boolean; hasM: boolean };

const TYPES = new Set([
  'POINT',
  'LINESTRING',
  'POLYGON',
  'MULTIPOINT',
  'MULTILINESTRING',
  'MULTIPOLYGON',
  'GEOMETRYCOLLECTION',
]);

/** Parse WKT text. Returns null for an `EMPTY` geometry. Throws `WktError` for anything malformed. */
export function parseWkt(text: string): Geometry | null {
  const reader = new Reader(tokenize(text));
  const geometry = readGeometry(reader);
  if (!reader.atEnd()) throw new WktError(`Unexpected "${reader.peek()!.text}" after the geometry`);
  return geometry;
}

function readGeometry(reader: Reader): Geometry | null {
  const typeToken = reader.expect('word');
  const type = typeToken.text;
  if (!TYPES.has(type)) throw new WktError(`Unknown geometry type "${type}"`);
  const dims = readDimensions(reader);
  if (reader.peek()?.kind === 'word' && reader.peek()!.text === 'EMPTY') {
    reader.next();
    return null;
  }
  switch (type) {
    case 'POINT': {
      reader.expect('(');
      const position = readPosition(reader, dims);
      reader.expect(')');
      return { type: 'Point', coordinates: position };
    }
    case 'LINESTRING':
      return { type: 'LineString', coordinates: readPositionList(reader, dims) };
    case 'POLYGON':
      return { type: 'Polygon', coordinates: readList(reader, () => readPositionList(reader, dims)) };
    case 'MULTIPOINT':
      return { type: 'MultiPoint', coordinates: readList(reader, () => readMultiPointMember(reader, dims)) };
    case 'MULTILINESTRING':
      return { type: 'MultiLineString', coordinates: readList(reader, () => readPositionList(reader, dims)) };
    case 'MULTIPOLYGON':
      return {
        type: 'MultiPolygon',
        coordinates: readList(reader, () => readList(reader, () => readPositionList(reader, dims))),
      };
    default: {
      const geometries = readList(reader, () => readGeometry(reader)).filter((g): g is Geometry => g !== null);
      return { type: 'GeometryCollection', geometries };
    }
  }
}

function readDimensions(reader: Reader): Dimensions {
  const next = reader.peek();
  if (next?.kind !== 'word') return { hasZ: false, hasM: false };
  switch (next.text) {
    case 'Z':
      reader.next();
      return { hasZ: true, hasM: false };
    case 'M':
      reader.next();
      return { hasZ: false, hasM: true };
    case 'ZM':
      reader.next();
      return { hasZ: true, hasM: true };
    default:
      return { hasZ: false, hasM: false };
  }
}

/** `( item , item , … )` */
function readList<T>(reader: Reader, readItem: () => T): T[] {
  reader.expect('(');
  const items = [readItem()];
  while (reader.peek()?.kind === ',') {
    reader.next();
    items.push(readItem());
  }
  reader.expect(')');
  return items;
}

function readPositionList(reader: Reader, dims: Dimensions): Position[] {
  return readList(reader, () => readPosition(reader, dims));
}

/** A MULTIPOINT member, written `(1 2)` or, in the older form, `1 2`. */
function readMultiPointMember(reader: Reader, dims: Dimensions): Position {
  if (reader.peek()?.kind === '(') {
    reader.next();
    const position = readPosition(reader, dims);
    reader.expect(')');
    return position;
  }
  return readPosition(reader, dims);
}

function readPosition(reader: Reader, dims: Dimensions): Position {
  const numbers: number[] = [];
  while (reader.peek()?.kind === 'number') numbers.push(Number(reader.next().text));
  // Without a Z or M keyword, a third number is Z and a fourth is M, as many writers emit.
  const expected = 2 + (dims.hasZ ? 1 : 0) + (dims.hasM ? 1 : 0);
  if (numbers.length < 2 || numbers.length > 4 || ((dims.hasZ || dims.hasM) && numbers.length !== expected)) {
    throw new WktError(`A position has ${numbers.length} numbers`);
  }
  const [x, y] = numbers as [number, number];
  const hasZ = dims.hasZ || (!dims.hasM && numbers.length >= 3);
  return hasZ ? [x, y, numbers[2]!] : [x, y];
}
