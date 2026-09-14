/**
 * The store behind "the last execution error the user saw" (#128 item 2).
 *
 * Its whole reason to be keyed is here: an unkeyed last-error outlives the
 * thing that failed, and the assistant would be told about an error belonging
 * to a query the user closed three clicks ago.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useLastExecutionError } from '@/composables/useLastExecutionError';

describe('useLastExecutionError', () => {
  beforeEach(() => {
    useLastExecutionError().clear();
  });

  it('has nothing to report before anything has run', () => {
    const { lastError, errorFor } = useLastExecutionError();
    expect(lastError.value).toBeNull();
    expect(errorFor('urn:q:1')).toBeNull();
  });

  it('reports the error of the entity that failed', () => {
    const { report, errorFor } = useLastExecutionError();
    report('urn:q:1', 'Backend refused: 400');
    expect(errorFor('urn:q:1')).toBe('Backend refused: 400');
  });

  it('does not attribute one entity’s error to another', () => {
    const { report, errorFor } = useLastExecutionError();
    report('urn:q:1', 'Backend refused: 400');
    expect(errorFor('urn:q:2')).toBeNull();
    expect(errorFor(null)).toBeNull();
  });

  it('clears when the same entity runs again', () => {
    const { report, errorFor } = useLastExecutionError();
    report('urn:q:1', 'Backend refused: 400');
    report('urn:q:1', null);
    expect(errorFor('urn:q:1')).toBeNull();
  });

  it('leaves an error standing when a different entity succeeds', () => {
    const { report, errorFor } = useLastExecutionError();
    report('urn:q:1', 'Backend refused: 400');
    report('urn:q:2', null);
    expect(errorFor('urn:q:1')).toBe('Backend refused: 400');
  });

  it('keeps the most recent failure, not the first', () => {
    const { report, errorFor } = useLastExecutionError();
    report('urn:q:1', 'first');
    report('urn:q:2', 'second');
    expect(errorFor('urn:q:2')).toBe('second');
    expect(errorFor('urn:q:1')).toBeNull();
  });

  it('is one store, so a second caller sees what the first reported', () => {
    useLastExecutionError().report('urn:q:1', 'Backend refused: 400');
    expect(useLastExecutionError().errorFor('urn:q:1')).toBe('Backend refused: 400');
  });
});
