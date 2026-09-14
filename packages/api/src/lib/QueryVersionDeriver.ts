import type { CorrelatedExistsInput, SparqlQueryParser } from './parser.js';

const TEMP_ID_PREFIX = 'urn:ui-temp:';

interface DerivedOutput {
  id: string;
  variableName: string;
}

interface DerivedLimitParameter {
  id: string;
  name: string;
}

interface DerivedOffsetParameter {
  id: string;
  name: string;
}

interface DerivedInput {
  id: string;
  variableName: string;
  allowedTypes?: string[];
}

interface DerivedTupleMember {
  id: string;
  position: number;
  variable: string;
}

interface DerivedInputTuple {
  id: string;
  name?: string;
  memberEntries: string[];
}

export interface QueryVersionDerivation {
  outputs: DerivedOutput[];
  limitParameters: DerivedLimitParameter[];
  offsetParameters: DerivedOffsetParameter[];
  inputs: DerivedInput[];
  tupleMembers: DerivedTupleMember[];
  inputTuples: DerivedInputTuple[];
  raw: {
    outputs: string[];
    limitParameters: string[];
    offsetParameters: string[];
    valuesInputs: string[][];
    correlatedExistsInputs: CorrelatedExistsInput[];
  };
}

const sanitizeLocalId = (value: string, fallback: string) => {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return base ? `auto-${base}` : `auto-${fallback}`;
};

const buildTempId = (kind: string, value: string | number) => `${TEMP_ID_PREFIX}${kind}:${value}`;

export function deriveQueryVersionMetadata(parser: SparqlQueryParser, queryString: string): QueryVersionDerivation {
  let rawOutputs: string[] = [];
  try {
    rawOutputs = parser.detectQueryOutputs(queryString) || [];
  } catch {
    rawOutputs = [];
  }

  let rawParams;
  try {
    rawParams = parser.detectInputs(queryString);
  } catch {
    rawParams = { valuesInputs: [], limitParameters: [], offsetParameters: [], correlatedExistsInputs: [] };
  }

  const outputs: DerivedOutput[] = [];
  const outputIdsByVariable = new Map<string, string>();
  if (rawOutputs.length > 0) {
    const seen = new Set<string>();
    rawOutputs.forEach((variableName, index) => {
      const safeName = sanitizeLocalId(variableName, `output-${index}`);
      let uniqueName = safeName;
      if (seen.has(uniqueName)) {
        let suffix = 1;
        while (seen.has(`${safeName}-${suffix}`)) suffix += 1;
        uniqueName = `${safeName}-${suffix}`;
      }
      seen.add(uniqueName);
      const id = buildTempId('output', uniqueName);
      outputIdsByVariable.set(variableName, id);
      outputs.push({ id, variableName });
    });
  }

  const limitParameters: DerivedLimitParameter[] = [];
  if (rawParams.limitParameters?.length) {
    const seen = new Set<string>();
    rawParams.limitParameters.forEach((name, index) => {
      const safeName = sanitizeLocalId(name, `limit-${index}`);
      let uniqueName = safeName;
      if (seen.has(uniqueName)) {
        let suffix = 1;
        while (seen.has(`${safeName}-${suffix}`)) suffix += 1;
        uniqueName = `${safeName}-${suffix}`;
      }
      seen.add(uniqueName);
      limitParameters.push({ id: buildTempId('limit-param', uniqueName), name });
    });
  }

  const offsetParameters: DerivedOffsetParameter[] = [];
  if (rawParams.offsetParameters?.length) {
    const seen = new Set<string>();
    rawParams.offsetParameters.forEach((name, index) => {
      const safeName = sanitizeLocalId(name, `offset-${index}`);
      let uniqueName = safeName;
      if (seen.has(uniqueName)) {
        let suffix = 1;
        while (seen.has(`${safeName}-${suffix}`)) suffix += 1;
        uniqueName = `${safeName}-${suffix}`;
      }
      seen.add(uniqueName);
      offsetParameters.push({ id: buildTempId('offset-param', uniqueName), name });
    });
  }

  const inputs: DerivedInput[] = [];
  const tupleMembers: DerivedTupleMember[] = [];
  const inputTuples: DerivedInputTuple[] = [];

  const nameToInputId = new Map<string, string>();

  (rawParams.valuesInputs || []).forEach((group, groupIndex) => {
    const tupleMemberIds: string[] = [];
    // Filter out empty or whitespace-only variable names from the group
    const validGroup = group.filter(name => name && name.trim().length > 0);
    if (validGroup.length === 0) {
      return; // Skip this group if it has no valid variable names
    }

    validGroup.forEach((rawName, position) => {
      const variableName = rawName.trim();
      let inputId = nameToInputId.get(variableName);
      if (!inputId) {
        const baseId = sanitizeLocalId(variableName, `input-${nameToInputId.size}`);
        let uniqueId = baseId;
        let suffix = 1;
        let candidateId = buildTempId('input', uniqueId);
        while (inputs.some(inp => inp.id === candidateId)) {
          uniqueId = `${baseId}-${suffix}`;
          suffix += 1;
          candidateId = buildTempId('input', uniqueId);
        }
        inputId = candidateId;
        nameToInputId.set(variableName, inputId);
        inputs.push({ id: inputId, variableName });
      }

      const memberId = buildTempId('tuple-member', `${groupIndex}-${position}`);
      tupleMembers.push({ id: memberId, position, variable: inputId });
      tupleMemberIds.push(memberId);
    });

    if (tupleMemberIds.length > 0) {
      const tupleId = buildTempId('input-tuple', `auto-${groupIndex}`);
      inputTuples.push({ id: tupleId, name: validGroup.join('-'), memberEntries: tupleMemberIds });
    }
  });

  console.log('derived inputs:', JSON.stringify({ inputs, tupleMembers, inputTuples }, null, 2));

  return {
    outputs,
    limitParameters,
    offsetParameters,
    inputs,
    tupleMembers,
    inputTuples,
    raw: {
      outputs: rawOutputs,
      limitParameters: rawParams.limitParameters || [],
      offsetParameters: rawParams.offsetParameters || [],
      valuesInputs: rawParams.valuesInputs || [],
      correlatedExistsInputs: rawParams.correlatedExistsInputs || [],
    },
  };
}
