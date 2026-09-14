/**
 * The one normalization boundary for query-group canvas I/O.
 *
 * A query node's ports used to be built two different ways - imperatively from
 * a `QueryVersionExpanded` when a query was assigned, and declaratively from a
 * `QueryGroupVersionExpanded` when a saved group was loaded - so the same node
 * could show different ports depending on how it arrived. Both paths now build
 * the same records here.
 *
 * Two rules are load-bearing:
 *
 * - Unknown is not zero. A tuple whose members were never described has arity
 *   `null`, not `0`, because `0` is also a legal answer and the two must not be
 *   confused by anything downstream that filters or reports.
 * - A reference with no entity behind it stays visible and is marked
 *   `resolved: false`. Guessing its type from its IRI and presenting the guess
 *   as fact is how an incomplete response became an empty, plausible-looking UI.
 */

import type { QueryGroupVersionExpanded, QueryVersionExpanded } from '@sparql-query-lib/contracts';
import type { Covers } from './exhaustiveDomain';

export type IoEntityKind =
  | 'QueryInputTuple'
  | 'QueryOutputTuple'
  | 'TriplesQuadsIO'
  | 'BooleanIO'
  | 'QueryIdInput'
  | 'ControlFlowIO'
  | 'Unknown';

/** Every `IoEntityKind`, for enumeration. See `exhaustiveDomain.ts`. */
export const IO_ENTITY_KINDS = [
  'QueryInputTuple',
  'QueryOutputTuple',
  'TriplesQuadsIO',
  'BooleanIO',
  'QueryIdInput',
  'ControlFlowIO',
  'Unknown',
] as const satisfies readonly IoEntityKind[];
export const _ioEntityKindsCover: Covers<IoEntityKind, (typeof IO_ENTITY_KINDS)[number]> = true;

/**
 * Who owns the entity behind a port.
 *
 * Runtime metadata only - nothing is persisted from it yet. It exists so that
 * switching a node's query version can drop that version's canonical ports
 * without touching ports the group itself declared.
 */
export type PortOrigin = 'query-version' | 'query-group' | 'synthetic' | 'unknown';

/** Every `PortOrigin`, for enumeration. */
export const PORT_ORIGINS = [
  'query-version',
  'query-group',
  'synthetic',
  'unknown',
] as const satisfies readonly PortOrigin[];
export const _portOriginsCover: Covers<PortOrigin, (typeof PORT_ORIGINS)[number]> = true;

export type IoEntityRecord = {
  id: string;
  kind: IoEntityKind;
  name?: string | null;
  description?: string | null;
  /** Member ids in declaration order, or null when the members are unknown. */
  memberEntries?: string[] | null;
  /** Member count, or null when unknown. Never 0 as a stand-in for unknown. */
  arity?: number | null;
  origin?: PortOrigin;
};

export type GraphPort = {
  id: string;
  label: string;
  entityType: IoEntityKind;
  direction: 'input' | 'output';
  origin?: PortOrigin;
  /** False when no typed I/O entity backed this reference. */
  resolved?: boolean;
};

export type TupleMemberRecord = {
  id: string;
  position: number;
  variable: string;
};

export type VariableRecord = {
  id: string;
  variableName: string;
  direction: 'input' | 'output';
  allowedTypes?: string[] | null;
};

/** How far along a node's referenced query version is. */
export type QueryVersionResolution =
  | { status: 'unloaded' }
  | { status: 'loading' }
  | { status: 'ready'; versionId: string }
  | { status: 'error'; message: string };

export type QueryVersionResolutionStatus = QueryVersionResolution['status'];

/** Every resolution status, for enumeration. */
export const QUERY_VERSION_RESOLUTION_STATUSES = [
  'unloaded',
  'loading',
  'ready',
  'error',
] as const satisfies readonly QueryVersionResolutionStatus[];
export const _resolutionStatusesCover: Covers<
  QueryVersionResolutionStatus,
  (typeof QUERY_VERSION_RESOLUTION_STATUSES)[number]
