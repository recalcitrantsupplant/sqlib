import { mintId } from './id.js';
import { allocateVersion, setCurrentVersion } from './versionNumbering.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryOutputTuple } from '../persistence/schemas/QueryOutputTupleSchema.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { loadTupleMembersByIds } from '../persistence/utils/TupleMemberUtils.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import { toQueryTypeIri } from './queryTypes.js';
import { isSrlImportable, SRL_IMPORT_REVISION } from '@sparql-query-lib/srl';
import { isWhenEmptyMode, versionSlotPolicies } from './slotPolicies.js';
import type { WhenEmptyMode } from '../persistence/schemas/QueryEdgeSchema.js';

type AnyRecord = Record<string, any>;

/** The name of the auto-tuple that holds every projected variable of a SELECT. */
export const ALL_OUTPUTS_TUPLE_NAME = 'All query outputs';

/**
 * The projected variables that make a SELECT a dataset query: `?graph` fills
 * both parts of a dataset, `?defaultGraph` and `?namedGraph` one part each.
 */
export const DATASET_VARIABLE_NAMES = ['graph', 'defaultGraph', 'namedGraph'] as const;

/** The name of the one-variable auto-tuple made for a reserved dataset variable. */
export function datasetTupleName(variableName: string): string {
  return `Dataset graphs (?${variableName})`;
}

function isAutoTupleName(name: unknown): boolean {
  return name === ALL_OUTPUTS_TUPLE_NAME
    || DATASET_VARIABLE_NAMES.some(variableName => name === datasetTupleName(variableName));
}

/**
 * Check if an auto-tuple with the given variable names (in order) already exists
 */
export async function findExistingAutoTuple(
  variableNames: string[],
  tupleName: string = ALL_OUTPUTS_TUPLE_NAME,
): Promise<string | null> {
  if (variableNames.length === 0) return null;
  const cacheCoordinator = getCacheCoordinator();

  const allOutputTuples = cacheCoordinator.list('QueryOutputTuple') as LdkitQueryOutputTuple[];
  const autoTuples = allOutputTuples.filter(t => t.name === tupleName);

  for (const tuple of autoTuples) {
    if (!tuple.memberEntries || tuple.memberEntries.length !== variableNames.length) continue;

    // Load the tuple members to check variables and order
    const members = await loadTupleMembersByIds(tuple.memberEntries);
    members.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    if (members.length !== variableNames.length) continue;

    // Check if all variables match in order
    const matches = members.every((member, index) => {
      const variableId = member.variable;
      if (!variableId) return false;
      const output = cacheCoordinator.get(variableId);
      return output && (output as { variableName?: string }).variableName === variableNames[index];
    });

    if (matches) return tuple.$id;
  }

  return null;
}

/**
 * Check if an auto-tuple is still referenced by any QueryVersion
 */
async function isAutoTupleOrphaned(tupleId: string): Promise<boolean> {
  const allVersions = getCacheCoordinator().list('QueryVersion') as LdkitQueryVersion[];
  return !allVersions.some(v => v.inferredOutputs?.includes(tupleId));
}

/**
 * Remove orphaned auto-tuple and its members
 */
export async function cleanupOrphanedAutoTuple(tupleId: string): Promise<void> {
  const cacheCoordinator = getCacheCoordinator();
  const tuple = cacheCoordinator.get(tupleId) as LdkitQueryOutputTuple;
  if (!tuple || !isAutoTupleName(tuple.name)) return;

  if (await isAutoTupleOrphaned(tupleId)) {
    // Delete tuple members first
    if (tuple.memberEntries) {
      for (const memberId of tuple.memberEntries) {
        await cacheCoordinator.delete('TupleMember', memberId);
      }
    }
    // Delete the tuple itself
    await cacheCoordinator.delete('QueryOutputTuple', tupleId);
  }
}

// Use centralized ID minting

/**
 * Whether a query converts to a single SRL rule, decided once at write time.
 *
 * Only a CONSTRUCT or an `INSERT … WHERE` can, so every other form is settled
 * from `queryType` without parsing — which is most of a library. The rest costs
 * one parse per version created, against a version that will never change, and
 * saves the import picker a round trip per query every time it opens.
 *
 * Never throws: an unparseable query is simply not importable, and a version is
 * not worth refusing to store over an advisory flag.
 */
export function srlImportability(
  queryString: unknown,
  queryType: string | undefined,
): { srlImportable: boolean; srlImportRevision: number } {
  const convertible = queryType === QueryTypeIri.construct || queryType === QueryTypeIri.update;
  if (!convertible || typeof queryString !== 'string' || !queryString.trim()) {
    return { srlImportable: false, srlImportRevision: SRL_IMPORT_REVISION };
  }
  try {
    return { srlImportable: isSrlImportable(queryString), srlImportRevision: SRL_IMPORT_REVISION };
  } catch {
    return { srlImportable: false, srlImportRevision: SRL_IMPORT_REVISION };
  }
}

