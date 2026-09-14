import { ref } from 'vue';
import { ZodError } from 'zod';
import {
  queryGroupVersionForGroupCreateSchema,
  type QueryGroupVersionExpanded,
  type QueryGroupVersionExpandedWithIriMap,
  type QueryGroupVersionForGroupCreateInput,
  type QueryVersionExpanded,
} from '@sparql-query-lib/contracts';
import type { TupleDefinition, TupleEditorUpdatePayload } from '../types/tuple-editor';
import type {
  UseQueryGroupIODeps,
  UseQueryGroupIOResult,
  NormalizedStartTuplePayload,
  TupleMemberDraft,
  InputTupleDraft,
  OutputTupleDraft,
  InputVariableDraft,
  OutputVariableDraft,
  TriplesQuadsDraft,
  BooleanDraft,
  QueryIdInputDraft,
  MapRef,
} from './queryGroupTypes';

const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema#';
const XSD_ANY_URI = `${XSD_NAMESPACE}anyURI`;

const SHORT_TO_XSD: Record<string, string> = {
  'xsd:anyURI': XSD_ANY_URI,
  'xsd:string': `${XSD_NAMESPACE}string`,
  'xsd:integer': `${XSD_NAMESPACE}integer`,
  'xsd:int': `${XSD_NAMESPACE}int`,
  'xsd:decimal': `${XSD_NAMESPACE}decimal`,
  'xsd:double': `${XSD_NAMESPACE}double`,
  'xsd:float': `${XSD_NAMESPACE}float`,
  'xsd:boolean': `${XSD_NAMESPACE}boolean`,
  'xsd:date': `${XSD_NAMESPACE}date`,
  'xsd:dateTime': `${XSD_NAMESPACE}dateTime`,
  'xsd:time': `${XSD_NAMESPACE}time`,
};

const XSD_TO_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(SHORT_TO_XSD).map(([short, iri]) => [iri, short]),
);

const SHORT_TO_XSD_LOOKUP = new Map<string, string>(
  Object.entries(SHORT_TO_XSD).map(([short, iri]) => [short.toLowerCase(), iri]),
);

const LEGACY_IRI_TOKENS = new Set(['iri', 'uri', 'anyuri']);

const appearsToBeIri = (value: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(value.trim());

const canonicalizeAllowedType = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();

  if (LEGACY_IRI_TOKENS.has(lower)) {
    return XSD_ANY_URI;
  }

  const fromShort = SHORT_TO_XSD_LOOKUP.get(lower);
  if (fromShort) {
    return fromShort;
  }

  if (!trimmed.includes(':') && SHORT_TO_XSD_LOOKUP.has(`xsd:${lower}`)) {
    return SHORT_TO_XSD_LOOKUP.get(`xsd:${lower}`) ?? null;
  }

  if (XSD_TO_SHORT[trimmed]) {
    return trimmed;
  }

  if (appearsToBeIri(trimmed)) {
    return trimmed;
  }

  return trimmed;
};

const trimToNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const stripVariablePrefix = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('?') || trimmed.startsWith('$')) {
    return trimmed.slice(1);
  }
  return trimmed;
};

const formatVariableDisplayName = (value: string | null | undefined): string => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('?') || trimmed.startsWith('$')) {
    return `?${trimmed.slice(1)}`;
  }
  return `?${trimmed}`;
};

const mapAllowedTypesToUi = (allowedTypes?: string[] | null) => {
  const first = allowedTypes?.find((entry) => entry && entry.trim().length > 0) ?? null;
  const canonical = canonicalizeAllowedType(first);

  if (!canonical || canonical === XSD_ANY_URI) {
    return {
      nodeKind: 'iri' as const,
      datatype: 'xsd:string',
    };
  }

  const short = XSD_TO_SHORT[canonical];
  if (short) {
    return {
      nodeKind: 'literal' as const,
      datatype: short,
    };
  }

  return {
    nodeKind: 'literal' as const,
    datatype: 'custom',
    customDatatype: canonical,
  };
};

// Vue's ref() unwraps nested refs in generic T, which types the result as
// Ref<Map<string, UnwrapRefSimple<T>> & ...> — not the plain Map<string, T> the
// rest of this module expects. The drafts stored here are plain objects, never
// refs, so the runtime value matches MapRef<string, T> exactly.
const createMapRef = <T>(): MapRef<string, T> => ref(new Map<string, T>()) as MapRef<string, T>;

const replaceMapContents = <T>(mapRef: MapRef<string, T>, entries: Iterable<[string, T]>) => {
  const map = mapRef.value;
  map.clear();
  for (const [key, value] of entries) {
    map.set(key, value);
  }
};

const cloneDraft = <T extends Record<string, unknown>>(draft: T): T => {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (value === undefined) continue;
    clone[key] = Array.isArray(value) ? [...value] : value;
  }
  return clone as T;
};

const mapToArray = <T extends Record<string, unknown>>(mapRef: MapRef<string, T>): T[] =>
  Array.from(mapRef.value.values()).map(value => cloneDraft(value));

const normalizeNullableString = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const ensureUrnId = (value: string | null | undefined, kind: string, index: number): string => {
  if (value && value.startsWith('urn:')) {
    return value;
  }
  const base = value && value.trim().length > 0 ? value.trim() : `${index + 1}`;
  const sanitized = base.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/--+/g, '-');
  return `urn:ui-temp:${kind}-${sanitized}`;
};

/**
 * A temp id for a row the author just added.
 *
 * The index alone is not enough: it was, and adding a row after removing an
 * earlier one then reused the id a surviving row still held - two start-node
 * ports with one id, sharing whichever `ioEntities` entry wrote last. So the
 * counter walks past anything already taken instead of trusting position.
 */
