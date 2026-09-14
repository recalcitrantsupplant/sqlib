
import { DEFAULT_ALLOWED_PARAM_TYPES } from '../../src/constants/params.js';

describe('params', () => {
  it('should have the correct default allowed param types', () => {
    expect(DEFAULT_ALLOWED_PARAM_TYPES).toEqual(['uri', 'literal']);
  });
});
