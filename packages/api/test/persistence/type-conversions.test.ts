
import { nullToUndefined, undefinedToNull, cleanNullValues, prepareForLdkit, dateToIsoString, stringToDate, normalizeDatesForApi, normalizeDatesForLdkit } from '../../src/persistence/utils/type-conversions.js';

describe('type-conversions', () => {
  describe('nullToUndefined', () => {
    it('should convert null to undefined', () => {
      expect(nullToUndefined(null)).toBeUndefined();
    });

    it('should not change other values', () => {
      expect(nullToUndefined('string')).toBe('string');
      expect(nullToUndefined(0)).toBe(0);
      expect(nullToUndefined(false)).toBe(false);
      expect(nullToUndefined(undefined)).toBeUndefined();
    });
  });

  describe('undefinedToNull', () => {
    it('should convert undefined to null', () => {
      expect(undefinedToNull(undefined)).toBeNull();
    });

    it('should not change other values', () => {
      expect(undefinedToNull('string')).toBe('string');
      expect(undefinedToNull(0)).toBe(0);
      expect(undefinedToNull(false)).toBe(false);
      expect(undefinedToNull(null)).toBeNull();
    });
  });

  describe('cleanNullValues', () => {
    it('should convert all null values in an object to undefined', () => {
      const obj = { a: 1, b: null, c: 'string', d: null };
      const cleaned = cleanNullValues(obj);
      expect(cleaned.a).toBe(1);
      expect(cleaned.b).toBeUndefined();
      expect(cleaned.c).toBe('string');
      expect(cleaned.d).toBeUndefined();
    });
  });

  describe('prepareForLdkit', () => {
    it('should remove undefined values from an object', () => {
      const obj = { a: 1, b: undefined, c: 'string' };
      const prepared = prepareForLdkit(obj);
      expect(prepared).toEqual({ a: 1, c: 'string' });
    });

    it('should not remove null values', () => {
      const obj = { a: 1, b: null, c: 'string' };
      const prepared = prepareForLdkit(obj);
      expect(prepared).toEqual({ a: 1, b: null, c: 'string' });
    });
  });

  describe('dateToIsoString', () => {
    it('should convert a Date object to an ISO string', () => {
      const date = new Date();
      expect(dateToIsoString(date)).toBe(date.toISOString());
    });

    it('should not change other values', () => {
      expect(dateToIsoString('string')).toBe('string');
      expect(dateToIsoString(null)).toBeNull();
      expect(dateToIsoString(undefined)).toBeUndefined();
    });
  });

  describe('stringToDate', () => {
    it('should convert an ISO string to a Date object', () => {
      const date = new Date();
      expect(stringToDate(date.toISOString())).toEqual(date);
    });

    it('should not change other values', () => {
      const date = new Date();
      expect(stringToDate(date)).toBe(date);
      expect(stringToDate(null)).toBeNull();
      expect(stringToDate(undefined)).toBeUndefined();
    });
  });

  describe('normalizeDatesForApi', () => {
    it('should convert all date fields in an object to ISO strings', () => {
      const date = new Date();
      const obj = { a: 1, dateCreated: date, lastUpdated: date };
      const normalized = normalizeDatesForApi(obj);
      expect(normalized.a).toBe(1);
      expect(normalized.dateCreated).toBe(date.toISOString());
      expect(normalized.lastUpdated).toBe(date.toISOString());
    });
  });

  describe('normalizeDatesForLdkit', () => {
    it('should convert all date fields in an object to Date objects', () => {
      const date = new Date();
      const obj = { a: 1, dateCreated: date.toISOString(), lastUpdated: date.toISOString() };
      const normalized = normalizeDatesForLdkit(obj);
      expect(normalized.a).toBe(1);
      expect(normalized.dateCreated).toEqual(date);
      expect(normalized.lastUpdated).toEqual(date);
    });
  });
});