/**
 * One slot's requested `whenEmpty`, as `POST /queries/:id/versions` takes it:
 * the slot named by its variables, `null` to clear a mode the previous version
 * had.
 */
export interface InputPolicy {
  vars: string[];
  whenEmpty: WhenEmptyMode | null;
}

/**
 * Decide each new input tuple's `whenEmpty`.
 *
 * A version is immutable, so the mode changes only with a new version, and a
 * text edit must not silently drop a guard the author set. In order:
 *
 * 1. the body's `inputPolicies` entry for the slot's variables, if any;
 * 2. a `whenEmpty` key on the tuple itself (a client re-saving what it loaded);
 * 3. the mode of the previous current version's slot with the same variables.
 *
 * Slots are matched by variable set, not order, as argument sets are.
 */
function inputTupleWhenEmpty(
  queryId: string,
  inputPolicies: InputPolicy[] | undefined,
): (tuple: AnyRecord, memberEntries: string[]) => WhenEmptyMode | undefined {
  const cacheCoordinator = getCacheCoordinator();
  const signature = (vars: readonly string[]) => [...vars].sort().join(' ');
  const requested = new Map((inputPolicies ?? []).map(policy => [signature(policy.vars), policy.whenEmpty]));
  const parent = cacheCoordinator.get(queryId) as { currentVersion?: string | null } | null;
  const previousVersion = parent?.currentVersion
    ? cacheCoordinator.get(parent.currentVersion) as LdkitQueryVersion | null
    : null;
  const previous = new Map(versionSlotPolicies(previousVersion).map(policy => [signature(policy.vars), policy.whenEmpty]));

  const memberNames = (memberEntries: string[]): string[] => memberEntries.flatMap(memberId => {
    const member = cacheCoordinator.get(memberId) as { variable?: string } | null;
    const variable = member?.variable ? cacheCoordinator.get(member.variable) as { variableName?: string } | null : null;
    return variable?.variableName ? [variable.variableName] : [];
  });

  return (tuple, memberEntries) => {
    const key = signature(memberNames(memberEntries));
    if (requested.has(key)) return requested.get(key) ?? undefined;
    if ('whenEmpty' in tuple) return isWhenEmptyMode(tuple.whenEmpty) ? tuple.whenEmpty : undefined;
    return previous.get(key);
  };
}

/**
 * Numbered and pointed at under the parent's version lock (`allocateVersion`),
 * so concurrent saves get consecutive numbers and the last to finish is current.
 */
export async function createQueryVersionFlat(queryId: string, body: AnyRecord): Promise<{ created: LdkitQueryVersion; iriMap: Record<string, string> }> {
  return allocateVersion('QueryVersion', queryId, (nextVersion) => createQueryVersionFlatNumbered(queryId, body, nextVersion));
}

/**
 * Create a new QueryVersion with flat child arrays. Accepts temporary URNs
 * (e.g. `urn:ui-temp:<id>`) for new entities and returns an iriMap mapping
 * those temporary identifiers to minted stable IRIs.
 */
