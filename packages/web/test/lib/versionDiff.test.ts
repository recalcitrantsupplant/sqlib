import { describe, expect, it } from 'vitest';
import { planVersionDiff } from '@/lib/versionDiff';

const labels = (plan: ReturnType<typeof planVersionDiff>) =>
  plan ? `${plan.left.label} → ${plan.right.label}` : null;

describe('planVersionDiff', () => {
  it('diffs edits against the version they were made on', () => {
    expect(labels(planVersionDiff({ hasEdits: true, open: 1, current: 2, versions: [1, 2] }))).toBe('v1 → Draft');
    expect(labels(planVersionDiff({ hasEdits: true, open: 2, current: 2, versions: [2] }))).toBe('v2 (current) → Draft');
  });

  it('diffs an older version on screen against current', () => {
    expect(labels(planVersionDiff({ hasEdits: false, open: 1, current: 3, versions: [1, 2, 3] })))
      .toBe('v1 → v3 (current)');
  });

  it('diffs current against the version before it', () => {
    expect(labels(planVersionDiff({ hasEdits: false, open: 3, current: 3, versions: [3, 1, 2] })))
      .toBe('v2 → v3 (current)');
  });

  it('has nothing to diff with one version and no edits', () => {
    expect(planVersionDiff({ hasEdits: false, open: 1, current: 1, versions: [1] })).toBeNull();
  });

  it('has no draft diff before anything is saved', () => {
    expect(planVersionDiff({ hasEdits: true, open: null, current: null, versions: [] })).toBeNull();
  });
});
