import { describe, expect, it } from 'vitest';
import { environmentAccessOf, modesOfEnvironmentAccess } from '@/composables/useLibraryGrants';

describe('environment access levels', () => {
  it('reads promote over execute', () => {
    expect(environmentAccessOf(['execute', 'promote'])).toBe('promote');
    expect(environmentAccessOf(['promote'])).toBe('promote');
    expect(environmentAccessOf(['execute'])).toBe('run');
    expect(environmentAccessOf([])).toBe('none');
  });

  it('writes Promote as run and promote', () => {
    expect(modesOfEnvironmentAccess('promote')).toEqual(['execute', 'promote']);
    expect(modesOfEnvironmentAccess('run')).toEqual(['execute']);
    expect(modesOfEnvironmentAccess('none')).toEqual([]);
  });
});
