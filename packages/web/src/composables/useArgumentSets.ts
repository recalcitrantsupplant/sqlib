/**
 * Argument sets for a query or group, as versioned entities.
 *
 * The shape here follows the query itself: a set has a **scratch** life and
 * **saved** versions, and any of them can execute. There is no freeze and
 * no pin, because scratch-and-versions already says everything they said — a
 * saved version is immutable by definition, and a draft is yours until you
 * save it. What replaced them is one choice, `runWith`: the draft, or a
 * saved version, and that is what runs.
 *
 * Three states, and every screen state is one of them:
 *
 * | selection        | body comes from            | runWith offers          |
 * | ---------------- | -------------------------- | ----------------------- |
 * | none             | nothing                    | —                       |
 * | scratch set      | the browser-local record   | Draft only              |
 * | saved set    | the local draft if there is | Draft (if any) + vN…v1  |
 * |                  | one, else the chosen version |                        |
 *
 * Values live in `useArgumentSetDrafts` while unsaved and on the server
 * once saved; this composable is the seam, and it is the only place that
 * knows which of the two the panel is currently reading.
 */

import { ref, watch, computed, type Ref } from 'vue'
import type {
  ArgumentSetDetail,
  ArgumentSetInput,
  ArgumentSetVersionInput,
  ArgumentSetVersionDetail,
  ArgumentTupleBinding,
  ArgumentScalarBinding,
  ArgumentGraphBinding,
  SparqlBinding,
  ExecutionArgument,
} from '../types/argument-sets'
import { useApiClient } from './useApiClient'
import {
  useArgumentSetDrafts,
  newScratchId,
  type ArgumentSetDraft,
} from './useArgumentSetDrafts'
import { useTupleSetsStore } from './useTupleSetsStore'
import { bareVariable, pruneUndef } from '../lib/argumentSignature'
import { pinBindings, referenceKey, referencesOf } from '../lib/tupleSetReferences'
import { readTupleDocument } from '../types/tuple-sets'

/** What the "Run with" control is pointing at. */
export type RunTarget = { kind: 'draft' } | { kind: 'version'; versionId: string }

export type ArgumentSetSelection =
  | { kind: 'none' }
  | { kind: 'scratch'; id: string }
  | { kind: 'set'; id: string }

const DRAFT_TARGET: RunTarget = { kind: 'draft' }

