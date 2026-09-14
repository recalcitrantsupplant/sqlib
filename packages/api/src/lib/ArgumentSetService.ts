import type { FastifyRequest } from 'fastify';
import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { requireLibraryMode, resolveOwningLibrary } from '../auth/enforce.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { parseTupleContent, readStoredTupleContent } from './tupleContent.js';
import { DataGraphContentError, resolveDataGraphInput } from './dataGraphInput.js';
import { orderByPosition, parameterKeysOf, tableParameterKey, type ParameterKey } from '@sparql-query-lib/types';
import type { LdkitArgumentSet } from '../persistence/schemas/ArgumentSetSchema.js';
import type { LdkitArgumentSetVersion } from '../persistence/schemas/ArgumentSetVersionSchema.js';
import type { LdkitArgumentTupleBinding } from '../persistence/schemas/ArgumentTupleBindingSchema.js';
import type { LdkitArgumentScalarBinding } from '../persistence/schemas/ArgumentScalarBindingSchema.js';
import type { LdkitArgumentGraphBinding } from '../persistence/schemas/ArgumentGraphBindingSchema.js';
import type { LdkitTupleSetVersion } from '../persistence/schemas/TupleSetVersionSchema.js';
import type { ArgumentSet as RuntimeArgumentSet, SparqlBinding, SparqlValue } from './query-chaining.js';

export type ArgumentScope = 'query' | 'queryGroup';

/**
 * A value inside a posted argument row.
 *
 * Deliberately not `SparqlValue`. `argumentSetBodySchema` declares `datatype`
 * as `nullable: true` and ajv honours `nullable`, so a client may send
 * `datatype: null`. `SparqlValue` models the W3C results format, which has no
 * such state, and `parseTupleContent` drops a falsy datatype on the way in.
 */
export interface ArgumentValuePayload {
  type: 'uri' | 'literal';
  value: string;
  datatype?: string | null;
  'xml:lang'?: string;
}

export type ArgumentBindingRowPayload = Record<string, ArgumentValuePayload | undefined>;

export interface ArgumentTupleBindingPayload {
  id?: string;
  /**
   * Its slot among the set's ordered inputs. Optional; unset, the position in
   * the submitted array is used. See `2026-09-07-payload-and-routing.md` §4.
   */
  position?: number;
  variables: string[];
  tupleSignature?: string;
  /** Pinned `TupleSetVersion` IRIs whose rows union with the inline ones. */
  tupleSetVersions?: string[];
  rows: {
    id?: string;
    position?: number;
    values: ArgumentBindingRowPayload;
  }[];
}

export interface ArgumentScalarBindingPayload {
  id?: string;
  parameterKind: 'limit' | 'offset';
  parameterName: string;
  numericValue: number;
  parameterIri?: string;
}

/**
 * One graph among a set's ordered inputs.
 *
 * Exactly one source: a pinned version, a floating parent id, or inline
 * content. Which start-node port it fills is the group's business, not this
 * payload's.
 */
export interface ArgumentGraphBindingPayload {
  id?: string;
  /** Its slot among the set's ordered inputs; unset, the submitted order. */
  position?: number;
  dataGraphVersionId?: string | null;
  contentString?: string | null;
  contentFormat?: string | null;
}

export interface ArgumentSetInput {
  name: string;
  description?: string;
  /* Optional: a set may fill only numbers, or only graph ports. */
  tupleBindings?: ArgumentTupleBindingPayload[];
  scalarBindings?: ArgumentScalarBindingPayload[];
  graphBindings?: ArgumentGraphBindingPayload[];
}

export interface ArgumentSetVersionInput {
  tupleBindings?: ArgumentTupleBindingPayload[];
  scalarBindings?: ArgumentScalarBindingPayload[];
  graphBindings?: ArgumentGraphBindingPayload[];
}

/**
 * The caller, for the checks a route guard cannot make.
 *
 * Optional throughout, and the same shape `materializeTupleSetVersionFromEtl`
 * and `materializeDataGraphVersionFromQuery` take: unit tests that drive the
 * service directly hold no request, and `disabled` mode's full-access context
 * makes every check below a no-op anyway.
 */
export interface ArgumentAuthScope {
  request: FastifyRequest;
}

/** What a set composed on the rail supplies, with no callable to derive from. */
export interface ArgumentSetStandaloneInput extends ArgumentSetInput {
  libraryId: string;
  /** Provenance, if it has any. A rail-composed set has none. */
  scope?: ArgumentScope | null;
  targetId?: string | null;
}

export interface ArgumentTupleBindingDetail extends ArgumentTupleBindingPayload {
  id: string;
  position: number;
  tupleSignature: string;
  rows: {
    id: string;
    position: number;
    // `SparqlBinding`, not the input payload type: stored content is already
    // normalised — a falsy datatype was dropped on the way in rather than
    // stored as null. This is what makes a detail directly executable.
    values: SparqlBinding;
  }[];
}

export interface ArgumentScalarBindingDetail extends ArgumentScalarBindingPayload {
  id: string;
}

export interface ArgumentGraphBindingDetail extends ArgumentGraphBindingPayload {
  id: string;
  position: number;
}

export interface ArgumentSetVersionDetail {
  id: string;
  isPartOf: string;
  version: number;
  tupleBindings: ArgumentTupleBindingDetail[];
  scalarBindings: ArgumentScalarBindingDetail[];
  graphBindings: ArgumentGraphBindingDetail[];
  dateCreated?: string;
  dateModified?: string;
}

