import { describe, expect, it } from 'vitest';
import { propertyValue } from '../src/properties.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const typed = (value: string, type: string) => ({ type: 'literal', value, datatype: `${XSD}${type}` });

describe('propertyValue', () => {
  it('turns XSD numbers and booleans into JSON', () => {
    expect(propertyValue(typed('42', 'integer'))).toBe(42);
    expect(propertyValue(typed('-7', 'int'))).toBe(-7);
    expect(propertyValue(typed('1.25', 'decimal'))).toBe(1.25);
    expect(propertyValue(typed('1e3', 'double'))).toBe(1000);
    expect(propertyValue(typed('true', 'boolean'))).toBe(true);
    expect(propertyValue(typed('0', 'boolean'))).toBe(false);
  });

  it('keeps values that JSON numbers would change as strings', () => {
    expect(propertyValue(typed('9007199254740993', 'integer'))).toBe('9007199254740993');
    expect(propertyValue(typed('NaN', 'double'))).toBe('NaN');
    expect(propertyValue(typed('INF', 'float'))).toBe('INF');
    expect(propertyValue(typed('abc', 'integer'))).toBe('abc');
  });

  it('gives other terms as strings', () => {
    expect(propertyValue({ type: 'uri', value: 'urn:a' })).toBe('urn:a');
    expect(propertyValue({ type: 'bnode', value: 'b0' })).toBe('_:b0');
    expect(propertyValue({ type: 'literal', value: 'Perth', 'xml:lang': 'en' })).toBe('Perth');
    expect(propertyValue(typed('2026-11-03', 'date'))).toBe('2026-11-03');
  });
});
