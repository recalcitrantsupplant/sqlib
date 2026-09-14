/**
 * What a PATCH is allowed to change on a version.
 *
 * A version is a snapshot: nothing edits one in place (issue #192; see
 * `docs/explanation/versioning-and-immutability.md`). The reason is
 * compatibility rather than tidiness — whether a group works with the query
 * versions it composes can only be established *for a given version*, and a
 * version that changes under a reference makes every such check provisional.
 *
 * The exception is annotations. There is a real line between a version's
 * *content* and what is said *about* it: changing `queryString` invalidates
 * every compatibility check that named the version, while correcting a comment
 * — "this is the one that fixed the timeout bug" — invalidates nothing. So the
 * allowlist is `comment`, plus the freeze transition itself for versions
 * created before freeze-on-create landed.
 *
 * Tags are deliberately not on it: no version schema carries tags, because
 * tagging targets the stable entity (`Query`, `QueryGroup`), not the version.
 * `canvasData` is deliberately not on it either — it rides in the group
 * version payload, so allowing it would mean dragging a node while viewing an
 * old version silently rewrites that version.
 */

/** The only fields a version PATCH may carry. Everything else is content. */
export const VERSION_ANNOTATION_FIELDS = ['comment', 'immutable'] as const;

export const VERSION_CONTENT_PATCH_ERROR = 'Version is immutable; create a new version instead.';
export const VERSION_UNFREEZE_ERROR = 'A version cannot be unfrozen; create a new version instead.';

export interface VersionPatchRejection {
  /** 409 for a snapshot the caller tried to edit; 400 for a field the backend owns. */
  status: 400 | 409;
  error: string;
  /** The offending fields, so a caller can see which part of the body was refused. */
  fields: string[];
}

export interface VersionPatchClassification {
  /** The subset of the body that may be applied. Empty when the body was all no-ops. */
  annotations: Record<string, unknown>;
  /** Non-null when the body asked for something a snapshot cannot do. */
  rejection: VersionPatchRejection | null;
}

/**
 * Keys the backend owns. Patching one is not an attempt to edit the snapshot
 * but to renumber or re-parent it, so it gets its own 400 rather than the 409
 * about immutability — the caller has made a different mistake.
 */
const SYSTEM_KEYS = new Set(['id', '$id', '@type', 'version', 'isPartOf']);

/**
 * Split a PATCH body into the annotations it may apply and the content it may not.
 *
 * `ignore` names keys that are neither content nor annotation for this route —
 * request-shaping flags rather than parts of the stored version.
 */
export function classifyVersionPatch(
  body: Record<string, unknown> | null | undefined,
  options: { ignore?: readonly string[] } = {}
): VersionPatchClassification {
  const annotations: Record<string, unknown> = {};
  const contentFields: string[] = [];
  const ignore = new Set(options.ignore ?? []);

  const systemFields: string[] = [];

  for (const [key, value] of Object.entries(body ?? {})) {
    if (value === undefined) continue;
    if (ignore.has(key)) continue;

    if (SYSTEM_KEYS.has(key)) {
      systemFields.push(key);
      continue;
    }

    if (key === 'comment') {
      annotations.comment = value;
      continue;
    }

    if (key === 'immutable') {
      // false → true is the freeze transition, which is the one write that
      // makes a version *more* of a snapshot. The reverse would undo the
      // guarantee every reference to the version relies on.
      if (value === false || value === 'false') {
        return { annotations: {}, rejection: { status: 409, error: VERSION_UNFREEZE_ERROR, fields: ['immutable'] } };
      }
      annotations.immutable = true;
      continue;
    }

    contentFields.push(key);
  }

  if (systemFields.length > 0) {
    const sorted = systemFields.sort();
    return {
      annotations: {},
      rejection: {
        status: 400,
        error: `Cannot update system field '${sorted[0]}'. This field is controlled by the backend.`,
        fields: sorted,
      },
    };
  }

  if (contentFields.length > 0) {
    return {
      annotations: {},
      rejection: { status: 409, error: VERSION_CONTENT_PATCH_ERROR, fields: contentFields.sort() },
    };
  }

  return { annotations, rejection: null };
}