export interface ArgumentSetDetail {
  id: string;
  name: string;
  description?: string;
  /** Provenance. Null on a set composed from the rail rather than a callable. */
  scope: ArgumentScope | null;
  targetId: string | null;
  /** Containment. `targetId` is provenance; see `ArgumentSetSchema.isPartOf`. */
  libraryId?: string;
  tags?: string[];
  currentVersionId?: string;
  currentVersion?: ArgumentSetVersionDetail | null;
  tupleBindings: ArgumentTupleBindingDetail[];
  scalarBindings: ArgumentScalarBindingDetail[];
  graphBindings: ArgumentGraphBindingDetail[];
  dateCreated?: string;
  dateModified?: string;
}

/** One graph a run hands to a start-node port, resolved to content. Its slot
 * is its position in `RuntimeArgumentPayload.dataGraphs`. */
export interface RuntimeGraphInput {
  content: string;
  format: string;
}

export interface RuntimeArgumentPayload {
  tupleMap: Map<string, RuntimeArgumentSet>;
  tupleList: RuntimeArgumentSet[];
  limits: Array<{ name: string; value: number }>;
  offsets: Array<{ name: string; value: number }>;
  /**
   * Graph ports the named sets fill. A query target ignores these — it declares
   * no graph parameter (design §5) — so the route drops them there rather than
   * refusing, exactly as it drops a table binding no clause matches.
   */
  dataGraphs: RuntimeGraphInput[];
  /** Every parameter the named sets fill, for the completion check on a run. */
  filledParameters: Set<ParameterKey>;
}

const ARGUMENT_VALUE_TYPES = new Set(['uri', 'literal']);

const signatureFromVariables = (variables: string[]): string =>
  variables.map(v => v.replace(/^\?/, '')).join('|');

const sanitizeVariableName = (variable: string): string => variable.replace(/^\?/, '');

const cloneBinding = (binding: SparqlBinding): SparqlBinding =>
  Object.fromEntries(Object.entries(binding).map(([key, value]) => [key, { ...value }])) as SparqlBinding;

const mergeArgumentSets = (existing: RuntimeArgumentSet, incoming: RuntimeArgumentSet): RuntimeArgumentSet => {
  const seen = new Set<string>(existing.arguments.bindings.map(row => JSON.stringify(row)));
  for (const row of incoming.arguments.bindings) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    existing.arguments.bindings.push(row);
  }
  return existing;
};

const toArray = <T>(value?: T | T[] | null): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

