import { describe, it, expect } from 'vitest';
import {
  queryversionSchema,
  querygroupversionSchema,
  argumentsetversionSchema,
  ruleversionSchema,
  datablockversionSchema,
  rulesetversionSchema,
} from '@sparql-query-lib/contracts/schema';
import {
  patchQueryVersionForQuerySchema,
  patchQueryGroupVersionForGroupSchema,
} from '@sparql-query-lib/contracts/schema';

describe('immutable field exposure in schemas', () => {
  it('entity schemas expose immutable flag for all version types', () => {
    expect(queryversionSchema.properties).toHaveProperty('immutable');
    expect(querygroupversionSchema.properties).toHaveProperty('immutable');
    expect(ruleversionSchema.properties).toHaveProperty('immutable');
    expect(datablockversionSchema.properties).toHaveProperty('immutable');
    expect(rulesetversionSchema.properties).toHaveProperty('immutable');
  });

  it('argument set versions no longer carry the flag: frozen on create is the only state (#210)', () => {
    expect(argumentsetversionSchema.properties).not.toHaveProperty('immutable');
  });

  it('route patch schemas include immutable flag for query and query-group versions', () => {
    const queryProps = (patchQueryVersionForQuerySchema.body as any).properties;
    const groupProps = (patchQueryGroupVersionForGroupSchema.body as any).properties.queryGroupVersion.properties;
    expect(queryProps).toHaveProperty('immutable');
    expect(groupProps).toHaveProperty('immutable');
  });
});
