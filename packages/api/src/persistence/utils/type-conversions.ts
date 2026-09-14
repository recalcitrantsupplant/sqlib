/**
 * Type conversion utilities to standardize null/undefined handling
 * between LDKit entities and application types
 */

/**
 * Convert null values to undefined for type compatibility
 * LDKit often returns null for optional fields, but our types expect undefined
 */
export function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

/**
 * Convert undefined values to null for LDKit operations
 * Some LDKit operations work better with null than undefined
 */
export function undefinedToNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/**
 * Clean an object by converting all null values to undefined
 * Useful for converting LDKit results to application types
 * Preserves required fields as-is to maintain type compatibility
 */
export function cleanNullValues<T extends Record<string, any>>(obj: T): T {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    cleaned[key] = nullToUndefined(value);
  }
  return cleaned as T;
}

/**
 * Prepare an object for LDKit operations by filtering out undefined values
 * but preserving required fields and null values
 */
export function prepareForLdkit<T extends Record<string, any>>(obj: T): T {
  const prepared: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Keep all values except undefined
    // LDKit can handle null values, but not undefined
    if (value !== undefined) {
      prepared[key] = value;
    } else if (key === '$id' || key === '@id') {
      // Always preserve ID fields even if undefined (shouldn't happen but safety)
      prepared[key] = value;
    }
  }
  return prepared as T;
}

/**
 * Convert a Date object or ISO string to ISO string
 * For use when sending data to APIs that expect string dates
 */
export function dateToIsoString(date: Date | string | null | undefined): string | null | undefined {
  if (date instanceof Date) {
    return date.toISOString();
  }
  return date;
}

/**
 * Convert an ISO string to Date object
 * For use when sending data to LDKit that expects Date objects
 */
export function stringToDate(dateStr: string | Date | null | undefined): Date | null | undefined {
  if (typeof dateStr === 'string' && dateStr.trim()) {
    return new Date(dateStr);
  }
  if (dateStr instanceof Date) {
    return dateStr;
  }
  return dateStr === null ? null : undefined;
}

/**
 * Normalize date fields in an object to ISO strings for API responses
 */
export function normalizeDatesForApi<T extends Record<string, any>>(obj: T): T {
  const normalized = { ...obj };
  for (const [key, value] of Object.entries(normalized)) {
    if (key.includes('date') || key.includes('Date')) {
      (normalized as Record<string, unknown>)[key] = dateToIsoString(value);
    }
  }
  return normalized;
}

/**
 * Normalize date fields in an object to Date objects for LDKit operations
 */
export function normalizeDatesForLdkit<T extends Record<string, any>>(obj: T): T {
  const normalized = { ...obj };
  for (const [key, value] of Object.entries(normalized)) {
    if (key.includes('date') || key.includes('Date')) {
      (normalized as Record<string, unknown>)[key] = stringToDate(value);
    }
  }
  return normalized;
}