export class ArgumentSetService {
  async listForTarget(targetId: string, scope: ArgumentScope): Promise<ArgumentSetDetail[]> {
    const cacheCoordinator = getCacheCoordinator();
    const all = (cacheCoordinator.list('ArgumentSet') as LdkitArgumentSet[]) || [];
    const filtered = all.filter(set => set.targetEntity === targetId && set.argumentScope === scope);
    const expanded = await Promise.all(filtered.map(entity => this.expandArgumentSet(entity)));
    return expanded.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  /**
   * Every set in a library, whatever query or group it was made for.
   *
   * The listing `2026-08-14-query-arguments.md` §7 wanted and could not have:
   * the switcher's "elsewhere in the library" needs sets across targets, and
   * enumerating them client-side was one request per query.
   *
   */
  async listForLibrary(libraryId: string): Promise<ArgumentSetDetail[]> {
    const cacheCoordinator = getCacheCoordinator();
    const all = (cacheCoordinator.list('ArgumentSet') as LdkitArgumentSet[]) || [];
    const filtered = all.filter(set => set.isPartOf === libraryId);
    const expanded = await Promise.all(filtered.map(entity => this.expandArgumentSet(entity)));
    return expanded.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  async getById(id: string): Promise<ArgumentSetDetail | null> {
    const cacheCoordinator = getCacheCoordinator();
    const entity = cacheCoordinator.get(id) as LdkitArgumentSet | null;
    if (!entity || entity['@type'] !== 'ArgumentSet') return null;
    return this.expandArgumentSet(entity);
  }

  async createForTarget(
    scope: ArgumentScope,
    targetId: string,
    input: ArgumentSetInput,
    authScope?: ArgumentAuthScope,
  ): Promise<ArgumentSetDetail> {
    const cacheCoordinator = getCacheCoordinator();
    const parent = cacheCoordinator.get(targetId);
    if (!parent || (scope === 'query' ? parent['@type'] !== 'Query' : parent['@type'] !== 'QueryGroup')) {
      throw new Error(`Target ${targetId} not found for scope ${scope}`);
    }

    // Derived rather than accepted: the target already determines the library,
    // so asking a caller for it would only create a way to disagree with the
    // query the set was made for.
    const library = resolveOwningLibrary(parent);
    if (!library) {
      throw new Error(`Target ${targetId} does not resolve to a library`);
    }

    const setId = await this.writeSet(input, { library, scope, targetId }, authScope);

    /*
     * A set made under a callable is listed on it. Only under a callable: a set
     * composed on the rail has no parent to append to, which is the one thing
     * that makes the two creation paths differ.
     */
    const parentSets = (parent as { argumentSets?: string[] }).argumentSets;
    const parentArgumentSets = Array.isArray(parentSets) ? [...parentSets] : [];
    parentArgumentSets.push(setId);
    const parentType = typeof parent['@type'] === 'string' ? parent['@type'] : null;
    if (!parentType) {
      throw new Error(`Parent entity ${targetId} is missing @type`);
    }
    await cacheCoordinator.update(parentType, targetId, { argumentSets: parentArgumentSets });

    const created = cacheCoordinator.get(setId) as LdkitArgumentSet;
    return this.expandArgumentSet(created);
  }

  /**
   * Create a set that names its own library, with no callable to derive one from.
   *
   * The rail's `+ New`. Provenance is optional here and is *checked* when given:
   * a target in a different library would make `isPartOf` and `targetEntity`
   * disagree about where the set lives, and `resolveOwningLibrary` follows
   * `isPartOf` first, so the disagreement would be silent.
   */
  async create(input: ArgumentSetStandaloneInput, authScope?: ArgumentAuthScope): Promise<ArgumentSetDetail> {
    const cacheCoordinator = getCacheCoordinator();
    const library = cacheCoordinator.get(input.libraryId);
    if (!library || library['@type'] !== 'Library') {
      throw new Error(`Library ${input.libraryId} not found`);
    }

    const scope = input.scope ?? null;
    const targetId = input.targetId ?? null;
    if (targetId) {
      const target = cacheCoordinator.get(targetId);
      if (!target) {
        throw new Error(`Target ${targetId} not found`);
      }
      const targetLibrary = resolveOwningLibrary(target);
      if (targetLibrary && targetLibrary !== input.libraryId) {
        throw new Error(
          `Target ${targetId} belongs to library ${targetLibrary}, not ${input.libraryId}`,
        );
      }
    }

    const setId = await this.writeSet(input, { library: input.libraryId, scope, targetId }, authScope);
    const created = cacheCoordinator.get(setId) as LdkitArgumentSet;
    return this.expandArgumentSet(created);
  }

  /** The entity plus its first version. Shared by both creation paths. */
  private async writeSet(
    input: ArgumentSetInput,
    placement: { library: string; scope: ArgumentScope | null; targetId: string | null },
    authScope?: ArgumentAuthScope,
  ): Promise<string> {
    const cacheCoordinator = getCacheCoordinator();

    /*
     * Here rather than only in `createVersion` below, because that one throws
     * after `ArgumentSet` has already been written: a refused pin would leave a
     * half-built set with no version behind it, created by a request that was
     * answered 403. Checked once, on the input both calls share — so the scope
     * is deliberately *not* passed down, and the audit log gets one decision
     * per pin rather than two.
     */
    if (authScope) this.requirePinnedSourcesReadable(input, authScope.request);

    const setId = mintId('argumentSet');
    const record: Partial<LdkitArgumentSet> = {
      $id: setId,
      name: input.name,
      description: input.description,
      isPartOf: placement.library,
    };
    if (placement.scope) record.argumentScope = placement.scope;
    if (placement.targetId) record.targetEntity = placement.targetId;

    await cacheCoordinator.create('ArgumentSet', toLdkit({ ...record, '@type': 'ArgumentSet' }));

    await this.createVersion(setId, {
      tupleBindings: input.tupleBindings,
      scalarBindings: input.scalarBindings,
      graphBindings: input.graphBindings,
    }, { setCurrentVersion: true });

    return setId;
  }

  async listVersions(argumentSetId: string): Promise<ArgumentSetVersionDetail[]> {
    const versions = this.findVersionsForSet(argumentSetId);
    const expanded = await Promise.all(versions.map(version => this.expandArgumentSetVersion(version)));
    return expanded.sort((a, b) => a.version - b.version);
  }

  async getVersion(argumentSetId: string, versionNumber: number): Promise<ArgumentSetVersionDetail | null> {
    const version = this.findVersionByNumber(argumentSetId, versionNumber);
    if (!version) return null;
    return this.expandArgumentSetVersion(version);
  }

  /**
   * The stored entities this version's bindings *pin*, checked against the
   * caller before any of them is written down.
   *
   * A tuple binding may name `tupleSetVersions`, and a graph binding may name a
   * `dataGraphVersionId`. Neither has to live in the library the set is being
   * written to, and neither was checked: the route guard reads `libraryId` off
   * the body and requires Write *there*. `exportRuntimePayload` then resolves
   * both to content — `rowsFromTupleSetVersions` reads the version's rows,
   * `resolveDataGraphInput` reads its triples — so Write on a library you hold
   * bought a read of rows and triples out of one you do not.
   *
   * This is the pair `POST /tuple-sets/:id/versions/from-etl` and
   * `POST /data-graphs/:id/versions/from-query` already carry — the guard
   * checks the entity being written, the handler checks the second entity the
   * body names — arriving through a third door.
   *
   * `read`, not `execute`: pinning stores no SQL and runs no query. It copies
   * stored data into a payload, which is what Read on that library governs
   * everywhere else.
   *
   * An id that resolves to no library is refused rather than abstained on,
   * because `requireLibraryMode(null, …)` denies — so neither an unknown id nor
   * one whose library has since been deleted is a way through.
   */
  private requirePinnedSourcesReadable(
    input: ArgumentSetVersionInput,
    request: FastifyRequest,
  ): void {
    const pinned = new Set<string>();

    for (const binding of toArray(input.tupleBindings)) {
      for (const versionId of binding.tupleSetVersions ?? []) {
        if (typeof versionId === 'string' && versionId.trim()) pinned.add(versionId.trim());
      }
    }
    for (const graph of toArray(input.graphBindings)) {
      const versionId = graph.dataGraphVersionId?.trim();
      if (versionId) pinned.add(versionId);
    }
    if (pinned.size === 0) return;

    const cacheCoordinator = getCacheCoordinator();
    for (const versionId of pinned) {
      requireLibraryMode(request, resolveOwningLibrary(cacheCoordinator.get(versionId)), 'read');
    }
  }

  async createVersion(
    argumentSetId: string,
    input: ArgumentSetVersionInput,
    options?: { setCurrentVersion?: boolean; authScope?: ArgumentAuthScope }
  ): Promise<ArgumentSetVersionDetail> {
    const cacheCoordinator = getCacheCoordinator();
    const parent = cacheCoordinator.get(argumentSetId) as LdkitArgumentSet | null;
    if (!parent || parent['@type'] !== 'ArgumentSet') {
      throw new Error(`ArgumentSet ${argumentSetId} not found`);
    }

    /*
     * After the parent check, so an unreachable set stays a 404 rather than
     * gaining a status code that says whether it exists — and before anything
     * is written, so a refused pin leaves no half-built version behind. Every
     * creation path funnels through here (`writeSet` calls it for `create` and
     * `createForTarget` alike), which is what makes one call cover all four
     * routes that compose a set.
     */
    if (options?.authScope) {
      this.requirePinnedSourcesReadable(input, options.authScope.request);
    }

    const nextVersion = this.getNextVersionNumber(argumentSetId);
    const versionId = mintId('argumentSetVersion');

    const tupleBindingIds: string[] = [];
    for (const [position, binding] of toArray(input.tupleBindings).entries()) {
      const bindingId = await this.createTupleBinding(argumentSetId, binding, { allowProvidedIds: false, position });
      tupleBindingIds.push(bindingId);
    }

    const scalarBindingIds: string[] = [];
    for (const scalar of toArray(input.scalarBindings)) {
      const scalarId = await this.createScalarBinding(scalar, { allowProvidedIds: false });
      scalarBindingIds.push(scalarId);
    }

    const graphBindingIds: string[] = [];
    for (const [position, graph] of toArray(input.graphBindings).entries()) {
      const graphId = await this.createGraphBinding(graph, position);
      graphBindingIds.push(graphId);
    }

    const record: Partial<LdkitArgumentSetVersion> = {
      $id: versionId,
      isPartOf: argumentSetId,
      version: nextVersion,
      // Frozen on create (issue #192). A version is a snapshot: what it holds is
      // what a reference to it means, so it is never created in a state where it
      // could still change — there is no such thing as a mutable version.
      tupleBindings: tupleBindingIds,
      scalarBindings: scalarBindingIds,
      graphBindings: graphBindingIds,
    };

    await cacheCoordinator.create('ArgumentSetVersion', toLdkit({ ...record, '@type': 'ArgumentSetVersion' }));

    const shouldSetCurrent = options?.setCurrentVersion ?? true;
    if (shouldSetCurrent) {
      await cacheCoordinator.update('ArgumentSet', argumentSetId, { currentVersion: versionId });
    }

    const created = cacheCoordinator.get(versionId) as LdkitArgumentSetVersion;
    return this.expandArgumentSetVersion(created);
  }

  async delete(id: string): Promise<void> {
    const cacheCoordinator = getCacheCoordinator();
    const entity = cacheCoordinator.get(id) as LdkitArgumentSet | null;
    if (!entity) return;

    const versions = this.findVersionsForSet(id);
    for (const version of versions) {
      await this.deleteVersionBindings(version);
      await cacheCoordinator.delete('ArgumentSetVersion', version.$id);
    }

    const legacyTupleBindings = toArray(entity.tupleBindings);
    for (const bindingId of legacyTupleBindings) {
      await this.deleteTupleBinding(bindingId);
    }

    for (const scalarId of toArray(entity.scalarBindings)) {
      await cacheCoordinator.delete('ArgumentScalarBinding', scalarId);
    }

    await cacheCoordinator.delete('ArgumentSet', entity.$id);
    // A set composed on the rail has no target to unlist it from.
    if (!entity.targetEntity) return;
    const parent = cacheCoordinator.get(entity.targetEntity);
    if (parent) {
      const parentSets = (parent as { argumentSets?: string[] }).argumentSets;
      const list = (Array.isArray(parentSets) ? parentSets : []).filter((x: string) => x !== entity.$id);
      const parentType = typeof parent['@type'] === 'string' ? parent['@type'] : null;
      if (!parentType) {
        throw new Error(`Parent entity ${entity.targetEntity} is missing @type`);
      }
      await cacheCoordinator.update(parentType, entity.targetEntity, { argumentSets: list });
    }
  }

  async exportRuntimePayload(argumentSetIds: string[]): Promise<RuntimeArgumentPayload> {
    if (!argumentSetIds.length) {
      return {
        tupleMap: new Map(), tupleList: [], limits: [], offsets: [],
        dataGraphs: [], filledParameters: new Set(),
      };
    }
    const tupleMap = new Map<string, RuntimeArgumentSet>();
    const limits: Array<{ name: string; value: number }> = [];
    const offsets: Array<{ name: string; value: number }> = [];
    const dataGraphs: RuntimeGraphInput[] = [];
    const filledParameters = new Set<ParameterKey>();

    for (const id of argumentSetIds) {
      const detail = await this.resolveVersionDetailForId(id);
      for (const binding of detail.tupleBindings) {
        const vars = binding.variables;
        const head = { vars };
        const rows = [
          ...binding.rows.sort((a, b) => a.position - b.position).map(row => cloneBinding(row.values)),
          // Tuple set rows union with the inline ones under the same signature.
          // Same mechanism the signature-keyed map already used to merge two
          // argument sets contributing one clause — a source is a source.
          ...this.rowsFromTupleSetVersions(binding.tupleSetVersions, vars),
        ];
        const runtime: RuntimeArgumentSet = {
          head,
          arguments: { bindings: rows },
        };
        /*
         * Keyed canonically, not by the stored `tupleSignature` string.
         *
         * The two had drifted: this map was keyed on the binding's variables in
         * stored order while `/execute` validated the same payload against a
         * sorted signature. A set written `?b ?a` for a clause declaring
         * `?a ?b` therefore passed validation and then missed the lookup, and
         * its rows were dropped — the run went ahead unfiltered rather than
         * failing. `alignArgumentSets` in the runtime sorts before comparing,
         * for the same reason, so sorted is the answer the deepest layer
         * already gives.
         */
        const key = tableParameterKey(vars);
        const existing = tupleMap.get(key);
        if (existing) {
          mergeArgumentSets(existing, runtime);
        } else {
          tupleMap.set(key, runtime);
        }
      }
      for (const scalar of detail.scalarBindings) {
        const bucket = scalar.parameterKind === 'limit' ? limits : offsets;
        bucket.push({ name: scalar.parameterName, value: scalar.numericValue });
      }
      for (const graph of detail.graphBindings) {
        /*
         * Resolved to content here, so a run receives the same shape whether
         * the graph was pinned or pasted, and so a version that has since been
         * deleted fails loudly at the run rather than seeding an empty store.
         */
        const resolved = resolveDataGraphInput({
          dataGraphVersionId: graph.dataGraphVersionId ?? null,
          dataGraphInline: graph.contentString ?? null,
          dataGraphInlineFormat: graph.contentFormat ?? undefined,
        });
        if (resolved) {
          // `detail.graphBindings` is already slot-ordered, so pushing in that
          // order is what puts a run's `dataGraphs[]` in the order the group
          // routes against.
          dataGraphs.push({ content: resolved.content, format: resolved.format });
        }
      }
      for (const key of parameterKeysOf({
        tupleBindings: detail.tupleBindings,
        scalarBindings: detail.scalarBindings,
        graphBindings: detail.graphBindings,
      })) {
        filledParameters.add(key);
      }
    }

    return {
      tupleMap,
      tupleList: Array.from(tupleMap.values()),
      limits,
      offsets,
      dataGraphs,
      filledParameters,
    };
  }

  async exportAsExecutionPayload(argumentSetId: string) {
    const payload = await this.exportRuntimePayload([argumentSetId]);
    return {
      arguments: payload.tupleList,
      limits: payload.limits,
      offsets: payload.offsets,
      dataGraphs: payload.dataGraphs,
    };
  }

  /**
   * Which version an export of `id` should read, or why it cannot.
   *
   * `id` may name either spelling, and the two mean different things: an
   * `ArgumentSet` is "whatever this set says now" and an `ArgumentSetVersion`
   * is "this, frozen". Callers that pin a version — a test case, a run bar
   * copying the payload it is about to send — hold the version IRI, and had
   * nowhere to send it: `/argument-sets/:id/export` resolved a set to its
   * *current* version, so a pinned caller either 404'd or was answered about a
   * version it had not asked about.
   *
   * `exportRuntimePayload` has always accepted both. This says so where a route
   * can act on it, and separates "no such thing" from "a set with no version
   * yet" so the two keep their different status codes.
   */
  resolveExportVersionId(id: string): { versionId: string } | { problem: 'not-found' | 'no-current-version' } {
    const entity = getCacheCoordinator().get(id);
    if (!entity) return { problem: 'not-found' };
    if (entity['@type'] === 'ArgumentSetVersion') return { versionId: id };
    if (entity['@type'] !== 'ArgumentSet') return { problem: 'not-found' };
    const currentId = (entity as LdkitArgumentSet).currentVersion;
    return currentId ? { versionId: currentId } : { problem: 'no-current-version' };
  }

  /**
   * Store one tuple binding: signature, sources, and inline rows as SRJ.
   *
   * Was one `ArgumentValue` per cell plus one `ArgumentRow` per row, each its
   * own awaited create — ~25,000 entities for a 5,000x4 table, walked back into
   * JSON on every execution. Now one string, validated by the same reader that
   * handles tuple set imports, so blank nodes and malformed terms are refused
   * here exactly as they are there.
   */
  private async createTupleBinding(
    argumentSetId: string,
    binding: ArgumentTupleBindingPayload,
    options?: { allowProvidedIds?: boolean; position?: number }
  ): Promise<string> {
    const allowProvidedIds = options?.allowProvidedIds ?? true;
    const bindingId = allowProvidedIds && binding.id ? binding.id : mintId('argumentTupleBinding');
    const sanitizedVariables = binding.variables.map(sanitizeVariableName);

    const bindings = binding.rows
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(row => {
        const out: Record<string, ArgumentValuePayload> = {};
        for (let i = 0; i < sanitizedVariables.length; i += 1) {
          const variable = sanitizedVariables[i];
          const originalName = binding.variables[i];
          const value = row.values[variable] ?? row.values[originalName] ?? row.values[`?${originalName}`];
          if (!value) continue; // absent key is UNDEF
          if (!ARGUMENT_VALUE_TYPES.has(value.type)) {
            throw new Error(`Unsupported argument value type ${value.type} for variable ${variable}`);
          }
          out[variable] = value;
        }
        return out;
      });

    const document = { head: { vars: sanitizedVariables }, results: { bindings } };
    const parsed = parseTupleContent(JSON.stringify(document), 'sparql-results-json');

    const tupleRecord: Partial<LdkitArgumentTupleBinding> = {
      $id: bindingId,
      tupleSignature: binding.tupleSignature || signatureFromVariables(sanitizedVariables),
      // Explicit, because `ArgumentSetVersion.tupleBindings` is an RDF array
      // and does not come back in the order it went in.
      position: binding.position ?? options?.position ?? 0,
      fallbackVariables: sanitizedVariables,
      contentString: parsed.contentString,
      ...(binding.tupleSetVersions?.length ? { tupleSetVersions: binding.tupleSetVersions } : {}),
    };
    await getCacheCoordinator().create('ArgumentTupleBinding', toLdkit({ ...tupleRecord, '@type': 'ArgumentTupleBinding' }));
    return bindingId;
  }

  private async deleteTupleBinding(bindingId: string): Promise<void> {
    await getCacheCoordinator().delete('ArgumentTupleBinding', bindingId);
  }

  private async createScalarBinding(
    binding: ArgumentScalarBindingPayload,
    options?: { allowProvidedIds?: boolean }
  ): Promise<string> {
    const allowProvidedIds = options?.allowProvidedIds ?? true;
    const id = allowProvidedIds && binding.id ? binding.id : mintId('argumentScalarBinding');
    const record: Partial<LdkitArgumentScalarBinding> = {
      $id: id,
      parameterKind: binding.parameterKind,
      parameterName: binding.parameterName,
      numericValue: binding.numericValue,
      parameterIri: binding.parameterIri,
    };
    await getCacheCoordinator().create('ArgumentScalarBinding', toLdkit({ ...record, '@type': 'ArgumentScalarBinding' }));
    return id;
  }

  private async expandArgumentSet(entity: LdkitArgumentSet): Promise<ArgumentSetDetail> {
    const currentVersionId = entity.currentVersion ?? undefined;
    let currentVersion: ArgumentSetVersionDetail | null = null;
    let tupleBindings: ArgumentTupleBindingDetail[] = [];
    let scalarBindings: ArgumentScalarBindingDetail[] = [];
    let graphBindings: ArgumentGraphBindingDetail[] = [];

    if (currentVersionId) {
      const versionEntity = this.findVersionById(currentVersionId);
      if (versionEntity) {
        currentVersion = await this.expandArgumentSetVersion(versionEntity);
        tupleBindings = currentVersion.tupleBindings;
        scalarBindings = currentVersion.scalarBindings;
        graphBindings = currentVersion.graphBindings;
      }
    }

    return {
      id: entity.$id,
      name: entity.name,
      description: entity.description ?? undefined,
      scope: entity.argumentScope ?? null,
      targetId: entity.targetEntity ?? null,
      libraryId: entity.isPartOf,
      tags: entity.tags ?? undefined,
      currentVersionId,
      currentVersion: currentVersion ?? undefined,
      tupleBindings,
      scalarBindings,
      graphBindings,
      dateCreated: entity.dateCreated ?? undefined,
      dateModified: entity.dateModified ?? undefined,
    };
  }

  private async expandArgumentSetVersion(entity: LdkitArgumentSetVersion): Promise<ArgumentSetVersionDetail> {
    /*
     * Sorted by the stored slot, because `tupleBindings` and `graphBindings`
     * are RDF arrays: what comes back is a set, in whatever order the store
     * chose. A group routes these by position, so the order is load-bearing —
     * see `2026-09-07-payload-and-routing.md` §4.
     */
    const tupleBindings = orderByPosition(await Promise.all(
      toArray(entity.tupleBindings).map(async (bindingId, index) => this.expandTupleBinding(bindingId, index))
    ));
    const scalarBindings = await Promise.all(
      toArray(entity.scalarBindings).map(async (scalarId) => this.expandScalarBinding(scalarId))
    );
    const graphBindings = orderByPosition(toArray(entity.graphBindings)
      .map((graphId, index) => this.expandGraphBinding(graphId, index))
      .filter((binding): binding is ArgumentGraphBindingDetail => binding !== null));

    return {
      id: entity.$id,
      isPartOf: entity.isPartOf,
      version: entity.version,
      tupleBindings,
      scalarBindings,
      graphBindings,
      dateCreated: entity.dateCreated ?? undefined,
      dateModified: entity.dateModified ?? undefined,
    };
  }

  /**
   * Read a binding back into the detail shape the API has always returned.
   *
   * The wire shape is deliberately unchanged by the storage switch: callers
   * still get `rows[].values` as a `SparqlBinding`, so the web app and every
   * consumer of `/argument-sets` see exactly what they saw when rows were
   * entities. Only where the rows come from changed.
   *
   * Row ids are synthesised from the binding id and position rather than
   * stored. They were entity IRIs; nothing addresses a row on its own (there is
   * no `/argument-rows`), and a client keying a list on `row.id` still gets a
   * stable, unique value.
   */
  private async expandTupleBinding(bindingId: string, fallbackPosition = 0): Promise<ArgumentTupleBindingDetail> {
    const cacheCoordinator = getCacheCoordinator();
    const binding = cacheCoordinator.get(bindingId) as LdkitArgumentTupleBinding | null;
    if (!binding) {
      throw new Error(`ArgumentTupleBinding ${bindingId} not found`);
    }

    const variables = binding.fallbackVariables
      || (binding.tupleSignature ? binding.tupleSignature.split('|') : []);

    const rows = this.rowsFromContent(binding.$id, binding.contentString);

    return {
      id: binding.$id,
      position: typeof binding.position === 'number' ? binding.position : fallbackPosition,
      tupleSignature: binding.tupleSignature || signatureFromVariables(variables),
      variables,
      rows,
      ...(binding.tupleSetVersions?.length ? { tupleSetVersions: binding.tupleSetVersions } : {}),
    };
  }

  /**
   * Rows contributed by pinned tuple set versions, projected onto the binding.
   *
   * Matching is by name — the binding's signature is the query's vocabulary, and
   * there is no rename layer, because renaming belongs to group edges
   * (`2026-08-18-tuple-sets.md` §6).
   *
   * **Each row is projected onto the binding's variables, and a row left empty
   * is dropped.** This is load-bearing rather than tidying: a row keyed only by
   * foreign column names survives as a non-empty object, and downstream
   * rendering reads it as a row where every one of *this* clause's variables is
   * UNDEF — which is a wildcard matching everything, not the "contributes
   * nothing" it looks like. A mismatched set would silently invert the query's
   * meaning instead of narrowing it.
   *
   * A version that has gone missing is skipped rather than fatal: a saved
   * argument set pins version ids, so a dangling one means the version was
   * deleted out from under it, and failing every execution of an otherwise
   * valid set is a worse answer than running with what remains.
   */
  private rowsFromTupleSetVersions(
    versionIds: string[] | undefined,
    variables: string[],
  ): SparqlBinding[] {
    if (!versionIds?.length) return [];
    const cacheCoordinator = getCacheCoordinator();
    const wanted = new Set(variables);
    const rows: SparqlBinding[] = [];

    for (const versionId of versionIds) {
      const version = cacheCoordinator.get(versionId) as LdkitTupleSetVersion | null;
      if (!version || version['@type'] !== 'TupleSetVersion' || !version.contentString) {
        console.warn(`[ArgumentSetService] TupleSetVersion ${versionId} is missing; skipping its rows.`);
        continue;
      }

      const document = readStoredTupleContent(version.contentString);
      let contributed = 0;
      for (const binding of document.results.bindings) {
        const projected: SparqlBinding = {};
        for (const [name, term] of Object.entries(binding)) {
          if (wanted.has(name)) projected[name] = { ...term } as SparqlBinding[string];
        }
        if (Object.keys(projected).length === 0) continue;
        rows.push(projected);
        contributed += 1;
      }

      if (contributed === 0 && document.results.bindings.length > 0) {
        console.warn(
          `[ArgumentSetService] TupleSetVersion ${versionId} has columns ` +
            `[${(version.tupleColumns ?? []).join(', ')}] and contributes nothing to ` +
            `[${variables.join(', ')}]; matching is by name.`
        );
      }
    }

    return rows;
  }

  private rowsFromContent(
    bindingId: string,
    contentString: string,
  ): ArgumentTupleBindingDetail['rows'] {
    const document = readStoredTupleContent(contentString);
    return document.results.bindings.map((values, position) => ({
      id: `${bindingId}#row-${position}`,
      position,
      values: values as SparqlBinding,
    }));
  }

  private async expandScalarBinding(scalarId: string): Promise<ArgumentScalarBindingDetail> {
    const scalar = getCacheCoordinator().get(scalarId) as LdkitArgumentScalarBinding | null;
    if (!scalar) {
      throw new Error(`ArgumentScalarBinding ${scalarId} not found`);
    }
    return {
      id: scalar.$id,
      parameterKind: scalar.parameterKind,
      parameterName: scalar.parameterName,
      numericValue: scalar.numericValue,
      parameterIri: scalar.parameterIri ?? undefined,
    };
  }

  private findVersionsForSet(argumentSetId: string): LdkitArgumentSetVersion[] {
    const all = (getCacheCoordinator().list('ArgumentSetVersion') as LdkitArgumentSetVersion[]) || [];
    return all.filter((version) => {
      const partOf = Array.isArray(version.isPartOf) ? version.isPartOf : [version.isPartOf];
      return partOf.includes(argumentSetId);
    });
  }

  private findVersionByNumber(argumentSetId: string, versionNumber: number): LdkitArgumentSetVersion | null {
    const versions = this.findVersionsForSet(argumentSetId);
    return versions.find(version => version.version === versionNumber) ?? null;
  }

  private findVersionById(versionId: string): LdkitArgumentSetVersion | null {
    const cacheCoordinator = getCacheCoordinator();
    const entity = cacheCoordinator.get(versionId) as LdkitArgumentSetVersion | null;
    if (entity && entity['@type'] === 'ArgumentSetVersion') {
      return entity;
    }
    const all = (cacheCoordinator.list('ArgumentSetVersion') as LdkitArgumentSetVersion[]) || [];
    return all.find(version => version.$id === versionId) ?? null;
  }

  private getNextVersionNumber(argumentSetId: string): number {
    const versions = this.findVersionsForSet(argumentSetId);
    if (!versions.length) return 1;
    const maxVersion = Math.max(...versions.map(v => v.version ?? 0));
    return maxVersion + 1;
  }

  private async deleteVersionBindings(version: LdkitArgumentSetVersion): Promise<void> {
    for (const bindingId of toArray(version.tupleBindings)) {
      await this.deleteTupleBinding(bindingId);
    }
    for (const scalarId of toArray(version.scalarBindings)) {
      await getCacheCoordinator().delete('ArgumentScalarBinding', scalarId);
    }
    for (const graphId of toArray(version.graphBindings)) {
      await getCacheCoordinator().delete('ArgumentGraphBinding', graphId);
    }
  }

  /**
   * Store one graph binding, refusing anything the caller could have got right.
   *
   * Exactly-one is checked here rather than in the schema, matching how
   * `resolveDataGraphInput` checks the same pairing on the execute body — and
   * checked at *write*, so a stored set cannot be a run that fails later.
   */
  private async createGraphBinding(payload: ArgumentGraphBindingPayload, position = 0): Promise<string> {
    const versionId = payload.dataGraphVersionId?.trim() || null;
    const inline = typeof payload.contentString === 'string' && payload.contentString.trim().length > 0;
    if (versionId && inline) {
      throw new DataGraphContentError('Provide either dataGraphVersionId or contentString on a graph binding, not both');
    }
    if (!versionId && !inline) {
      throw new DataGraphContentError('A graph binding needs either dataGraphVersionId or contentString');
    }

    /*
     * Resolved once here so a bad version id or unparseable RDF is a refusal at
     * save rather than at every run that names the set. The resolved content is
     * thrown away: the binding stores the reference, and a run re-resolves it.
     */
    resolveDataGraphInput({
      dataGraphVersionId: versionId,
      dataGraphInline: inline ? payload.contentString : null,
      dataGraphInlineFormat: payload.contentFormat ?? undefined,
    });

    const cacheCoordinator = getCacheCoordinator();
    const bindingId = mintId('argumentGraphBinding');
    const record: Partial<LdkitArgumentGraphBinding> = {
      $id: bindingId,
      // The slot, and nothing else. Which port a graph fills is the group's.
      position: payload.position ?? position,
      dataGraphVersion: versionId ?? undefined,
      contentString: inline ? payload.contentString : undefined,
      contentFormat: inline ? (payload.contentFormat ?? undefined) : undefined,
    };
    await cacheCoordinator.create('ArgumentGraphBinding', toLdkit({ ...record, '@type': 'ArgumentGraphBinding' }));
    return bindingId;
  }

  private expandGraphBinding(bindingId: string, fallbackPosition = 0): ArgumentGraphBindingDetail | null {
    const binding = getCacheCoordinator().get(bindingId) as LdkitArgumentGraphBinding | null;
    if (!binding) return null;
    return {
      id: binding.$id,
      position: typeof binding.position === 'number' ? binding.position : fallbackPosition,
      dataGraphVersionId: binding.dataGraphVersion ?? undefined,
      contentString: binding.contentString ?? undefined,
      contentFormat: binding.contentFormat ?? undefined,
    };
  }

  private async rebuildTupleBindings(
    version: LdkitArgumentSetVersion,
    bindings: ArgumentTupleBindingPayload[]
  ): Promise<string[]> {
    for (const bindingId of toArray(version.tupleBindings)) {
      await this.deleteTupleBinding(bindingId);
    }
    const tupleBindingIds: string[] = [];
    for (const [position, binding] of bindings.entries()) {
      const bindingId = await this.createTupleBinding(version.isPartOf, binding, { allowProvidedIds: false, position });
      tupleBindingIds.push(bindingId);
    }
    return tupleBindingIds;
  }

  private async rebuildScalarBindings(
    version: LdkitArgumentSetVersion,
    bindings: ArgumentScalarBindingPayload[]
  ): Promise<string[]> {
    for (const scalarId of toArray(version.scalarBindings)) {
      await getCacheCoordinator().delete('ArgumentScalarBinding', scalarId);
    }
    const scalarBindingIds: string[] = [];
    for (const scalar of bindings) {
      const scalarId = await this.createScalarBinding(scalar, { allowProvidedIds: false });
      scalarBindingIds.push(scalarId);
    }
    return scalarBindingIds;
  }

  /**
   * The `ArgumentSetVersion` IRI an argument reference names.
   *
   * Both spellings are accepted wherever an argument set is referenced: a
   * version IRI is already pinned and comes back unchanged, while a set IRI
   * floats and resolves to its `currentVersion` *now*. Callers that need to
   * record what a run actually executed — rather than merely execute it — read
   * this once and then work from the version IRI, so a publish landing
   * mid-run cannot split a run across two sets of values (issue #246).
   *
   * Synchronous on purpose: it is a cache lookup, and being callable from
   * task-planning code that is not async is the point.
   */
  resolveVersionIdForId(id: string): string {
    const cacheCoordinator = getCacheCoordinator();
    const entity = cacheCoordinator.get(id);
    if (!entity) {
      throw new Error(`ArgumentSetVersion ${id} not found`);
    }
    if (entity['@type'] === 'ArgumentSetVersion') return id;
    if (entity['@type'] === 'ArgumentSet') {
      const currentId = (entity as LdkitArgumentSet).currentVersion;
      if (!currentId) {
        throw new Error(`ArgumentSet ${id} has no current version`);
      }
      const current = cacheCoordinator.get(currentId);
      if (!current || current['@type'] !== 'ArgumentSetVersion') {
        throw new Error(`ArgumentSetVersion ${currentId} not found`);
      }
      return currentId;
    }
    throw new Error(`ArgumentSetVersion ${id} not found`);
  }

  private async resolveVersionDetailForId(id: string): Promise<ArgumentSetVersionDetail> {
    const versionId = this.resolveVersionIdForId(id);
    const version = getCacheCoordinator().get(versionId) as LdkitArgumentSetVersion | null;
    if (!version) {
      throw new Error(`ArgumentSetVersion ${versionId} not found`);
    }
    return this.expandArgumentSetVersion(version);
  }

}