export function useArgumentSets(
  targetId: Ref<string | null>,
  scope: 'query' | 'queryGroup' = 'query',
  /**
   * The library to also list sets from, so the switcher can offer the ones made
   * elsewhere in it.
   *
   * Passed in rather than read from `useActiveLibrary`, which would pull a
   * store into every consumer of this composable. A getter rather than a ref so
   * a screen can pass state it declares further down its own setup — this is
   * called early, and a `const` read before its declaration is a runtime error
   * rather than a type one. A caller that omits it gets the target-scoped list
   * this always returned.
   */
  libraryId?: () => string | null,
) {
  const apiClient = useApiClient()
  const local = useArgumentSetDrafts()
  const tupleSets = useTupleSetsStore()

  // ========================================================================
  // Core state
  // ========================================================================

  const argumentSets = ref<ArgumentSetDetail[]>([])
  const selection = ref<ArgumentSetSelection>({ kind: 'none' })
  const currentSet = ref<ArgumentSetDetail | null>(null)
  const versions = ref<ArgumentSetVersionDetail[]>([])
  /** Which saved version the body is showing, when no draft is open. */
  const selectedVersionId = ref<string | null>(null)
  const runTarget = ref<RunTarget>(DRAFT_TARGET)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const selectedSetId = computed(() => (selection.value.kind === 'set' ? selection.value.id : null))
  const scratchId = computed(() => (selection.value.kind === 'scratch' ? selection.value.id : null))

  /**
   * The browser-local record backing the current selection, if there is one.
   *
   * For a scratch set that is the set. For a saved set it is the draft —
   * absent until the first edit, which is what makes "clean" a real state
   * rather than a draft that happens to match.
   */
  const localRecord = computed<ArgumentSetDraft | null>(() => {
    if (selection.value.kind === 'scratch') return local.get(selection.value.id)
    if (selection.value.kind === 'set') return local.draftFor(selection.value.id)
    return null
  })

  const hasDraft = computed(() => localRecord.value !== null)
  const isScratch = computed(() => selection.value.kind === 'scratch')
  const editCount = computed(() => localRecord.value?.edits ?? 0)
  const draftSavedAt = computed(() => localRecord.value?.updatedAt ?? null)

  const currentVersion = computed(() => currentSet.value?.currentVersion ?? null)
  const currentVersionId = computed(
    () => currentVersion.value?.id ?? currentSet.value?.currentVersionId ?? null,
  )
  const selectedVersion = computed(
    () => versions.value.find((v) => v.id === selectedVersionId.value) ?? currentVersion.value,
  )

  /** `v3`, `Draft`, or `Scratch` — the badge beside the name in the header. */
  const stateLabel = computed(() => {
    if (selection.value.kind === 'none') return ''
    if (selection.value.kind === 'scratch') return 'Scratch'
    if (hasDraft.value && runTarget.value.kind === 'draft') return 'Draft'
    return selectedVersion.value ? `v${selectedVersion.value.version}` : ''
  })

  /** Versions newest first — the order the switcher and Run with both use. */
  const versionsNewestFirst = computed(() =>
    [...versions.value].sort((a, b) => b.version - a.version),
  )

  const nextVersionNumber = computed(() => {
    const highest = versions.value.reduce((max, v) => Math.max(max, v.version), 0)
    return highest + 1
  })

  // ========================================================================
  // The body the panel edits
  // ========================================================================

  const name = ref('')
  const description = ref('')
  const tupleBindings = ref<ArgumentTupleBinding[]>([])
  const scalarBindings = ref<ArgumentScalarBinding[]>([])
  /**
   * The graphs this set hands to a query group, in order.
   *
   * No port names: an argument set carries payload and the group routes it, so
   * slot N here fills the Nth data input the start node declares. The group
   * screen's per-port picker writes straight into this, which is what makes a
   * group run one pinned object rather than a set plus a loose graph.
   */
  const graphBindings = ref<ArgumentGraphBinding[]>([])

  /** Set while the composable is writing the body itself, so edits do not echo. */
  const hydrating = ref(false)

  function hydrate(from: {
    name?: string
    description?: string | null
    tupleBindings: ArgumentTupleBinding[]
    scalarBindings: ArgumentScalarBinding[]
    graphBindings?: ArgumentGraphBinding[]
  }) {
    hydrating.value = true
    if (typeof from.name === 'string') name.value = from.name
    description.value = from.description ?? ''
    tupleBindings.value = clone(from.tupleBindings)
    scalarBindings.value = clone(from.scalarBindings)
    graphBindings.value = clone(from.graphBindings ?? [])
    // Cleared on a microtask: hydration sets refs whose watchers have not run
    // yet, and they run before this resolves.
    void Promise.resolve().then(() => {
      hydrating.value = false
    })
  }

  function clearBody() {
    hydrating.value = true
    name.value = ''
    description.value = ''
    tupleBindings.value = []
    scalarBindings.value = []
    graphBindings.value = []
    void Promise.resolve().then(() => {
      hydrating.value = false
    })
  }

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value ?? null)) as T
  }

  // ========================================================================
  // Loading and selection
  // ========================================================================

  /**
   * Every set this callable could run with, not only the ones made on it.
   *
   * Scope has always been provenance rather than a fence — which is why the
   * switcher computes a fits/partial/mismatch verdict against the open callable
   * at all. Until now it listed only sets whose `targetEntity` was this one, so
   * the verdict could never say anything but "fits": there was nothing else to
   * judge. This is the "elsewhere in the library" listing the query arguments
   * design wanted and could not have before `GET /argument-sets?libraryId=`.
   *
   * The library-wide read is best-effort: if it fails, the target-scoped list
   * still stands, because losing the sets made on this very screen would be a
   * worse outcome than not offering the others.
   */
  async function loadArgumentSets(library: string | null = libraryId?.() ?? null) {
    if (!targetId.value) {
      argumentSets.value = []
      return
    }
    isLoading.value = true
    error.value = null
    try {
      const own = await apiClient.listArgumentSets(targetId.value, scope)
      if (!library) {
        argumentSets.value = own
        return
      }
      let elsewhere: ArgumentSetDetail[] = []
      try {
        elsewhere = await apiClient.listLibraryArgumentSets(library) as ArgumentSetDetail[]
      } catch (err) {
        console.error('[useArgumentSets] Library listing failed; showing this target\'s sets only:', err)
      }
      const seen = new Set(own.map((set) => set.id))
      argumentSets.value = [...own, ...elsewhere.filter((set) => !seen.has(set.id))]
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load argument sets'
      console.error('[useArgumentSets] Load error:', err)
    } finally {
      isLoading.value = false
    }
  }

  async function loadVersions(setId: string) {
    try {
      const result = await apiClient.listArgumentSetVersions(setId)
      versions.value = Array.isArray(result) ? result : (result as { data?: ArgumentSetVersionDetail[] }).data ?? []
    } catch (err) {
      console.error('[useArgumentSets] Load versions error:', err)
      versions.value = []
    }
  }

  /** Open a saved set: its draft if this browser holds one, else its current version. */
  async function selectSet(setId: string | null) {
    if (!setId) {
      clearSelection()
      return
    }

    isLoading.value = true
    error.value = null
    try {
      const result = await apiClient.getArgumentSet(setId)
      selection.value = { kind: 'set', id: setId }
      currentSet.value = result.data
      await loadVersions(setId)
      selectedVersionId.value = currentVersionId.value

      const draft = local.draftFor(setId)
      if (draft) {
        runTarget.value = DRAFT_TARGET
        hydrate(draft)
      } else {
        runTarget.value = currentVersionId.value
          ? { kind: 'version', versionId: currentVersionId.value }
          : DRAFT_TARGET
        hydrate({
          name: result.data.name,
          description: result.data.description ?? '',
          tupleBindings: result.data.currentVersion?.tupleBindings ?? result.data.tupleBindings,
          scalarBindings: result.data.currentVersion?.scalarBindings ?? result.data.scalarBindings,
          graphBindings: result.data.currentVersion?.graphBindings ?? result.data.graphBindings,
        })
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load argument set'
      console.error('[useArgumentSets] Select error:', err)
    } finally {
      isLoading.value = false
    }
  }

  function selectScratch(id: string) {
    const record = local.get(id)
    if (!record) return
    selection.value = { kind: 'scratch', id }
    currentSet.value = null
    versions.value = []
    selectedVersionId.value = null
    runTarget.value = DRAFT_TARGET
    hydrate(record)
  }

  function clearSelection() {
    selection.value = { kind: 'none' }
    currentSet.value = null
    versions.value = []
    selectedVersionId.value = null
    runTarget.value = DRAFT_TARGET
    clearBody()
  }

  /**
   * Show a saved version in the body.
   *
   * Only reachable when no draft is open — with edits in flight, switching the
   * body underneath them is how you lose them. The switcher hides the versions
   * for a dirty set for the same reason, and offers Discard instead.
   */
  function selectVersion(versionId: string | null) {
    if (!versionId || hasDraft.value) return
    const version = versions.value.find((v) => v.id === versionId)
    if (!version) return
    selectedVersionId.value = versionId
    runTarget.value = { kind: 'version', versionId }
    hydrate({
      tupleBindings: version.tupleBindings,
      scalarBindings: version.scalarBindings,
      graphBindings: version.graphBindings,
    })
  }

  /** Point "Run with" somewhere without moving the body. */
  function runWith(target: RunTarget) {
    if (target.kind === 'draft') {
      runTarget.value = DRAFT_TARGET
      const record = localRecord.value
      if (record) hydrate(record)
      return
    }
    selectVersion(target.versionId)
  }

  /** A new, empty scratch set — the switcher's "New scratch set". */
  function createScratch(suggestedName?: string): string | null {
    if (!targetId.value) return null
    const id = newScratchId()
    const existing = local.scratchFor(targetId.value).length
    local.save({
      id,
      kind: 'scratch',
      scope,
      targetId: targetId.value,
      name: suggestedName ?? `Untitled set ${existing + 1}`,
      description: null,
      basedOn: null,
      basedOnVersion: null,
      tupleBindings: [],
      scalarBindings: [],
      graphBindings: [],
      edits: 0,
    })
    selectScratch(id)
    return id
  }

  // ========================================================================
  // Persistence of the unsaved body
  // ========================================================================

  /**
   * Write the body to the browser-local store.
   *
   * On a saved set with no draft yet, this is where the draft is born —
   * so the first keystroke on a clean set creates it, and nothing before that
   * does. Called from the panel's edit watcher, debounced there.
   */
  function persistLocal() {
    if (hydrating.value) return
    if (!targetId.value) return

    if (selection.value.kind === 'scratch') {
      const record = local.get(selection.value.id)
      // Gone from under us — discarded in another tab. Writing it back would
      // resurrect a record the user chose to throw away.
      if (!record) return
      local.save({
        ...record,
        name: name.value,
        description: description.value || null,
        tupleBindings: clone(tupleBindings.value),
        scalarBindings: clone(scalarBindings.value),
        graphBindings: clone(graphBindings.value),
      })
      return
    }

    if (selection.value.kind !== 'set') return
    const setId = selection.value.id
    const existing = local.draftFor(setId)
    local.save({
      id: existing?.id ?? `${setId}::draft`,
      kind: 'draft',
      scope,
      targetId: targetId.value,
      name: name.value || currentSet.value?.name || '',
      description: description.value || null,
      basedOn: setId,
      basedOnVersion: selectedVersion.value?.version ?? null,
      tupleBindings: clone(tupleBindings.value),
      scalarBindings: clone(scalarBindings.value),
      graphBindings: clone(graphBindings.value),
      edits: existing?.edits,
    })
    // Editing is running what you edited; nothing else would be honest.
    runTarget.value = DRAFT_TARGET
  }

  /** Rename without touching values — the ⋮ menu's Rename. */
  function rename(next: string) {
    name.value = next
    persistLocal()
  }

  // ========================================================================
  // Save / discard
  // ========================================================================

  /**
   * Save the draft as the next version.
   *
   * Scratch sets create the set and its v1; drafts on a saved set create
   * vN+1. Neither says anything about immutability: a version is frozen on
   * create, like every other version in the library. This used to follow the
   * create with a PATCH to freeze what it had just made, because the server
   * created versions mutable and then refused to execute them — a two-call
   * save where the second call was the one that made the set runnable.
   */
  async function save(): Promise<boolean> {
    if (!targetId.value) {
      error.value = 'No target selected'
      return false
    }
    const trimmed = name.value.trim()
    if (!trimmed) {
      error.value = 'Name is required'
      return false
    }

    isLoading.value = true
    error.value = null
    try {
      /*
       * The save is the pin. A reference floats while it is a draft — a run
       * reads whatever the tuple set holds — and this is where it stops
       * floating, so a saved set keeps meaning what it meant however the tuple
       * set moves afterwards.
       *
       * A reference that cannot be resolved fails the save rather than being
       * dropped from it: a set saved without one of its sources runs and
       * returns the wrong rows, which is exactly what references exist to stop.
       */
      await warmReferences()
      const pinned = pinBindings(tupleBindings.value, tupleSets.currentVersionIdOf)
      if (pinned.unresolved.length > 0) {
        error.value = 'A linked tuple set has no saved version to pin to. '
          + 'Save the tuple set, or unlink it, then try again.'
        return false
      }

      /*
       * `position` is stamped from the order on screen rather than carried on
       * each binding: order is what a group routes against, so one array is
       * the single source of truth for it.
       */
      const body = {
        tupleBindings: clone(pinned.bindings).map((binding, position) => ({ ...binding, position })),
        scalarBindings: scalarBindings.value.length > 0 ? clone(scalarBindings.value) : undefined,
        graphBindings: graphBindings.value.length > 0
          ? clone(graphBindings.value).map((binding, position) => ({ ...binding, position }))
          : undefined,
      }

      if (selection.value.kind === 'scratch') {
        const input: ArgumentSetInput = {
          name: trimmed,
          description: description.value.trim() || undefined,
          ...body,
        }
        const created = await apiClient.createArgumentSet(targetId.value, input, scope)
        local.remove(selection.value.id)
        await loadArgumentSets()
        await selectSet(created.data.id)
        return true
      }

      if (selection.value.kind !== 'set') {
        error.value = 'Nothing to save'
        return false
      }

      const setId = selection.value.id
      const versionInput: ArgumentSetVersionInput = { ...body }
      await apiClient.createArgumentSetVersion(setId, versionInput)
      const draft = local.draftFor(setId)
      if (draft) local.remove(draft.id)
      await loadArgumentSets()
      await selectSet(setId)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save argument set'
      console.error('[useArgumentSets] Save error:', err)
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Throw the unsaved body away.
   *
   * A draft falls back to the saved set; a scratch set has nothing behind
   * it, so discarding is deleting.
   */
  async function discard(): Promise<void> {
    const record = localRecord.value
    if (!record) return
    local.remove(record.id)
    if (selection.value.kind === 'scratch') {
      clearSelection()
      return
    }
    if (selection.value.kind === 'set') await selectSet(selection.value.id)
  }

  async function deleteSet(setId: string): Promise<boolean> {
    isLoading.value = true
    error.value = null
    try {
      const set = argumentSets.value.find((s) => s.id === setId)
      await apiClient.deleteArgumentSet(setId, { ifMatch: set?.dateModified ?? null })
      const draft = local.draftFor(setId)
      if (draft) local.remove(draft.id)
      if (selectedSetId.value === setId) clearSelection()
      await loadArgumentSets()
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete argument set'
      console.error('[useArgumentSets] Delete error:', err)
      return false
    } finally {
      isLoading.value = false
    }
  }

  // ========================================================================
  // Execution
  // ========================================================================

  /**
   * The version id to execute, or null when the run target is the draft.
   *
   * Null is not "no arguments": it means the values are not on the server yet
   * and the caller must send them inline. `inlineExecutionPayload` is that.
   */
  const executionArgumentSetId = computed(() => {
    if (runTarget.value.kind === 'version') return runTarget.value.versionId
    return null
  })

  /** The draft's values, in the shape `POST /execute` takes inline. */
  function inlineExecutionPayload(): {
    arguments?: ExecutionArgument[]
    limits?: { name: string; value: number }[]
    offsets?: { name: string; value: number }[]
  } | null {
    if (runTarget.value.kind !== 'draft') return null
    return visibleValuesPayload()
  }

  /**
   * The values the panel is showing, in the same shape — whatever runs them.
   *
   * `inlineExecutionPayload` refuses when the run target is a saved
   * version, because `/execute` should name that version and let the server
   * export it. The ad-hoc path has no such option: a query with unsaved
   * edits runs as text through `POST /sparql`, which knows no version ids, so
   * the values on screen are the only ones it can run. Same body either way —
   * a version selected here is hydrated into these refs.
   */
  function visibleValuesPayload(): {
    arguments?: ExecutionArgument[]
    limits?: { name: string; value: number }[]
    offsets?: { name: string; value: number }[]
  } | null {
    const args: ExecutionArgument[] = []
    for (const binding of tupleBindings.value) {
      const vars = binding.variables ?? binding.tupleSignature.split('|')
      const bindings = [
        ...binding.rows.map((row) => pruneUndef(row.values as SparqlBinding)),
        // Referenced sets union with the inline rows, which is what the server
        // does for a saved set (`ArgumentSetService.rowsFromTupleSetVersions`).
        // Doing it here as well is what makes a draft's references count: this
        // path sends values, not ids, so a reference the browser did not
        // resolve would simply not be part of the run.
        ...referenceRows(binding, vars),
      ]
        // A row with every cell blank binds nothing at all; sending it would
        // be a row of UNDEFs, which is not what an empty row means.
        .filter((values) => Object.keys(values).length > 0)
      // An input with no rows is left open, not matched against the empty set —
      // those are opposites in the VALUES contract.
      if (vars.length === 0 || bindings.length === 0) continue
      args.push({ head: { vars }, arguments: { bindings } })
    }

    const limits = scalarBindings.value
      .filter((s) => s.parameterKind === 'limit')
      .map((s) => ({ name: s.parameterName, value: s.numericValue }))
    const offsets = scalarBindings.value
      .filter((s) => s.parameterKind === 'offset')
      .map((s) => ({ name: s.parameterName, value: s.numericValue }))

    if (args.length === 0 && limits.length === 0 && offsets.length === 0) return null
    const payload: ReturnType<typeof visibleValuesPayload> = {}
    if (args.length > 0) payload.arguments = args
    if (limits.length > 0) payload.limits = limits
    if (offsets.length > 0) payload.offsets = offsets
    return payload
  }

  /**
   * The rows a clause's linked tuple sets contribute, right now.
   *
   * Read out of the tuple-set store's caches, which `warmReferences` below
   * keeps filled for whatever the body currently holds. A reference the store
   * cannot answer for contributes nothing rather than blocking the run — the
   * same call the server makes for a version that has gone missing, and the
   * same reason: refusing to execute an otherwise valid set is the worse answer.
   *
   * A floating reference reads the set's *current* version, so a draft is live;
   * a pinned one reads the version it names, so a saved set is reproducible.
   * That is the whole of "pin on save, float on draft" on this side of the wire.
   *
   * Rows are projected onto the clause's variables and an empty projection is
   * dropped, matching `rowsFromTupleSetVersions`: a row keyed only by columns
   * this clause does not declare would otherwise arrive as all-UNDEF, which
   * matches everything instead of contributing nothing.
   */
  function referenceRows(binding: ArgumentTupleBinding, vars: string[]): SparqlBinding[] {
    const names = vars.map(bareVariable)
    const wanted = new Set(names)
    const rows: SparqlBinding[] = []

    for (const reference of referencesOf(binding)) {
      const versionId = reference.versionId
        ?? (reference.tupleSetId ? tupleSets.currentVersionIdOf(reference.tupleSetId) : null)
      if (!versionId) continue
      const version = tupleSets.tupleSetVersionById(versionId)?.version
      if (!version) continue

      for (const row of readTupleDocument(version.contentString).rows) {
        const projected: SparqlBinding = {}
        for (const [name, term] of Object.entries(row)) {
          if (wanted.has(name)) projected[name] = { ...term }
        }
        if (Object.keys(projected).length > 0) rows.push(projected)
      }
    }
    return rows
  }

  /**
   * Keep the tuple-set caches filled for the references the body holds.
   *
   * `visibleValuesPayload` is synchronous and is called from run bars and the
   * assistant's tool surface, several of which have no argument panel mounted —
   * so the resolution cannot wait to be triggered by a component. The watcher
   * below is what makes reading the caches synchronously safe: the body
   * changing is the only way a new reference appears.
   */
  async function warmReferences(): Promise<void> {
    const references = tupleBindings.value.flatMap((binding) => referencesOf(binding))
    if (references.length === 0) return
    await tupleSets.resolveReferences(references, libraryId?.() ?? null)
  }

  // ========================================================================
  // Watchers
  // ========================================================================

  watch(
    targetId,
    (newId, oldId) => {
      if (newId === oldId) return
      argumentSets.value = []
      clearSelection()
      if (newId) void loadArgumentSets()
    },
    { immediate: true },
  )

  watch(
    () => tupleBindings.value.flatMap((binding) => referencesOf(binding).map(referenceKey)).join('|'),
    () => { void warmReferences() },
    { immediate: true },
  )

  return {
    // Core state
    argumentSets,
    selection,
    selectedSetId,
    scratchId,
    currentSet,
    versions,
    versionsNewestFirst,
    selectedVersionId,
    selectedVersion,
    currentVersion,
    currentVersionId,
    nextVersionNumber,
    runTarget,
    isLoading,
    error,

    // Unsaved state
    localRecord,
    hasDraft,
    isScratch,
    editCount,
    draftSavedAt,
    stateLabel,
    hydrating,

    // Body
    name,
    description,
    tupleBindings,
    scalarBindings,
    graphBindings,

    // Local scratch sets for this target, newest first
    scratchSets: computed(() => local.scratchFor(targetId.value)),

    // Actions
    loadArgumentSets,
    loadVersions,
    selectSet,
    selectScratch,
    selectVersion,
    clearSelection,
    createScratch,
    runWith,
    persistLocal,
    rename,
    save,
    discard,
    deleteSet,

    // Execution
    executionArgumentSetId,
    inlineExecutionPayload,
    visibleValuesPayload,
  }
}