> = true;

export type IoModel = {
  entities: Record<string, IoEntityRecord>;
  members: Record<string, TupleMemberRecord>;
  variables: Record<string, VariableRecord>;
};

export const emptyIoModel = (): IoModel => ({ entities: {}, members: {}, variables: {} });

const QUERY_TYPE_CONSTRUCT = 'https://sparql-query-lib/query-type/construct';
const QUERY_TYPE_DESCRIBE = 'https://sparql-query-lib/query-type/describe';
const QUERY_TYPE_ASK = 'https://sparql-query-lib/query-type/ask';

const trimmedOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const memberList = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : null;

/** Member count, or null when the member list itself is unknown. */
export const tupleArity = (entity: Pick<IoEntityRecord, 'memberEntries'> | null | undefined): number | null => {
  if (!entity) return null;
  const members = entity.memberEntries;
  return Array.isArray(members) ? members.length : null;
};

/** Human-readable arity, distinguishing a real zero from an unknown. */
export const describeArity = (arity: number | null | undefined): string => {
  if (arity == null) return 'arity unknown';
  return arity === 1 ? '1 var' : `${arity} vars`;
};

const makeTupleEntity = (
  raw: { id?: string | null; name?: string | null; memberEntries?: unknown },
  kind: 'QueryInputTuple' | 'QueryOutputTuple',
  origin: PortOrigin,
): IoEntityRecord | null => {
  if (typeof raw?.id !== 'string' || !raw.id) return null;
  const memberEntries = memberList(raw.memberEntries);
  return {
    id: raw.id,
    kind,
    name: trimmedOrNull(raw.name),
    description: null,
    memberEntries,
    arity: memberEntries ? memberEntries.length : null,
    origin,
  };
};

const makeScalarEntity = (
  raw: { id?: string | null; name?: string | null; description?: string | null },
  kind: 'TriplesQuadsIO' | 'BooleanIO' | 'QueryIdInput',
  origin: PortOrigin,
): IoEntityRecord | null => {
  if (typeof raw?.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    kind,
    name: trimmedOrNull(raw.name),
    description: trimmedOrNull(raw.description),
    memberEntries: null,
    arity: null,
    origin,
  };
};

type EntitySource = {
  inputTuples?: ReadonlyArray<{ id?: string | null; name?: string | null; memberEntries?: unknown }> | null;
  outputTuples?: ReadonlyArray<{ id?: string | null; name?: string | null; memberEntries?: unknown }> | null;
  rdfOutputs?: ReadonlyArray<{ id?: string | null; name?: string | null; description?: string | null }> | null;
  booleanOutputs?: ReadonlyArray<{ id?: string | null; name?: string | null; description?: string | null }> | null;
  queryIdInputs?: ReadonlyArray<{ id?: string | null; name?: string | null; description?: string | null }> | null;
  tupleMembers?: ReadonlyArray<{ id?: string | null; position?: unknown; variable?: unknown }> | null;
  inputs?: ReadonlyArray<{ id?: string | null; variableName?: unknown; allowedTypes?: unknown }> | null;
  outputs?: ReadonlyArray<{ id?: string | null; variableName?: unknown }> | null;
};

/**
 * Turn any expanded payload's flat entity arrays into normalized records.
 *
 * Both the group expansion and a query-version expansion use these array names,
 * which is what lets assignment and reload share this function.
 */
