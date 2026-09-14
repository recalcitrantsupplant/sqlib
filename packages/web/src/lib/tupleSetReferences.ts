/**
 * References from an argument set's table to a tuple set, and the pin a save
 * puts on them.
 *
 * `ArgumentTupleBinding.tupleSetVersions` has been modelled and executed
 * server-side since tuple sets landed — `ArgumentSetService.exportRuntimePayload`
 * unions a referenced version's rows with the inline ones under the same
 * signature — while nothing in the UI could write it. The picker copied rows
 * instead, which was honest about storage and lost the association: a tuple set
 * that gained a v2 never reached the queries built from its v1.
 *
 * This module is the seam between the two shapes. The wire knows one field,
 * `tupleSetVersions: string[]`, always pinned. The editor knows
 * `tupleSetRefs`, which additionally holds the *set* a reference was attached
 * to and may carry no version at all — a floating reference, which is what a
 * draft holds until it is saved.
 *
 * **Pin on save, float on draft.**
 * A floating reference resolves to the set's current version, so a draft is
 * live; `pinBindings` is the one place that resolution happens, and it happens
 * exactly at save. Nothing here moves an existing pin: a reference that already
 * names a version keeps that version through every save until an author
 * re-points it.
 */
import type { ArgumentTupleBinding, TupleSetReference } from '../types/argument-sets'

/**
 * The wire shape of a table binding: what `POST /argument-sets` and
 * `POST /argument-sets/:id/v` accept, whose body schema is
 * `additionalProperties: false`. `tupleSetRefs` is an editor field and must not
 * reach it.
 */
export interface WireTupleBinding {
  id?: string
  tupleSignature: string
  variables: string[]
  rows: ArgumentTupleBinding['rows']
  tupleSetVersions?: string[]
}

/** Two references point at the same thing when both halves agree. */
export function sameReference(a: TupleSetReference, b: TupleSetReference): boolean {
  return (a.tupleSetId ?? null) === (b.tupleSetId ?? null)
    && (a.versionId ?? null) === (b.versionId ?? null)
}

/** A stable `v-for` key. Two distinct references never share one. */
export function referenceKey(reference: TupleSetReference): string {
  return `${reference.tupleSetId ?? ''}::${reference.versionId ?? ''}`
}

/** A reference with no version behind it takes whatever the set holds now. */
export function isFloating(reference: TupleSetReference): boolean {
  return !reference.versionId
}

/**
 * The references on a binding, however it arrived.
 *
 * `tupleSetRefs` wins where it is present, because it is the editor's own
 * record and knows the set. A binding straight off the server has only
 * `tupleSetVersions`, and each of those is a pinned reference whose set is not
 * yet known — recovering it is a lookup the store does, not something to invent
 * here.
 */
export function referencesOf(binding: Pick<ArgumentTupleBinding, 'tupleSetRefs' | 'tupleSetVersions'>): TupleSetReference[] {
  if (binding.tupleSetRefs) return binding.tupleSetRefs
  return (binding.tupleSetVersions ?? []).map((versionId) => ({ versionId }))
}

/**
 * Add a reference, unless the clause already has it.
 *
 * Attaching the same set twice would double every row it contributes, which is
 * a silently wrong result rather than a tidiness problem: `mergeArgumentSets`
 * concatenates sources sharing a signature and nothing downstream de-duplicates.
 */
export function withReference(
  binding: ArgumentTupleBinding,
  reference: TupleSetReference,
): ArgumentTupleBinding {
  const existing = referencesOf(binding)
  if (existing.some((held) => sameReference(held, reference))) return binding
  return { ...binding, tupleSetRefs: [...existing, reference] }
}

/** Drop one reference. The inline rows are untouched — they were never its. */
export function withoutReference(
  binding: ArgumentTupleBinding,
  reference: TupleSetReference,
): ArgumentTupleBinding {
  return {
    ...binding,
    tupleSetRefs: referencesOf(binding).filter((held) => !sameReference(held, reference)),
  }
}

/** Re-point one reference — the "newer version available" nudge's action. */
export function withRepinnedReference(
  binding: ArgumentTupleBinding,
  reference: TupleSetReference,
  versionId: string,
): ArgumentTupleBinding {
  return {
    ...binding,
    tupleSetRefs: referencesOf(binding).map((held) =>
      (sameReference(held, reference) ? { ...held, versionId } : held)),
  }
}

/** Where a floating reference resolves to. `null` for a set with no version. */
export type CurrentVersionOf = (tupleSetId: string) => string | null | undefined

export interface PinnedBindings {
  bindings: WireTupleBinding[]
  /**
   * References that could not be pinned — a floating one whose set has no
   * current version, or one carrying neither id.
   *
   * Returned rather than dropped. Saving a set that silently forgot one of its
   * sources produces a set that runs and returns the wrong rows, which is the
   * failure this whole reference model exists to prevent; the caller is
   * expected to refuse the save and say which set it could not resolve.
   */
  unresolved: TupleSetReference[]
}

/**
 * Collapse the editor's bindings into what the wire takes, pinning as it goes.
 *
 * Order is preserved and duplicates are collapsed, so two references that
 * resolve to the same version contribute their rows once.
 */
export function pinBindings(
  bindings: ArgumentTupleBinding[],
  currentVersionOf: CurrentVersionOf,
): PinnedBindings {
  const unresolved: TupleSetReference[] = []

  const pinned = bindings.map((binding) => {
    const versionIds: string[] = []
    for (const reference of referencesOf(binding)) {
      const versionId = reference.versionId
        ?? (reference.tupleSetId ? currentVersionOf(reference.tupleSetId) ?? null : null)
      if (!versionId) {
        unresolved.push(reference)
        continue
      }
      if (!versionIds.includes(versionId)) versionIds.push(versionId)
    }

    const wire: WireTupleBinding = {
      ...(binding.id ? { id: binding.id } : {}),
      tupleSignature: binding.tupleSignature,
      variables: binding.variables,
      rows: binding.rows,
      ...(versionIds.length ? { tupleSetVersions: versionIds } : {}),
    }
    return wire
  })

  return { bindings: pinned, unresolved }
}
