import { mintId } from './id.js';
import type { LdkitQuery } from '../persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryOutputTuple } from '../persistence/schemas/QueryOutputTupleSchema.js';
import type { LdkitTupleMember } from '../persistence/schemas/TupleMemberSchema.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { LimitParameters } from '../persistence/utils/LimitParameterUtils.js';
import { OffsetParameters } from '../persistence/utils/OffsetParameterUtils.js';
import { QueryInputVariables } from '../persistence/utils/QueryInputVariableUtils.js';
import { QueryOutputVariables } from '../persistence/utils/QueryOutputVariableUtils.js';
import { QueryInputTuples } from '../persistence/utils/QueryInputTupleUtils.js';
import { QueryOutputTuples, loadQueryOutputTuplesByIds } from '../persistence/utils/QueryOutputTupleUtils.js';
import { TupleMembers, loadTupleMembersByIds } from '../persistence/utils/TupleMemberUtils.js';
import { TriplesQuadsIOs } from '../persistence/utils/TriplesQuadsIOUtils.js';
import { BooleanIOs } from '../persistence/utils/BooleanIOUtils.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import { toQueryTypeIri } from './queryTypes.js';
import { isSrlImportable, SRL_IMPORT_REVISION } from '@sparql-query-lib/srl';

type AnyRecord = Record<string, any>;

/**
 * Check if an auto-tuple with the given variable names (in order) already exists
 */
export async function findExistingAutoTuple(variableNames: string[]): Promise<string | null> {
  if (variableNames.length === 0) return null;
  const cacheCoordinator = getCacheCoordinator();

  // Get all auto-tuples (those named "All query outputs")
  const allOutputTuples = cacheCoordinator.list('QueryOutputTuple') as LdkitQueryOutputTuple[];
  const autoTuples = allOutputTuples.filter(t => t.name === 'All query outputs');

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
  if (!tuple || tuple.name !== 'All query outputs') return;

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
 * Create a new QueryVersion with flat child arrays. Accepts temporary URNs
 * (e.g. `urn:ui-temp:<id>`) for new entities and returns an iriMap mapping
 * those temporary identifiers to minted stable IRIs.
 */
export async function createQueryVersionFlat(queryId: string, body: AnyRecord): Promise<{ created: LdkitQueryVersion; iriMap: Record<string, string> }> {
  const cacheCoordinator = getCacheCoordinator();
  const iriMap: Record<string, string> = {};
  const tempIdPrefix = 'urn:ui-temp:';

  // 1) Determine next version number
  const existing = (cacheCoordinator.list('QueryVersion') as LdkitQueryVersion[]).filter(v => v.isPartOf === queryId);
  const nextVersion = existing.length > 0 ? (existing.sort((a, b) => Number(a.version) - Number(b.version))[existing.length - 1].version as number) + 1 : 1;
  const versionId = mintId('queryVersion');

  const registerTempIds = (resources: AnyRecord[] | undefined, kind: string) => {
    if (!resources) return;
    for (const resource of resources) {
      if (!resource || typeof resource !== 'object') continue;
      const rawId = resource.id;
      if (typeof rawId !== 'string') continue;
      if (!rawId.startsWith(tempIdPrefix)) continue;
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
  // Support both old and new field names for backwards compatibility
  const inputTupleList = (body.inputTuples as AnyRecord[] | undefined) || (body.inferredInputs as AnyRecord[] | undefined) || [];
  for (const t of inputTupleList) {
    const id = ensureResourceId(t, 'inputTuple');
    const memberEntries = Array.isArray(t.memberEntries) ? t.memberEntries.map((x: string) => resolveRef(x)!) : [];
    await cacheCoordinator.create('QueryInputTuple', toLdkit({ $id: id, name: t.name, memberEntries, '@type': 'QueryInputTuple' }));
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

    // Check if we can reuse an existing auto-tuple
    let autoAllOutputsTupleId = await findExistingAutoTuple(variableNames);

    if (!autoAllOutputsTupleId && variableNames.length > 0) {
      // Create new auto-tuple
      const autoTupleMemberIds: string[] = [];
      for (let index = 0; index < orderedOutputs.length; index++) {
        const out = orderedOutputs[index];
        if (typeof out.variableName !== 'string' || !out.variableName) continue;
        const tmId = mintId('tupleMember');
        await cacheCoordinator.create('TupleMember', toLdkit({ $id: tmId, position: index, variable: out.id, '@type': 'TupleMember' }));
        tupleMemberIds.push(tmId);
        autoTupleMemberIds.push(tmId);
      }

      if (autoTupleMemberIds.length > 0) {
        autoAllOutputsTupleId = mintId('outputTuple');
        const createdTuple = await cacheCoordinator.create('QueryOutputTuple', toLdkit({
          $id: autoAllOutputsTupleId,
          name: 'All query outputs',
          outputType: 'outputTuple',
          memberEntries: autoTupleMemberIds,
          '@type': 'QueryOutputTuple'
        }));
        outputTupleIds.push(autoAllOutputsTupleId);
      }
    }

    if (autoAllOutputsTupleId) {
      inferredOutputIds.push(autoAllOutputsTupleId);
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
  };

  const created = await cacheCoordinator.create('QueryVersion', toCreate);

  const updatedQuery = await cacheCoordinator.update('Query', queryId, { currentVersion: versionId });
  if (!updatedQuery) {
    throw new Error(`Failed to set currentVersion on Query ${queryId}`);
  }


  return { created, iriMap };
}