export function normalizeIoModel(source: EntitySource, origin: PortOrigin): IoModel {
  const model = emptyIoModel();

  for (const raw of source.inputTuples ?? []) {
    const entity = makeTupleEntity(raw, 'QueryInputTuple', origin);
    if (entity) model.entities[entity.id] = entity;
  }
  for (const raw of source.outputTuples ?? []) {
    const entity = makeTupleEntity(raw, 'QueryOutputTuple', origin);
    if (entity) model.entities[entity.id] = entity;
  }
  for (const raw of source.rdfOutputs ?? []) {
    const entity = makeScalarEntity(raw, 'TriplesQuadsIO', origin);
    if (entity) model.entities[entity.id] = entity;
  }
  for (const raw of source.booleanOutputs ?? []) {
    const entity = makeScalarEntity(raw, 'BooleanIO', origin);
    if (entity) model.entities[entity.id] = entity;
  }
  for (const raw of source.queryIdInputs ?? []) {
    const entity = makeScalarEntity(raw, 'QueryIdInput', origin);
    if (entity) model.entities[entity.id] = entity;
  }

  for (const raw of source.tupleMembers ?? []) {
    if (typeof raw?.id !== 'string' || !raw.id) continue;
    if (typeof raw.variable !== 'string' || !raw.variable) continue;
    model.members[raw.id] = {
      id: raw.id,
      position: typeof raw.position === 'number' ? raw.position : 0,
      variable: raw.variable,
    };
  }

  const addVariable = (raw: { id?: string | null; variableName?: unknown; allowedTypes?: unknown }, direction: 'input' | 'output') => {
    if (typeof raw?.id !== 'string' || !raw.id) return;
    model.variables[raw.id] = {
      id: raw.id,
      variableName: typeof raw.variableName === 'string' ? raw.variableName : raw.id,
      direction,
      allowedTypes: Array.isArray(raw.allowedTypes)
        ? raw.allowedTypes.filter((entry): entry is string => typeof entry === 'string')
        : null,
    };
  };
  for (const raw of source.inputs ?? []) addVariable(raw, 'input');
  for (const raw of source.outputs ?? []) addVariable(raw, 'output');

  return model;
}

/**
 * Merge normalized models, later sources winning per key.
 *
 * Merging rather than replacing is what keeps a shared tuple alive when one of
 * two nodes using the same query version is switched away.
 */
export function mergeIoModels(...models: Array<IoModel | null | undefined>): IoModel {
  const merged = emptyIoModel();
  for (const model of models) {
    if (!model) continue;
    Object.assign(merged.entities, model.entities);
    Object.assign(merged.members, model.members);
    Object.assign(merged.variables, model.variables);
  }
  return merged;
}

/**
 * The immutable interface a QueryVersion contributes to any node that
 * references it: its canonical port ids plus the entities describing them.
 */
export type QueryVersionInterface = {
  versionId: string;
  queryType: string | null;
  queryString: string | null;
  inputPortIds: string[];
  outputPortIds: string[];
  model: IoModel;
};

/**
 * Type an `inferredOutputs` id that no tuple array described.
 *
 * A SELECT lists its outputs as output tuples, so anything left over on a
 * CONSTRUCT/DESCRIBE is an RDF graph and on an ASK is a boolean. Anything else
 * stays Unknown rather than being guessed from the IRI.
 */
function classifyInferredOutput(queryType: string | null): IoEntityKind {
  if (queryType === QUERY_TYPE_CONSTRUCT || queryType === QUERY_TYPE_DESCRIBE) return 'TriplesQuadsIO';
  if (queryType === QUERY_TYPE_ASK) return 'BooleanIO';
  return 'Unknown';
}

const inferredLabel = (kind: IoEntityKind): string | null => {
  if (kind === 'TriplesQuadsIO') return 'RDF Graph';
  if (kind === 'BooleanIO') return 'Boolean';
  return null;
};

/**
 * Read a query version's canonical interface out of a `QueryVersionExpanded`.
 * This is the assignment path's entry point.
 */
