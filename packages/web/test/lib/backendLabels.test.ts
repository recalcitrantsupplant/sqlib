import { describe, expect, it } from 'vitest';
import { backendDisplayName, UNAVAILABLE_BACKEND_LABEL } from '../../src/lib/backendLabels';

const backends = [{ id: 'urn:sqlib:backend:rail', name: 'Rail store' }];

describe('backendDisplayName', () => {
  it('names a backend the list holds', () => {
    expect(backendDisplayName('urn:sqlib:backend:rail', backends, true)).toBe('Rail store');
  });

  it('hides the id of a backend the loaded list lacks', () => {
    expect(backendDisplayName('urn:sqlib:backend:hidden', backends, true)).toBe(UNAVAILABLE_BACKEND_LABEL);
    expect(backendDisplayName('urn:sqlib:backend:hidden', [], true)).toBe(UNAVAILABLE_BACKEND_LABEL);
  });

  it('keeps the id before the list has loaded', () => {
    expect(backendDisplayName('urn:sqlib:browser-backend:x', [], false)).toBe('urn:sqlib:browser-backend:x');
  });
});