async function createQueryVersionFlatNumbered(queryId: string, body: AnyRecord, nextVersion: number): Promise<{ created: LdkitQueryVersion; iriMap: Record<string, string> }> {
  const cacheCoordinator = getCacheCoordinator();
  const iriMap: Record<string, string> = {};
  const tempIdPrefix = 'urn:ui-temp:';

  const versionId = mintId('queryVersion');

  const registerTempIds = (resources: AnyRecord[] | undefined, kind: string) => {
    if (!resources) return;
    for (const resource of resources) {
      if (!resource || typeof resource !== 'object') continue;
      const rawId = resource.id;
      if (typeof rawId !== 'string') continue;
      // An id that already names an entity is a stand-in too: the client is
      // re-saving a version it loaded, and creating over the old version's
      // parts would edit that frozen snapshot (the coordinator refuses it).
      if (!rawId.startsWith(tempIdPrefix) && !cacheCoordinator.get(rawId)) continue;
      if (!(rawId in iriMap)) {
        iriMap[rawId] = mintId(kind);
      }
    }
  };

  registerTempIds(body.limitParameters, 'limitParam');
  registerTempIds(body.offsetParameters, 'offsetParam');
  registerTempIds(body.inputs, 'input');
  registerTempIds(body.outputs, 'output');
  registerTempIds(body.tupleMembers, 'tupleMember');
  registerTempIds(body.inputTuples, 'inputTuple');
  registerTempIds(body.inferredInputs, 'inputTuple');
  registerTempIds(body.outputTuples, 'outputTuple');

  const resolveRef = (val: string | undefined) => {
    if (!val) return val;
    return iriMap[val] || val;
  };

  const ensureResourceId = (resource: AnyRecord, kind: string): string => {
    const rawId = resource?.id;
    if (typeof rawId === 'string' && rawId.length > 0) {
      return resolveRef(rawId)!;
    }
    return mintId(kind);
  };

  const resolvedQueryType = toQueryTypeIri(typeof body.queryType === 'string' ? body.queryType : undefined);
  if (resolvedQueryType) {
    body.queryType = resolvedQueryType;
  } else {
    delete body.queryType;
  }
  const isSelectQuery = resolvedQueryType === QueryTypeIri.select;
  const isConstructQuery = resolvedQueryType === QueryTypeIri.construct || resolvedQueryType === QueryTypeIri.describe;
  const isAskQuery = resolvedQueryType === QueryTypeIri.ask;

  // 2) Create child entities as provided
  const limitParamIds: string[] = [];
  for (const p of (body.limitParameters as AnyRecord[] | undefined) || []) {
    const id = ensureResourceId(p, 'limitParam');
    await cacheCoordinator.create('LimitParameter', toLdkit({ $id: id, name: p.name, value: p.value, defaultValue: p.defaultValue, '@type': 'LimitParameter' }));
    limitParamIds.push(id);
  }

  const offsetParamIds: string[] = [];
  for (const p of (body.offsetParameters as AnyRecord[] | undefined) || []) {
    const id = ensureResourceId(p, 'offsetParam');
    await cacheCoordinator.create('OffsetParameter', toLdkit({ $id: id, name: p.name, value: p.value, defaultValue: p.defaultValue, '@type': 'OffsetParameter' }));
    offsetParamIds.push(id);
  }

  const inputIds: string[] = [];
  for (const inp of (body.inputs as AnyRecord[] | undefined) || []) {
    const id = ensureResourceId(inp, 'input');
    await cacheCoordinator.create('QueryInputVariable', toLdkit({ $id: id, variableName: inp.variableName, allowedTypes: inp.allowedTypes, '@type': 'QueryInputVariable' }));
    inputIds.push(id);
  }

  const outputIds: string[] = [];
  const orderedOutputs: { id: string; variableName?: string }[] = [];
  for (const out of (body.outputs as AnyRecord[] | undefined) || []) {
    const id = ensureResourceId(out, 'output');
    await cacheCoordinator.create('QueryOutputVariable', toLdkit({ $id: id, variableName: out.variableName, description: out.description, '@type': 'QueryOutputVariable' }));
    outputIds.push(id);
    orderedOutputs.push({ id, variableName: out.variableName });
  }

  const tupleMemberIds: string[] = [];
  for (const m of (body.tupleMembers as AnyRecord[] | undefined) || []) {
    const id = ensureResourceId(m, 'tupleMember');
    const variable = typeof m.variable === 'string' ? resolveRef(m.variable) : undefined;
    const record: AnyRecord = { $id: id, position: m.position, '@type': 'TupleMember' };
    if (variable) record.variable = variable;
    await cacheCoordinator.create('TupleMember', toLdkit(record));
    tupleMemberIds.push(id);
  }

  const inputTupleIds: string[] = [];
  const whenEmptyFor = inputTupleWhenEmpty(queryId, body.inputPolicies as InputPolicy[] | undefined);
  // Support both old and new field names for backwards compatibility
  const inputTupleList = (body.inputTuples as AnyRecord[] | undefined) || (body.inferredInputs as AnyRecord[] | undefined) || [];
  for (const t of inputTupleList) {
    const id = ensureResourceId(t, 'inputTuple');
    const memberEntries = Array.isArray(t.memberEntries) ? t.memberEntries.map((x: string) => resolveRef(x)!) : [];
    const whenEmpty = whenEmptyFor(t, memberEntries);
    await cacheCoordinator.create('QueryInputTuple', toLdkit({
      $id: id,
      name: t.name,
      memberEntries,
      ...(whenEmpty ? { whenEmpty } : {}),
      '@type': 'QueryInputTuple',
    }));
    inputTupleIds.push(id);
  }

  const outputTupleIds: string[] = [];
  for (const t of (body.outputTuples as AnyRecord[] | undefined) || []) {
    const id = ensureResourceId(t, 'outputTuple');
    const memberEntries = Array.isArray(t.memberEntries) ? t.memberEntries.map((x: string) => resolveRef(x)!) : [];
    await cacheCoordinator.create('QueryOutputTuple', toLdkit({ $id: id, name: t.name, memberEntries, '@type': 'QueryOutputTuple' }));
    outputTupleIds.push(id);
  }

  // Create inferred outputs based on query type
  const inferredOutputIds: string[] = [];

  // SELECT queries: Create auto-tuple for all outputs
  if ((isSelectQuery || orderedOutputs.length > 0) && orderedOutputs.some(o => typeof o.variableName === 'string' && o.variableName.length > 0)) {
    // Extract variable names in order for reuse check
    const variableNames = orderedOutputs
      .filter(o => typeof o.variableName === 'string' && o.variableName.length > 0)
      .map(o => o.variableName!);

    /*
     * Reuse an auto-tuple with the same name and variables, or make one.
     * `outputs` are the projected variables it holds, in order.
     */
    const ensureAutoTuple = async (
      tupleName: string,
      outputs: Array<{ id: string; variableName?: string; position: number }>,
    ): Promise<string | null> => {
      const existing = await findExistingAutoTuple(outputs.map(o => o.variableName!), tupleName);
      if (existing) return existing;

      const memberIds: string[] = [];
      for (const out of outputs) {
        const tmId = mintId('tupleMember');
        await cacheCoordinator.create('TupleMember', toLdkit({ $id: tmId, position: out.position, variable: out.id, '@type': 'TupleMember' }));
        tupleMemberIds.push(tmId);
        memberIds.push(tmId);
      }
      if (memberIds.length === 0) return null;

      const tupleId = mintId('outputTuple');
      await cacheCoordinator.create('QueryOutputTuple', toLdkit({
        $id: tupleId,
        name: tupleName,
        outputType: 'outputTuple',
        memberEntries: memberIds,
        '@type': 'QueryOutputTuple'
      }));
      outputTupleIds.push(tupleId);
      return tupleId;
    };

    const namedOutputs = orderedOutputs
      .map((out, position) => ({ ...out, position }))
      .filter(o => typeof o.variableName === 'string' && o.variableName.length > 0);

    const autoAllOutputsTupleId = await ensureAutoTuple(ALL_OUTPUTS_TUPLE_NAME, namedOutputs);
    if (autoAllOutputsTupleId) {
      inferredOutputIds.push(autoAllOutputsTupleId);
    }

    /*
     * A dataset query also gets one single-variable tuple per reserved name it
     * projects, because a DATASET edge reads a one-variable tuple. A query
     * with `?defaultGraph` and `?namedGraph` can then feed the default part of
     * one target and the named part of another. A query that projects only
     * the reserved name already has that tuple: it is "All query outputs".
     */
    if (isSelectQuery && namedOutputs.length > 1) {
      for (const variableName of DATASET_VARIABLE_NAMES) {
        const output = namedOutputs.find(o => o.variableName === variableName);
        if (!output) continue;
        const tupleId = await ensureAutoTuple(datasetTupleName(variableName), [{ ...output, position: 0 }]);
        if (tupleId) inferredOutputIds.push(tupleId);
      }
    }
  }

  // CONSTRUCT/DESCRIBE queries: Create auto-RDF output
  if (isConstructQuery) {
    const autoTriplesQuadsIOId = mintId('triplesQuadsIO');
    await cacheCoordinator.create('TriplesQuadsIO', toLdkit({
      $id: autoTriplesQuadsIOId,
      name: 'RDF graph output',
      ioType: 'output',
      outputType: 'RDFGraph',
      triplesOrQuads: 'triples', // Default to triples
      '@type': 'TriplesQuadsIO'
    }));
    inferredOutputIds.push(autoTriplesQuadsIOId);
  }

  // ASK queries: Create auto-boolean output
  if (isAskQuery) {
    const autoBooleanIOId = mintId('booleanIO');
    await cacheCoordinator.create('BooleanIO', toLdkit({
      $id: autoBooleanIOId,
      name: 'Boolean result',
      ioType: 'output',
      outputType: 'Boolean',
      '@type': 'BooleanIO'
    }));
    inferredOutputIds.push(autoBooleanIOId);
  }

  // 3) Create the version via cache manager (write-through) and flip currentVersion on parent
  const toCreate: Partial<LdkitQueryVersion> & { $id: string } = {
    $id: versionId,
    isPartOf: queryId,
    version: nextVersion,
    // Frozen on create (issue #192). A version is a snapshot: what it holds is
    // what the reference to it means, so it is never created in a state where
    // it could still change. `immutable` on the request body is ignored rather
    // than honoured — there is no such thing as a mutable version.
    immutable: true,
    queryString: body.queryString,
    comment: body.comment,
    queryType: body.queryType,
    ...srlImportability(body.queryString, resolvedQueryType),
    limitParameters: limitParamIds.length ? limitParamIds : undefined,
    offsetParameters: offsetParamIds.length ? offsetParamIds : undefined,
    inferredInputs: inputTupleIds,
    inferredOutputs: inferredOutputIds.length ? inferredOutputIds : undefined,
    // Already resolved and checked by the route (`lib/toolObject.ts`).
    tool: body.tool,
  };

  const created = await cacheCoordinator.create('QueryVersion', toCreate);

  await setCurrentVersion('Query', queryId, versionId);


  return { created, iriMap };
}