export function queryVersionInterfaceFromExpanded(expanded: QueryVersionExpanded): QueryVersionInterface | null {
  const version = expanded?.queryVersion;
  if (!version?.id) return null;

  const model = normalizeIoModel(expanded as EntitySource, 'query-version');

  const declaredInputs = (version.inferredInputs ?? []).filter((id): id is string => typeof id === 'string' && !!id);
  const declaredOutputs = (version.inferredOutputs ?? []).filter((id): id is string => typeof id === 'string' && !!id);

  // A version that predates the inferred* arrays still describes its ports via
  // the expanded tuple arrays, so fall back to those rather than reporting a
  // query with no interface at all.
  const inputPortIds = declaredInputs.length
    ? declaredInputs
    : (expanded.inputTuples ?? []).map(t => t?.id).filter((id): id is string => typeof id === 'string');
  const outputPortIds = declaredOutputs.length
    ? declaredOutputs
    : (expanded.outputTuples ?? []).map(t => t?.id).filter((id): id is string => typeof id === 'string');

  const queryType = trimmedOrNull(version.queryType);
  for (const id of outputPortIds) {
    if (model.entities[id]) continue;
    const kind = classifyInferredOutput(queryType);
    model.entities[id] = {
      id,
      kind,
      name: inferredLabel(kind),
      description: null,
      memberEntries: null,
      arity: null,
      origin: 'query-version',
    };
  }

  return {
    versionId: version.id,
    queryType,
    queryString: trimmedOrNull(version.queryString),
    inputPortIds,
    outputPortIds,
    model,
  };
}

/**
 * Read the same interface out of an expanded *group* version, whose flat arrays
 * already carry the referenced query versions' ports. This is the reload path's
 * entry point, and it must agree with the function above.
 */
export function queryVersionInterfacesFromGroup(
  expanded: Pick<QueryGroupVersionExpanded, 'queryVersions'> & EntitySource,
): Record<string, QueryVersionInterface> {
  const model = normalizeIoModel(expanded, 'query-version');
  const interfaces: Record<string, QueryVersionInterface> = {};

  for (const version of expanded.queryVersions ?? []) {
    if (!version?.id) continue;
    const queryType = trimmedOrNull(version.queryType);
    const inputPortIds = (version.inferredInputs ?? []).filter((id): id is string => typeof id === 'string' && !!id);
    const outputPortIds = (version.inferredOutputs ?? []).filter((id): id is string => typeof id === 'string' && !!id);

    const versionModel = emptyIoModel();
    for (const id of [...inputPortIds, ...outputPortIds]) {
      const entity = model.entities[id];
      if (entity) {
        versionModel.entities[id] = entity;
        for (const memberId of entity.memberEntries ?? []) {
          const member = model.members[memberId];
          if (!member) continue;
          versionModel.members[memberId] = member;
          const variable = model.variables[member.variable];
          if (variable) versionModel.variables[variable.id] = variable;
        }
        continue;
      }
      const kind = classifyInferredOutput(queryType);
      versionModel.entities[id] = {
        id,
        kind,
        name: inferredLabel(kind),
        description: null,
        memberEntries: null,
        arity: null,
        origin: 'query-version',
      };
    }

    interfaces[version.id] = {
      versionId: version.id,
      queryType,
      queryString: trimmedOrNull(version.queryString),
      inputPortIds,
      outputPortIds,
      model: versionModel,
    };
  }

  return interfaces;
}

/**
 * Control Flow anchors are runtime handles, not persisted data ports.
 *
 * Nothing mints an entity for them, so they are recognised here as an explicit
 * synthetic descriptor rather than inferred from the IRI the way a data port's
 * type used to be. Control Flow edges themselves carry null endpoint ids; these
 * anchors exist only so the canvas has something to attach a handle to.
 */
const CONTROL_ANCHOR_MARKERS = ['urn:sqlib:control-flow-io:', 'urn:sqlib:control-output:', 'urn:sqlib:control-input:'];

export const isControlFlowAnchor = (id: string): boolean =>
  CONTROL_ANCHOR_MARKERS.some(marker => id.startsWith(marker));

/**
 * Build a port descriptor for a reference.
 *
 * An unbacked reference still produces a port - hidden ports are how an edge
 * ends up with no selectable endpoint - but it is marked unresolved so callers
 * can say why instead of showing an empty list.
 */
