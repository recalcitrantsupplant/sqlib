/**
 * Read a Start node result-tuple port as the group input it stands for.
 *
 * The Start node's tuple ports are the group's input tuples
 * (`edgeSourcePortKinds` in `@sparql-query-lib/contracts`). A version saved
 * through the API before the writer checked this can carry a Start port typed
 * as a `QueryOutputTuple`. The engine runs it, but the canvas reports each edge
 * from it as an error, its input editor does not list it, and the API refuses
 * to save it again.
 *
 * This rewrites such a port, in the expanded version, as a `QueryInputTuple`
 * with the same id, name and variable names, before the canvas reads it. The
 * next save then writes the port in the current form. Each variable becomes a
 * new input variable, because one id cannot be both an input and an output
 * variable in the same payload.
 */

import type { QueryGroupVersionExpanded } from '@sparql-query-lib/contracts';

export type LegacyStartPortUpgrade = {
  expanded: QueryGroupVersionExpanded;
  /** The ids of the ports that were rewritten. */
  converted: string[];
};

export function upgradeLegacyStartPorts(expanded: QueryGroupVersionExpanded): LegacyStartPortUpgrade {
  const startOutputs = new Set((expanded.startNode?.outputs ?? []).filter((id): id is string => typeof id === 'string'));
  const legacy = (expanded.outputTuples ?? []).filter(tuple => startOutputs.has(tuple.id));
  if (legacy.length === 0) return { expanded, converted: [] };

  const legacyIds = new Set(legacy.map(tuple => tuple.id));
  const legacyMemberIds = new Set(legacy.flatMap(tuple => tuple.memberEntries ?? []));
  const outputVariables = new Map((expanded.outputs ?? []).map(variable => [variable.id, variable]));

  // One new input variable per member, named as the output variable was.
  const newInputs: NonNullable<QueryGroupVersionExpanded['inputs']> = [];
  const tupleMembers = (expanded.tupleMembers ?? []).map(member => {
    if (!legacyMemberIds.has(member.id)) return member;
    const id = `urn:ui-temp:start-input:${member.id}`;
    newInputs.push({ id, variableName: outputVariables.get(member.variable)?.variableName ?? member.variable });
    return { ...member, variable: id };
  });

  // An output variable that no remaining member names is dropped with its tuple.
  const stillNamed = new Set(tupleMembers.map(member => member.variable));
  const outputs = (expanded.outputs ?? []).filter(variable => stillNamed.has(variable.id));

  const inputTuples = [
    ...(expanded.inputTuples ?? []),
    ...legacy.map(tuple => ({ id: tuple.id, name: tuple.name ?? null, memberEntries: tuple.memberEntries ?? [] })),
  ];

  return {
    expanded: {
      ...expanded,
      tupleMembers,
      inputs: [...(expanded.inputs ?? []), ...newInputs],
      outputs,
      inputTuples,
      outputTuples: (expanded.outputTuples ?? []).filter(tuple => !legacyIds.has(tuple.id)),
    },
    converted: legacy.map(tuple => tuple.id),
  };
}