const mintTempId = (kind: string, taken: (candidate: string) => boolean): string => {
  for (let index = 0; ; index++) {
    const candidate = ensureUrnId(null, kind, index);
    if (!taken(candidate)) {
      return candidate;
    }
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const toInputVariableDraft = (input: unknown): InputVariableDraft | null => {
  const rec = asRecord(input);
  if (!rec || typeof rec.id !== 'string') {
    return null;
  }
  const variableName = typeof rec.variableName === 'string' && rec.variableName.trim().length > 0
    ? rec.variableName
    : rec.id;
  const allowedTypes = Array.isArray(rec.allowedTypes)
    ? rec.allowedTypes
        .map((entry: unknown) => typeof entry === 'string' ? canonicalizeAllowedType(entry) : null)
        .filter((entry): entry is string => entry !== null && appearsToBeIri(entry))
    : [];
  const draft: InputVariableDraft = {
    id: rec.id,
    variableName,
  };
  if (allowedTypes.length > 0) {
    draft.allowedTypes = allowedTypes;
  }
  return draft;
};

const toOutputVariableDraft = (output: unknown): OutputVariableDraft | null => {
  const rec = asRecord(output);
  if (!rec || typeof rec.id !== 'string') {
    return null;
  }
  const variableName = typeof rec.variableName === 'string' && rec.variableName.trim().length > 0
    ? rec.variableName
    : rec.id;
  const draft: OutputVariableDraft = {
    id: rec.id,
    variableName,
  };
  if (typeof rec.description === 'string' && rec.description.trim().length > 0) {
    draft.description = rec.description;
  }
  return draft;
};

const toInputTupleDraft = (tuple: unknown): InputTupleDraft | null => {
  const rec = asRecord(tuple);
  if (!rec || typeof rec.id !== 'string') {
    return null;
  }
  const memberEntries = Array.isArray(rec.memberEntries)
    ? rec.memberEntries.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  return {
    id: rec.id,
    name: typeof rec.name === 'string' && rec.name.trim().length > 0 ? rec.name : null,
    memberEntries,
  };
};

const toOutputTupleDraft = (tuple: unknown): OutputTupleDraft | null => {
  const rec = asRecord(tuple);
  if (!rec || typeof rec.id !== 'string') {
    return null;
  }
  const memberEntries = Array.isArray(rec.memberEntries)
    ? rec.memberEntries.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const draft: OutputTupleDraft = {
    id: rec.id,
    name: typeof rec.name === 'string' && rec.name.trim().length > 0 ? rec.name : '',
    memberEntries,
  };
  return draft;
};

const toTupleMemberDraft = (member: unknown): TupleMemberDraft | null => {
  const rec = asRecord(member);
  if (!rec || typeof rec.id !== 'string') {
    return null;
  }
  if (typeof rec.variable !== 'string') {
    return null;
  }
  return {
    id: rec.id,
    position: typeof rec.position === 'number' ? rec.position : 0,
    variable: rec.variable,
  };
};

const toTriplesQuadsDraft = (io: unknown): TriplesQuadsDraft | null => {
  const rec = asRecord(io);
  if (!rec || typeof rec.id !== 'string') {
    return null;
  }
  const draft: TriplesQuadsDraft = {
    id: rec.id,
    name: typeof rec.name === 'string' && rec.name.trim().length > 0 ? rec.name : null,
    description: typeof rec.description === 'string' && rec.description.trim().length > 0 ? rec.description : null,
    ioType: typeof rec.ioType === 'string' && rec.ioType.trim().length > 0 ? rec.ioType : null,
    outputType: typeof rec.outputType === 'string' && rec.outputType.trim().length > 0 ? rec.outputType : null,
  };
  return draft;
};

const toBooleanDraft = (io: unknown): BooleanDraft | null => {
  const rec = asRecord(io);
  if (!rec || typeof rec.id !== 'string') {
    return null;
  }
  const draft: BooleanDraft = {
    id: rec.id,
    name: typeof rec.name === 'string' && rec.name.trim().length > 0 ? rec.name : null,
    description: typeof rec.description === 'string' && rec.description.trim().length > 0 ? rec.description : null,
  };
  return draft;
};

const toQueryIdInputDraft = (input: unknown): QueryIdInputDraft | null => {
  const rec = asRecord(input);
  if (!rec || typeof rec.id !== 'string') {
    return null;
  }
  const draft: QueryIdInputDraft = {
    id: rec.id,
    name: typeof rec.name === 'string' && rec.name.trim().length > 0 ? rec.name : null,
    description: typeof rec.description === 'string' && rec.description.trim().length > 0 ? rec.description : null,
    isPartOf: typeof rec.isPartOf === 'string' && rec.isPartOf.trim().length > 0 ? rec.isPartOf : null,
  };
  return draft;
};

export function useQueryGroupIO(deps: UseQueryGroupIODeps): UseQueryGroupIOResult {
  const { graph, toast, logger = console } = deps;

  const inputTuples = ref<TupleDefinition[]>([]);

  const tupleMembers = createMapRef<TupleMemberDraft>();
  const inputTupleDrafts = createMapRef<InputTupleDraft>();
  const outputTupleDrafts = createMapRef<OutputTupleDraft>();
  const inputVariableDrafts = createMapRef<InputVariableDraft>();
  const outputVariableDrafts = createMapRef<OutputVariableDraft>();
  const rdfOutputDrafts = createMapRef<TriplesQuadsDraft>();
  const booleanOutputDrafts = createMapRef<BooleanDraft>();
  const queryIdInputDrafts = createMapRef<QueryIdInputDraft>();

  const startTupleIds = ref<Set<string>>(new Set());
  const startTupleMemberIds = ref<Set<string>>(new Set());
  const startInputIds = ref<Set<string>>(new Set());

  const ioDraftStore = {
    tupleMembers,
    inputTuples: inputTupleDrafts,
    outputTuples: outputTupleDrafts,
    inputs: inputVariableDrafts,
    outputs: outputVariableDrafts,
    rdfOutputs: rdfOutputDrafts,
    booleanOutputs: booleanOutputDrafts,
    queryIdInputs: queryIdInputDrafts,
  };

  const resetDrafts = () => {
    tupleMembers.value.clear();
    inputTupleDrafts.value.clear();
    outputTupleDrafts.value.clear();
    inputVariableDrafts.value.clear();
    outputVariableDrafts.value.clear();
    rdfOutputDrafts.value.clear();
    booleanOutputDrafts.value.clear();
    queryIdInputDrafts.value.clear();
    startTupleIds.value = new Set();
    startTupleMemberIds.value = new Set();
    startInputIds.value = new Set();
    inputTuples.value = [];
  };

  const resetStartTuples = () => {
    inputTuples.value = [];
  };

  const updateStartDraftEntities = (payload: NormalizedStartTuplePayload) => {
    for (const id of startTupleIds.value) {
      inputTupleDrafts.value.delete(id);
    }
    for (const id of startTupleMemberIds.value) {
      tupleMembers.value.delete(id);
    }
    for (const id of startInputIds.value) {
      inputVariableDrafts.value.delete(id);
    }

    const tupleIdSet = new Set<string>();
    payload.inputTuples.forEach(tuple => {
      inputTupleDrafts.value.set(tuple.id, {
        ...tuple,
        memberEntries: [...tuple.memberEntries],
      });
      tupleIdSet.add(tuple.id);
    });
    startTupleIds.value = tupleIdSet;

    const memberIdSet = new Set<string>();
    payload.tupleMembers.forEach(member => {
      tupleMembers.value.set(member.id, { ...member });
      memberIdSet.add(member.id);
    });
    startTupleMemberIds.value = memberIdSet;

    const inputIdSet = new Set<string>();
    payload.inputs.forEach(input => {
      const draft: InputVariableDraft = {
        ...input,
      };
      if (input.allowedTypes) {
        draft.allowedTypes = [...input.allowedTypes];
      }
      inputVariableDrafts.value.set(input.id, draft);
      inputIdSet.add(input.id);
    });
    startInputIds.value = inputIdSet;
  };

  const resolveAllowedTypesForVariable = (
    tupleIndex: number,
    variableIndex: number,
    variable: TupleDefinition['variables'][number],
  ): { allowedTypes?: string[]; error?: string } => {
    // For MVP: Don't populate allowedTypes - keep inputs unconstrained
    // Later: Add UI for users to specify type constraints
    // Note: nodeKind (iri/literal) and datatype are semantically distinct
    // and should be modeled separately in the future
    return { allowedTypes: undefined };
  };

  const normalizeStartTuples = (): NormalizedStartTuplePayload => {
    const startNode = graph.currentGraphState.value.nodes.find((node) => node.kind === 'start');
    if (!startNode) {
      throw new Error('Start node is missing from the canvas.');
    }

    const previousOutputIds = new Set(startNode.outputs.map((port) => port.id));

    const updatedTuples: TupleDefinition[] = [];
    const tupleMemberPayloads: NormalizedStartTuplePayload['tupleMembers'] = [];
    const inputTuplePayloads: NormalizedStartTuplePayload['inputTuples'] = [];
    const inputVariableMap = new Map<string, { id: string; variableName: string; allowedTypes?: string[] }>();
    const newPorts: Array<{
      id: string;
      label: string;
      entityType: 'QueryInputTuple';
      direction: 'output';
      origin: 'query-group';
      resolved: true;
    }> = [];

    for (let tupleIndex = 0; tupleIndex < inputTuples.value.length; tupleIndex++) {
      const tuple = inputTuples.value[tupleIndex];
      const tupleLabel = trimToNull(tuple.label);
      const tupleId = ensureUrnId(tuple.id ?? tupleLabel ?? null, 'input-tuple', tupleIndex);

      const updatedVariables: TupleDefinition['variables'] = [];
      const memberIds: string[] = [];

      for (let varIndex = 0; varIndex < tuple.variables.length; varIndex++) {
        const variable = tuple.variables[varIndex];
        const baseName = stripVariablePrefix(variable.name ?? '');
        const fallbackName = baseName.length > 0 ? baseName : `var${tupleIndex + 1}_${varIndex + 1}`;
        const displayName = formatVariableDisplayName(fallbackName);
        const variableId = ensureUrnId(variable.id ?? fallbackName ?? null, 'input', tupleIndex * 100 + varIndex);
        const memberId = ensureUrnId(
          variable.memberId ?? `${tupleId}-member-${varIndex + 1}`,
          'tuple-member',
          tupleIndex * 100 + varIndex,
        );

        const { allowedTypes, error } = resolveAllowedTypesForVariable(tupleIndex, varIndex, variable);
        if (error) {
          throw new Error(error);
        }

        const existingVariable = inputVariableMap.get(variableId);
        if (!existingVariable) {
          const payload: { id: string; variableName: string; allowedTypes?: string[] } = {
            id: variableId,
            variableName: fallbackName,
          };
          if (allowedTypes && allowedTypes.length > 0) {
            payload.allowedTypes = allowedTypes;
          }
          inputVariableMap.set(variableId, payload);
        } else if (allowedTypes && allowedTypes.length > 0) {
          existingVariable.allowedTypes = allowedTypes;
        }

        tupleMemberPayloads.push({
          id: memberId,
          position: varIndex,
          variable: variableId,
        });

        memberIds.push(memberId);

        const canonicalForUi = allowedTypes && allowedTypes.length > 0 ? allowedTypes[0] : null;
        let normalizedDatatype = variable.datatype;
        let normalizedCustomDatatype = variable.customDatatype;

        if (variable.nodeKind === 'literal' && variable.datatype === 'custom' && canonicalForUi) {
          normalizedCustomDatatype = canonicalForUi;
        }

        updatedVariables.push({
          ...variable,
          id: variableId,
          memberId,
          name: displayName,
          datatype: normalizedDatatype,
          customDatatype: normalizedCustomDatatype,
        });
      }

      inputTuplePayloads.push({
        id: tupleId,
        name: tupleLabel,
        memberEntries: memberIds,
      });

      updatedTuples.push({
        id: tupleId,
        label: tupleLabel,
        variables: updatedVariables,
      });

      newPorts.push({
        id: tupleId,
        label: tupleLabel ?? tupleId,
        entityType: 'QueryInputTuple',
        direction: 'output',
        origin: 'query-group',
        resolved: true,
      });
    }

    // A start node's ports are not all tuples: it also carries the group's data
    // graph inputs, which are declared as RDF ports and edited elsewhere. This
    // function owns the tuple half only, so the rest is carried through
    // untouched - rewriting `outputs` wholesale would delete a data graph input
    // every time the author saved a tuple.
    const preservedPorts = startNode.outputs.filter((port) => port.entityType !== 'QueryInputTuple');
    const nextOutputs = [...newPorts, ...preservedPorts];
    const newTupleIdSet = new Set(nextOutputs.map((port) => port.id));

    inputTuples.value = updatedTuples;

    graph.updateGraphNodeState(startNode.id, (node) => ({
      ...node,
      outputs: nextOutputs,
    }));

    const updatedIoEntities: typeof graph.currentGraphState.value.ioEntities = {
      ...graph.currentGraphState.value.ioEntities,
    };
    // A boundary tuple the author removed goes, unless some other node still
    // declares it as a port - dropping it then would blank that node instead.
    const referencedElsewhere = new Set<string>();
    for (const node of graph.currentGraphState.value.nodes) {
      if (node.id === startNode.id) continue;
      for (const port of [...node.inputs, ...node.outputs]) referencedElsewhere.add(port.id);
    }
    for (const portId of previousOutputIds) {
      if (!newTupleIdSet.has(portId) && !referencedElsewhere.has(portId)) {
        delete updatedIoEntities[portId];
      }
    }

    newPorts.forEach((port, index) => {
      const tuple = updatedTuples[index];
      const tuplePayload = inputTuplePayloads[index];
      updatedIoEntities[port.id] = {
        id: port.id,
        kind: 'QueryInputTuple',
        name: tuple.label ?? null,
        description: null,
        memberEntries: tuplePayload.memberEntries,
        arity: tuplePayload.memberEntries.length,
        // The group's declared interface: authored here, owned by the group.
        origin: 'query-group',
      };
    });

    const payload: NormalizedStartTuplePayload = {
      inputs: Array.from(inputVariableMap.values()),
      tupleMembers: tupleMemberPayloads,
      inputTuples: inputTuplePayloads,
    };

    // The members and variables go into the same normalized model the loaded
    // graph uses, so the inspector can name a boundary tuple's columns whether
    // the author just typed them or the group was reloaded from the API.
    const updatedMembers = { ...graph.currentGraphState.value.tupleMembers };
    for (const member of payload.tupleMembers) {
      updatedMembers[member.id] = { id: member.id, position: member.position, variable: member.variable };
    }
    const updatedVariables = { ...graph.currentGraphState.value.variables };
    for (const input of payload.inputs) {
      updatedVariables[input.id] = {
        id: input.id,
        variableName: input.variableName,
        direction: 'input',
        allowedTypes: input.allowedTypes ?? null,
      };
    }

    graph.currentGraphState.value = {
      ...graph.currentGraphState.value,
      ioEntities: updatedIoEntities,
      tupleMembers: updatedMembers,
      variables: updatedVariables,
    };

    updateStartDraftEntities(payload);
    return payload;
  };

  const populateStartTuplesFromExpanded = (expanded: QueryGroupVersionExpanded) => {
    const startOutputs = expanded.startNode?.outputs ?? [];
    if (!startOutputs.length) {
      inputTuples.value = [];
      return;
    }

    const tupleMap = new Map(
      (expanded.inputTuples ?? []).map((tuple) => [tuple.id, tuple]),
    );
    const memberMap = new Map(
      (expanded.tupleMembers ?? []).map((member) => [member.id, member]),
    );
    const inputVarMap = new Map(
      (expanded.inputs ?? []).map((input) => [input.id, input]),
    );

    const tuples: TupleDefinition[] = [];

    for (const tupleId of startOutputs) {
      const tupleEntity = tupleMap.get(tupleId);
      if (!tupleEntity) {
        continue;
      }

      const memberIds = (tupleEntity.memberEntries ?? []).filter((id): id is string => typeof id === 'string');
      const sortedMembers = memberIds
        .map((id) => memberMap.get(id))
        .filter((member): member is NonNullable<typeof member> => !!member)
        .sort((a, b) => {
          const posA = typeof a.position === 'number' ? a.position : 0;
          const posB = typeof b.position === 'number' ? b.position : 0;
          return posA - posB;
        });

      const variables = sortedMembers.map((member) => {
        const variableEntity = inputVarMap.get(member.variable);
        const uiState = mapAllowedTypesToUi(variableEntity?.allowedTypes ?? null);
        return {
          id: variableEntity?.id ?? member.variable,
          memberId: member.id,
          name: formatVariableDisplayName(variableEntity?.variableName ?? ''),
          nodeKind: uiState.nodeKind,
          datatype: uiState.datatype,
          customDatatype: uiState.customDatatype,
        };
      });

      tuples.push({
        id: tupleEntity.id,
        label: tupleEntity.name ?? null,
        variables,
      });
    }

    inputTuples.value = tuples;
  };

  /*
   * Takes the plain expansion, not the with-iri-map one. It reads no `iriMap`,
   * and `GET /query-groups/:id/v/:version` returns a payload where that field
   * is optional — so demanding it described a caller that does not exist.
   */
  const populateFromExpanded = (expanded: QueryGroupVersionExpanded) => {
    replaceMapContents(
      inputVariableDrafts,
      (expanded.inputs ?? [])
        .map(toInputVariableDraft)
        .filter((entry): entry is InputVariableDraft => entry !== null)
        .map(entry => [entry.id as string, entry]),
    );

    replaceMapContents(
      outputVariableDrafts,
      (expanded.outputs ?? [])
        .map(toOutputVariableDraft)
        .filter((entry): entry is OutputVariableDraft => entry !== null)
        .map(entry => [entry.id as string, entry]),
    );

    replaceMapContents(
      inputTupleDrafts,
      (expanded.inputTuples ?? [])
        .map(toInputTupleDraft)
        .filter((entry): entry is InputTupleDraft => entry !== null)
        .map(entry => [entry.id as string, entry]),
    );

    replaceMapContents(
      outputTupleDrafts,
      (expanded.outputTuples ?? [])
        .map(toOutputTupleDraft)
        .filter((entry): entry is OutputTupleDraft => entry !== null)
        .map(entry => [entry.id as string, entry]),
    );

    replaceMapContents(
      tupleMembers,
      (expanded.tupleMembers ?? [])
        .map(toTupleMemberDraft)
        .filter((entry): entry is TupleMemberDraft => entry !== null)
        .map(entry => [entry.id as string, entry]),
    );

    replaceMapContents(
      rdfOutputDrafts,
      (expanded.rdfOutputs ?? [])
        .map(toTriplesQuadsDraft)
        .filter((entry): entry is TriplesQuadsDraft => entry !== null)
        .map(entry => [entry.id as string, entry]),
    );

    replaceMapContents(
      booleanOutputDrafts,
      (expanded.booleanOutputs ?? [])
        .map(toBooleanDraft)
        .filter((entry): entry is BooleanDraft => entry !== null)
        .map(entry => [entry.id as string, entry]),
    );

    replaceMapContents(
      queryIdInputDrafts,
      (expanded.queryIdInputs ?? [])
        .map(toQueryIdInputDraft)
        .filter((entry): entry is QueryIdInputDraft => entry !== null)
        .map(entry => [entry.id as string, entry]),
    );

    const startOutputIds = new Set(
      Array.isArray(expanded.startNode?.outputs)
        ? expanded.startNode.outputs.filter((id): id is string => typeof id === 'string')
        : [],
    );
    startTupleIds.value = startOutputIds;

    const tupleToMembers = new Map<string, string[]>();
    for (const tuple of expanded.inputTuples ?? []) {
      if (typeof tuple.id === 'string' && Array.isArray(tuple.memberEntries)) {
        tupleToMembers.set(tuple.id, tuple.memberEntries.filter((id): id is string => typeof id === 'string'));
      }
    }

    const memberIds = new Set<string>();
    for (const tupleId of startOutputIds) {
      const members = tupleToMembers.get(tupleId) ?? [];
      members.forEach(memberId => memberIds.add(memberId));
    }
    startTupleMemberIds.value = memberIds;

    const inputIds = new Set<string>();
    for (const member of expanded.tupleMembers ?? []) {
      if (member && memberIds.has(member.id) && typeof member.variable === 'string') {
        inputIds.add(member.variable);
      }
    }
    startInputIds.value = inputIds;

    populateStartTuplesFromExpanded(expanded);
  };

  /**
   * Every id a boundary tuple could collide with: the editor's own rows, the
   * start node's ports (a tuple removed from the editor is removed from both,
   * but a port the group declared elsewhere is not) and the typed entities.
   */
  const tupleIdInUse = (candidate: string): boolean => {
    if (inputTuples.value.some((tuple) => tuple.id === candidate)) return true;
    if (graph.currentGraphState.value.ioEntities[candidate]) return true;
    return graph.currentGraphState.value.nodes.some((node) =>
      [...node.inputs, ...node.outputs].some((port) => port.id === candidate),
    );
  };

  /** The same question for a tuple member, over the rows and the normalized model. */
  const memberIdInUse = (candidate: string): boolean => {
    if (inputTuples.value.some((tuple) => tuple.variables.some((variable) => variable.memberId === candidate))) {
      return true;
    }
    if (graph.currentGraphState.value.tupleMembers[candidate]) return true;
    return Object.values(graph.currentGraphState.value.ioEntities).some((entity) =>
      (entity.memberEntries ?? []).includes(candidate),
    );
  };

  const tupleEditor = {
    addTuple: () => {
      const tupleIndex = inputTuples.value.length;
      const tempId = mintTempId('input-tuple-temp', tupleIdInUse);

      inputTuples.value.push({
        id: tempId,
        variables: [],
      });

      // Immediately make the tuple available for edge selection
      const startNode = graph.currentGraphState.value.nodes.find((node) => node.kind === 'start');
      if (startNode) {
        const newPort = {
          id: tempId,
          label: `Tuple ${tupleIndex + 1}`,
          entityType: 'QueryInputTuple' as const,
          direction: 'output' as const,
          origin: 'query-group' as const,
          resolved: true as const,
        };

        // Update both nodes and ioEntities in a single atomic state update for proper reactivity
        const updatedNodes = graph.currentGraphState.value.nodes.map((node) =>
          node.id === startNode.id
            ? { ...node, outputs: [...node.outputs, newPort] }
            : node
        );

        const newIoEntity = {
          id: tempId,
          kind: 'QueryInputTuple' as const,
          name: null,
          description: null,
          // A tuple the author just added really has no members yet: arity 0,
          // not unknown.
          memberEntries: [],
          arity: 0,
          origin: 'query-group' as const,
        };

        graph.currentGraphState.value = {
          ...graph.currentGraphState.value,
          nodes: updatedNodes,
          ioEntities: {
            ...graph.currentGraphState.value.ioEntities,
            [tempId]: newIoEntity,
          },
        };
      } else {
        console.warn('[addTuple] Start node not found!');
      }
    },
    removeTuple: (tupleIndex: number) => {
      const tuple = inputTuples.value[tupleIndex];
      if (!tuple) {
        return;
      }

      const tupleId = tuple.id;
      inputTuples.value.splice(tupleIndex, 1);

      // Remove from start node outputs and ioEntities
      if (tupleId) {
        const startNode = graph.currentGraphState.value.nodes.find((node) => node.kind === 'start');
        if (startNode) {
          // Update both nodes and ioEntities in a single atomic state update for proper reactivity
          const updatedNodes = graph.currentGraphState.value.nodes.map((node) =>
            node.id === startNode.id
              ? { ...node, outputs: node.outputs.filter((port) => port.id !== tupleId) }
              : node
          );

          const updatedIoEntities = { ...graph.currentGraphState.value.ioEntities };
          delete updatedIoEntities[tupleId];

          graph.currentGraphState.value = {
            ...graph.currentGraphState.value,
            nodes: updatedNodes,
            ioEntities: updatedIoEntities,
          };
        }
      }
    },
    addVariable: (tupleIndex: number) => {
      const tuple = inputTuples.value[tupleIndex];
      if (!tuple) {
        return;
      }

      const tempMemberId = mintTempId('tuple-member-temp', memberIdInUse);

      tuple.variables.push({
        id: undefined,
        memberId: tempMemberId,
        name: '',
        nodeKind: 'iri',
        datatype: 'xsd:string',
      });

      // Update memberEntries in ioEntities
      if (tuple.id) {
        const ioEntity = graph.currentGraphState.value.ioEntities[tuple.id];
        if (ioEntity) {
          const updatedMemberEntries = [...(ioEntity.memberEntries ?? []), tempMemberId];
          graph.currentGraphState.value = {
            ...graph.currentGraphState.value,
            ioEntities: {
              ...graph.currentGraphState.value.ioEntities,
              [tuple.id]: {
                ...ioEntity,
                memberEntries: updatedMemberEntries,
                arity: updatedMemberEntries.length,
              },
            },
          };
        }
      }
    },
    removeVariable: (tupleIndex: number, variableIndex: number) => {
      const tuple = inputTuples.value[tupleIndex];
      if (!tuple) {
        return;
      }

      const removedVariable = tuple.variables[variableIndex];
      tuple.variables.splice(variableIndex, 1);

      // Update memberEntries in ioEntities
      if (tuple.id && removedVariable?.memberId) {
        const ioEntity = graph.currentGraphState.value.ioEntities[tuple.id];
        if (ioEntity && ioEntity.memberEntries) {
          const updatedMemberEntries = ioEntity.memberEntries.filter(
            (id) => id !== removedVariable.memberId
          );
          graph.currentGraphState.value = {
            ...graph.currentGraphState.value,
            ioEntities: {
              ...graph.currentGraphState.value.ioEntities,
              [tuple.id]: {
                ...ioEntity,
                memberEntries: updatedMemberEntries,
                arity: updatedMemberEntries.length,
              },
            },
          };
        }
      }
    },
    updateVariable: ({ tupleIndex, variableIndex, field, value }: TupleEditorUpdatePayload) => {
      const tuple = inputTuples.value[tupleIndex];
      if (!tuple) {
        return;
      }
      const variable = tuple.variables[variableIndex];
      if (!variable) {
        return;
      }

      switch (field) {
        case 'name':
          variable.name = value;
          break;
        case 'nodeKind':
          variable.nodeKind = value === 'literal' ? 'literal' : 'iri';
          if (variable.nodeKind === 'iri') {
            variable.datatype = 'xsd:string';
            delete variable.customDatatype;
          } else if (variable.datatype == null || variable.datatype === '') {
            variable.datatype = 'xsd:string';
          }
          break;
        case 'datatype':
          variable.datatype = value;
          if (value !== 'custom') {
            delete variable.customDatatype;
          }
          break;
        case 'customDatatype':
          variable.customDatatype = value;
          break;
      }
    },
    saveStartInputs: () => {
      for (let i = 0; i < inputTuples.value.length; i++) {
        const tuple = inputTuples.value[i];
        if (tuple.variables.length === 0) {
          toast.error(`Tuple ${i + 1} has no variables`);
          return;
        }
        for (let j = 0; j < tuple.variables.length; j++) {
          const variable = tuple.variables[j];
          if (!variable.name || !variable.name.trim()) {
            toast.error(`Tuple ${i + 1}, Variable ${j + 1}: Name is required`);
            return;
          }
          if (variable.nodeKind === 'literal' && variable.datatype === 'custom' && !variable.customDatatype?.trim()) {
            toast.error(`Tuple ${i + 1}, Variable ${j + 1}: Custom datatype IRI is required`);
            return;
          }
        }
      }

      try {
        normalizeStartTuples();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to save start node inputs';
        toast.error(message);
        return;
      }

      toast.success('Start node inputs saved');
    },
  };

  const ingestQueryVersionDrafts = (queryVersion: QueryVersionExpanded) => {
    if (Array.isArray(queryVersion.inputs)) {
      for (const variable of queryVersion.inputs) {
        const draft = toInputVariableDraft(variable);
        if (draft?.id) {
          inputVariableDrafts.value.set(draft.id, draft);
        }
      }
    }
    if (Array.isArray(queryVersion.outputs)) {
      for (const output of queryVersion.outputs) {
        const draft = toOutputVariableDraft(output);
        if (draft?.id) {
          outputVariableDrafts.value.set(draft.id, draft);
        }
      }
    }
    if (Array.isArray(queryVersion.inputTuples)) {
      for (const tuple of queryVersion.inputTuples) {
        const draft = toInputTupleDraft(tuple);
        if (draft?.id) {
          inputTupleDrafts.value.set(draft.id, draft);
        }
      }
    }
    if (Array.isArray(queryVersion.outputTuples)) {
      for (const tuple of queryVersion.outputTuples) {
        const draft = toOutputTupleDraft(tuple);
        if (draft?.id) {
          outputTupleDrafts.value.set(draft.id, draft);
        }
      }
    }
    if (Array.isArray(queryVersion.tupleMembers)) {
      for (const member of queryVersion.tupleMembers) {
        const draft = toTupleMemberDraft(member);
        if (draft?.id) {
          tupleMembers.value.set(draft.id, draft);
        }
      }
    }
    // A QueryVersion expansion has no rdfOutputs / booleanOutputs /
    // queryIdInputs arrays - it reports inferred ports as `inferredOutputs`
    // ids - so the loops that used to read them here could never run. Removed
    // rather than rewritten: those ports are declared on the group's nodes, and
    // populateFromExpanded already ingests them from the group version.
  };

  const buildVersionCreatePayload = ({ versionComment }: { versionComment: string | null }): QueryGroupVersionForGroupCreateInput => {
    const state = graph.currentGraphState.value;
    const currentStartNode = state.nodes.find((node) => node.kind === 'start') ?? null;
    const currentEndNode = state.nodes.find((node) => node.kind === 'end') ?? null;

    if (!currentStartNode) {
      throw new Error('Canvas is missing a start node.');
    }
    if (!currentEndNode) {
      throw new Error('Canvas is missing an end node.');
    }

    let normalizedStart: NormalizedStartTuplePayload;
    try {
      normalizedStart = normalizeStartTuples();
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to normalize start node tuples.');
    }

    const refreshedState = graph.currentGraphState.value;

    const flat = graph.toFlatPayload();

    const startNode = refreshedState.nodes.find((node) => node.kind === 'start');
    const endNode = refreshedState.nodes.find((node) => node.kind === 'end');

    if (!startNode || !endNode) {
      throw new Error('Canvas is missing required boundary nodes.');
    }

    const nodeIdMap = new Map<string, string>();
    nodeIdMap.set(startNode.id, 'urn:__START__');
    nodeIdMap.set(endNode.id, 'urn:__END__');
    nodeIdMap.set('urn:__START__', 'urn:__START__');
    nodeIdMap.set('urn:__END__', 'urn:__END__');

    const portIdMap = new Map<string, string>();
    let portCounter = 0;
    const mapPortId = (original: string | null | undefined): string | undefined => {
      if (!original) {
        return undefined;
      }
      if (original.startsWith('urn:')) {
        return original;
      }
      const existing = portIdMap.get(original);
      if (existing) {
        return existing;
      }
      const minted = ensureUrnId(original, 'io', portCounter++);
      portIdMap.set(original, minted);
      return minted;
    };

    const executionNodes = flat.executionNodes.map((node, index) => {
      const normalizedId = ensureUrnId(node.id ?? null, 'node', index);
      nodeIdMap.set(node.id ?? normalizedId, normalizedId);

      const normalizedInputs = (node.inputs ?? [])
        .map(inputId => mapPortId(inputId))
        .filter((id): id is string => !!id);

      const normalizedOutputs = (node.outputs ?? [])
        .map(outputId => mapPortId(outputId))
        .filter((id): id is string => !!id);

      if (node.nodeType === 'RuleSetNode') {
        const ruleSetVersion = node.ruleSetVersion?.trim();
        if (!ruleSetVersion) {
          throw new Error(`RuleSet node ${normalizedId} is missing a ruleSetVersion.`);
        }
        if (normalizedInputs.length === 0) {
          throw new Error(`RuleSet node ${normalizedId} must declare at least one RDF input port.`);
        }
        if (normalizedOutputs.length === 0) {
          throw new Error(`RuleSet node ${normalizedId} must declare at least one RDF output port.`);
        }
        return {
          id: normalizedId,
          nodeType: 'RuleSetNode' as const,
          // The wire name, which matches the property, the predicate and every
          // read response. `ruleSetVersionId` is still accepted by the server as
          // a deprecated alias; nothing here sends it any more.
          ruleSetVersion,
          inputs: normalizedInputs,
          outputs: normalizedOutputs,
        };
      }

      /*
       * A patch node is rebuilt here rather than falling through to the query
       * branch below, because the two fields that make it one - which output
       * carries the deletions and which the additions - are not on any other
       * node type, and a payload builder that lists fields drops the ones it
       * has not been told about. That is the same silent loss as #301's
       * `backendConfig` and #372's `variableMappings`, and here it would mean a
       * save refused outright: the writer requires both halves by name.
       */
      if (node.nodeType === 'PatchNode') {
        const deletionsOutput = mapPortId(node.deletionsOutput);
        const additionsOutput = mapPortId(node.additionsOutput);
        if (!deletionsOutput || !additionsOutput) {
          throw new Error(`Patch node ${normalizedId} must name one output for deletions and another for additions.`);
        }
        if (!node.queryId || node.queryId.trim().length === 0) {
          throw new Error(`Patch node ${normalizedId} is missing the update whose effect it derives.`);
        }
        const patchBackendConfig = node.backendConfig ?? null;
        const patchHasBackendId = !!node.backendId && node.backendId.trim().length > 0;
        if (!patchHasBackendId && !patchBackendConfig) {
          throw new Error(`Patch node ${normalizedId} is missing a backend.`);
        }
        return {
          id: normalizedId,
          nodeType: 'PatchNode' as const,
          queryId: node.queryId,
          ...(patchBackendConfig ? { backendConfig: patchBackendConfig } : { backendId: node.backendId }),
          inputs: normalizedInputs.length > 0 ? normalizedInputs : undefined,
          outputs: normalizedOutputs,
          deletionsOutput,
          additionsOutput,
        };
      }

      /*
       * A node's backend is either a registered one or an ephemeral store
       * created for the run (#297). Demanding `backendId` regardless rejected
       * exactly the nodes that need no backend at all, and carrying only
       * `backendId` into the payload is the other half of how a canvas save
       * silently stripped a working ephemeral config (#301).
       */
      const backendConfig = 'backendConfig' in node ? node.backendConfig : null;
      const hasBackendId = 'backendId' in node && !!node.backendId && node.backendId.trim().length > 0;

      if (!hasBackendId && !backendConfig) {
        throw new Error(`Execution node ${normalizedId} is missing a backend.`);
      }

      if (!('queryId' in node) || !node.queryId || node.queryId.trim().length === 0) {
        throw new Error(`Execution node ${normalizedId} is missing a query assignment.`);
      }

      return {
        id: normalizedId,
        nodeType: node.nodeType,
        queryId: node.queryId,
        // Exclusive: the server rejects a payload naming both.
        ...(backendConfig ? { backendConfig } : { backendId: node.backendId }),
        inputs: normalizedInputs.length > 0 ? normalizedInputs : undefined,
        outputs: normalizedOutputs.length > 0 ? normalizedOutputs : undefined,
      };
    });

    if (executionNodes.length === 0) {
      throw new Error('Add at least one execution node before saving.');
    }

    const edges = flat.edges.map((edge, index) => {
      const normalizedId = ensureUrnId(edge.id ?? null, 'edge', index);
      const resolvedSource =
        nodeIdMap.get(edge.sourceNodeId) ?? ensureUrnId(edge.sourceNodeId ?? null, 'node', index + 100);
      const resolvedTarget =
        nodeIdMap.get(edge.targetNodeId) ?? ensureUrnId(edge.targetNodeId ?? null, 'node', index + 200);
      const sourceOutputId = edge.sourceOutputId ? mapPortId(edge.sourceOutputId) : undefined;
      const targetInputId = edge.targetInputId ? mapPortId(edge.targetInputId) : undefined;

      const payload: Record<string, unknown> = {
        id: normalizedId,
        sourceNodeId: resolvedSource,
        targetNodeId: resolvedTarget,
        dataFlowType: edge.dataFlowType,
      };
      if (sourceOutputId) {
        payload.sourceOutputId = sourceOutputId;
      }
      if (targetInputId) {
        payload.targetInputId = targetInputId;
      }
      const whenEmpty = (edge as { whenEmpty?: string | null }).whenEmpty;
      if (whenEmpty) {
        payload.whenEmpty = whenEmpty;
      }
      /*
       * Which of the source's variables lands in which of the target's. The
       * flat payload has carried it since the inspector grew the grid that
       * edits it, but this builder never copied it across, so every mapping an
       * author chose was dropped at the save — and a re-save of a group that
       * had one dropped that too. It needs no id remapping: the pairs name
       * variables rather than member IRIs, precisely so they survive one.
       */
      const variableMappings = (edge as { variableMappings?: string | null }).variableMappings;
      if (variableMappings) {
        payload.variableMappings = variableMappings;
      }
      return payload;
    });

    const startOutputs =
      flat.startNode?.outputs
        ?.map((outputId) => mapPortId(outputId))
        .filter((id): id is string => !!id) ?? [];

    const endInputs =
      flat.endNode?.inputs
        ?.map((inputId) => mapPortId(inputId))
        .filter((id): id is string => !!id) ?? [];

    const candidate: QueryGroupVersionForGroupCreateInput = {
      queryGroupVersion: {
        comment: normalizeNullableString(versionComment),
        canvasData: graph.serializeCanvasSnapshot(),
      },
      startNode: startOutputs.length > 0 ? { outputs: startOutputs } : undefined,
      endNode: {
        mediaType: endNode.mediaType ?? null,
        inputs: endInputs.length > 0 ? endInputs : undefined,
      },
      executionNodes,
      edges,
    };

    const mergeDrafts = <T extends { id?: string | null }>(primary: T[], fallback: T[]): T[] => {
      const seen = new Set<string>();
      const merged: T[] = [];
      const add = (item: T | null | undefined) => {
        if (!item) return;
        const id = typeof item.id === 'string' ? item.id : null;
        if (!id || seen.has(id)) return;
        seen.add(id);
        merged.push(item);
      };
      primary.forEach(add);
      fallback.forEach(add);
      return merged;
    };

    const tupleMembersDraft = mergeDrafts(
      mapToArray(tupleMembers) as TupleMemberDraft[],
      normalizedStart.tupleMembers as TupleMemberDraft[],
    );
    if (tupleMembersDraft.length > 0) {
      candidate.tupleMembers = tupleMembersDraft;
    }

    const inputTuplesDraft = mergeDrafts(
      mapToArray(inputTupleDrafts) as InputTupleDraft[],
      normalizedStart.inputTuples as InputTupleDraft[],
    );
    if (inputTuplesDraft.length > 0) {
      candidate.inputTuples = inputTuplesDraft;
    }

    const outputsDraft = mapToArray(outputVariableDrafts) as OutputVariableDraft[];
    if (outputsDraft.length > 0) {
      candidate.outputs = outputsDraft;
    }

    const outputTuplesDraft = mapToArray(outputTupleDrafts) as OutputTupleDraft[];
    if (outputTuplesDraft.length > 0) {
      candidate.outputTuples = outputTuplesDraft;
    }

    const inputsDraft = mergeDrafts(
      mapToArray(inputVariableDrafts) as InputVariableDraft[],
      normalizedStart.inputs as InputVariableDraft[],
    );
    if (inputsDraft.length > 0) {
      candidate.inputs = inputsDraft;
    }

    const rdfOutputsDraft = mapToArray(rdfOutputDrafts) as TriplesQuadsDraft[];
    if (rdfOutputsDraft.length > 0) {
      candidate.rdfOutputs = rdfOutputsDraft;
    }

    const booleanOutputsDraft = mapToArray(booleanOutputDrafts) as BooleanDraft[];
    if (booleanOutputsDraft.length > 0) {
      candidate.booleanOutputs = booleanOutputsDraft;
    }

    const queryIdInputsDraft = mapToArray(queryIdInputDrafts) as QueryIdInputDraft[];
    if (queryIdInputsDraft.length > 0) {
      candidate.queryIdInputs = queryIdInputsDraft;
    }

    if (process.env.NODE_ENV !== 'production') {
      logger.debug?.('[useQueryGroupIO] buildVersionCreatePayload summary', {
        executionNodes: executionNodes.length,
        edges: edges.length,
        tupleMembers: tupleMembersDraft.length,
        inputTuples: inputTuplesDraft.length,
        inputs: inputsDraft.length,
        outputs: outputsDraft.length,
        outputTuples: outputTuplesDraft.length,
        rdfOutputs: rdfOutputsDraft.length,
        booleanOutputs: booleanOutputsDraft.length,
        queryIdInputs: queryIdInputsDraft.length,
        startTuples: normalizedStart.inputTuples.length,
        startMembers: normalizedStart.tupleMembers.length,
        startInputs: normalizedStart.inputs.length,
      });
    }

    try {
      return queryGroupVersionForGroupCreateSchema.parse(candidate);
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues.map(issue => issue.message).join('; ');
        throw new Error(`Query group payload is invalid: ${message}`);
      }
      throw error;
    }
  };

  const registerRdfIoEntity = (draft: TriplesQuadsDraft) => {
    if (!draft?.id) {
      return;
    }
    rdfOutputDrafts.value.set(draft.id, { ...draft });
  };

  const registerQueryIdInput = (draft: QueryIdInputDraft) => {
    if (!draft?.id) {
      return;
    }
    queryIdInputDrafts.value.set(draft.id, { ...draft });
  };

  const unregisterIoEntity = (entityId: string) => {
    if (!entityId) {
      return;
    }
    rdfOutputDrafts.value.delete(entityId);
  };

  const unregisterQueryIdInput = (entityId: string) => {
    if (!entityId) {
      return;
    }
    queryIdInputDrafts.value.delete(entityId);
  };

  return {
    ioDraftStore,
    inputTuples,
    populateFromExpanded,
    resetDrafts,
    normalizeStartTuples,
    resetStartTuples,
    ingestQueryVersionDrafts,
    buildVersionCreatePayload,
    tupleEditor,
    registerRdfIoEntity,
    registerQueryIdInput,
    unregisterIoEntity,
    unregisterQueryIdInput,
  };
}
