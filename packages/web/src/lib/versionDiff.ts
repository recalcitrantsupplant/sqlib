/**
 * What a Diff button compares, decided from what is on screen. One rule for
 * every versioned editor:
 *
 * - edits: the version they were made on → the draft;
 * - no edits, reading an older version: that version → current;
 * - no edits, reading current: the version before it → current;
 * - one version and no edits: nothing (the button is disabled and says so).
 */

export const DRAFT_SIDE = '__draft__';

export interface DiffPlanSide {
  /** A version number, or null for the draft. */
  version: number | null;
  draft: boolean;
  label: string;
}

export interface DiffPlan {
  left: DiffPlanSide;
  right: DiffPlanSide;
}

export const NOTHING_TO_DIFF = 'Nothing to diff against';

export function versionDiffLabel(version: number | null, current: number | null): string {
  if (version === null) return 'Draft';
  return `v${version}${version === current ? ' (current)' : ''}`;
}

export function planVersionDiff(input: {
  hasEdits: boolean;
  /** The version on screen (what the draft, if any, was made on). */
  open: number | null;
  current: number | null;
  versions: number[];
}): DiffPlan | null {
  const { hasEdits, open, current, versions } = input;
  const side = (version: number | null): DiffPlanSide => ({
    version,
    draft: version === null,
    label: versionDiffLabel(version, current),
  });
  if (hasEdits && open !== null) return { left: side(open), right: side(null) };
  if (current === null) return null;
  if (open !== null && open !== current) return { left: side(open), right: side(current) };
  const previous = versions.filter((v) => v < current).sort((a, b) => b - a)[0];
  if (previous === undefined) return null;
  return { left: side(previous), right: side(current) };
}
