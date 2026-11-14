/**
 * When an entity was made and last changed, and by whom, in the shape the
 * Details panel takes as props (`EntityDetailsPanel.vue`).
 *
 * `createdBy` and `modifiedBy` are principal IRIs that the server stamps
 * (`dct:creator`, `sqlib:modifiedBy`). They are absent on entities saved
 * before the server recorded them, and on every write made with auth off.
 */
export interface EntityStamps {
  createdAt: string | null;
  createdBy: string | null;
  modifiedAt: string | null;
  modifiedBy: string | null;
}

export const NO_STAMPS: EntityStamps = Object.freeze({
  createdAt: null,
  createdBy: null,
  modifiedAt: null,
  modifiedBy: null,
}) as EntityStamps;

export function stampsOf(entity: {
  dateCreated?: string | null;
  dateModified?: string | null;
  createdBy?: string | null;
  modifiedBy?: string | null;
} | null | undefined): EntityStamps {
  if (!entity) return NO_STAMPS;
  return {
    createdAt: entity.dateCreated ?? null,
    createdBy: entity.createdBy ?? null,
    modifiedAt: entity.dateModified ?? null,
    modifiedBy: entity.modifiedBy ?? null,
  };
}