export function portFor(
  id: string,
  direction: 'input' | 'output',
  entities: Record<string, IoEntityRecord>,
): GraphPort {
  const entity = entities[id];
  if (!entity) {
    if (isControlFlowAnchor(id)) {
      return { id, label: 'Control flow', entityType: 'ControlFlowIO', direction, origin: 'synthetic', resolved: true };
    }
    return { id, label: id, entityType: 'Unknown', direction, origin: 'unknown', resolved: false };
  }
  return {
    id,
    label: entity.name && entity.name.trim().length > 0 ? entity.name : id,
    entityType: entity.kind,
    direction,
    origin: entity.origin ?? 'unknown',
    resolved: true,
  };
}

/**
 * The ports a node exposes: its query version's canonical interface first, then
 * anything the group additionally declared on the node, in persisted order.
 *
 * Ordering is fixed rather than incidental so that a freshly assigned node and
 * the same node after a save/reload round trip are observationally identical.
 */
export function portsForNode(
  persisted: { inputs?: readonly string[] | null; outputs?: readonly string[] | null },
  entities: Record<string, IoEntityRecord>,
  queryVersion?: QueryVersionInterface | null,
): { inputs: GraphPort[]; outputs: GraphPort[] } {
  const build = (canonical: readonly string[], persistedRefs: readonly string[], direction: 'input' | 'output') => {
    const seen = new Set<string>();
    const ports: GraphPort[] = [];
    for (const id of [...canonical, ...persistedRefs]) {
      if (typeof id !== 'string' || !id || seen.has(id)) continue;
      seen.add(id);
      ports.push(portFor(id, direction, entities));
    }
    return ports;
  };

  return {
    inputs: build(queryVersion?.inputPortIds ?? [], persisted.inputs ?? [], 'input'),
    outputs: build(queryVersion?.outputPortIds ?? [], persisted.outputs ?? [], 'output'),
  };
}

/**
 * The variables a tuple port exposes, in member order.
 *
 * Returns null - not an empty array - when the tuple's members are unknown, so
 * the inspector can tell "this query has no inputs" from "we could not find
 * out what its inputs are".
 */
export function variablesForPort(
  portId: string,
  model: IoModel,
): Array<{ memberId: string; variableId: string; variableName: string }> | null {
  const entity = model.entities[portId];
  if (!entity) return null;
  const memberIds = entity.memberEntries;
  if (!Array.isArray(memberIds)) return null;

  const resolved: Array<{ memberId: string; variableId: string; variableName: string; position: number }> = [];
  for (const memberId of memberIds) {
    const member = model.members[memberId];
    if (!member) return null;
    const variable = model.variables[member.variable];
    if (!variable) return null;
    resolved.push({
      memberId,
      variableId: variable.id,
      variableName: variable.variableName,
      position: member.position,
    });
  }

  return resolved
    .sort((a, b) => a.position - b.position)
    .map(({ memberId, variableId, variableName }) => ({ memberId, variableId, variableName }));
}

/**
 * Drop the ports a query version contributed, keeping everything still in use.
 *
 * Called when a node's query version changes or the node is removed. An entity
 * survives if any other node still names it, which is why this takes the whole
 * node list rather than just the node being changed.
 */
export function pruneUnreferencedEntities(
  entities: Record<string, IoEntityRecord>,
  stillReferenced: Iterable<string>,
): Record<string, IoEntityRecord> {
  const keep = new Set(stillReferenced);
  const next: Record<string, IoEntityRecord> = {};
  for (const [id, entity] of Object.entries(entities)) {
    // Group-owned and author-declared entities outlive any single node: a
    // boundary tuple with no edge yet is still the group's declared interface.
    if (keep.has(id) || entity.origin === 'query-group' || entity.origin === 'synthetic') {
      next[id] = entity;
    }
  }
  return next;
}
