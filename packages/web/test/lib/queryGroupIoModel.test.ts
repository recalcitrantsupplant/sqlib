import { describe, it, expect } from 'vitest';

import {
  describeArity,
  mergeIoModels,
  normalizeIoModel,
  portFor,
  portsForNode,
  pruneUnreferencedEntities,
  queryVersionInterfaceFromExpanded,
  queryVersionInterfacesFromGroup,
  tupleArity,
  variablesForPort,
  type IoEntityRecord,
} from '../../src/composables/queryGroupIoModel';
import {
  IDS,
  selectGroupVersionExpanded,
  selectQueryVersionExpanded,
} from '../fixtures/queryGroupCanvasIo';

describe('query-group I/O normalization', () => {
  describe('arity', () => {
    it('reports an undescribed tuple as unknown rather than empty', () => {
      const model = normalizeIoModel({ inputTuples: [{ id: 'urn:t:1', name: 'T' }] }, 'query-version');
      expect(model.entities['urn:t:1'].arity).toBeNull();
      expect(tupleArity(model.entities['urn:t:1'])).toBeNull();
      expect(describeArity(null)).toBe('arity unknown');
    });

    it('reports a genuinely empty tuple as arity zero', () => {
      const model = normalizeIoModel({ inputTuples: [{ id: 'urn:t:1', memberEntries: [] }] }, 'query-group');
      expect(model.entities['urn:t:1'].arity).toBe(0);
      expect(describeArity(0)).toBe('0 vars');
    });
  });

  describe('port descriptors', () => {
    it('marks a reference with no entity behind it unresolved instead of guessing its type', () => {
      // The IRI says "input-tuple", and the old normalizer believed it. A port
      // typed from a guess is indistinguishable from a real one downstream.
      const port = portFor('urn:sqlib:input-tuple:vanished', 'input', {});
      expect(port).toMatchObject({ entityType: 'Unknown', resolved: false, origin: 'unknown' });
    });

    it('takes type, label and origin from the entity when one exists', () => {
      const entities: Record<string, IoEntityRecord> = {
        'urn:t:1': { id: 'urn:t:1', kind: 'QueryInputTuple', name: 'Cities', origin: 'query-group' },
      };
      expect(portFor('urn:t:1', 'input', entities)).toMatchObject({
        label: 'Cities',
        entityType: 'QueryInputTuple',
        origin: 'query-group',
        resolved: true,
      });
    });
  });

  describe('node ports', () => {
    const iface = queryVersionInterfaceFromExpanded(selectQueryVersionExpanded())!;

    it('exposes the query version interface even when the node persisted no ports', () => {
      const { inputs, outputs } = portsForNode({ inputs: [], outputs: [] }, iface.model.entities, iface);
      expect(inputs.map(p => p.id)).toEqual([IDS.inputTuple]);
      expect(outputs.map(p => p.id)).toEqual([IDS.outputTuple]);
    });

    it('keeps group-declared ports alongside the canonical ones, canonical first', () => {
      const entities = {
        ...iface.model.entities,
        'urn:group:rdf': { id: 'urn:group:rdf', kind: 'TriplesQuadsIO' as const, origin: 'query-group' as const },
      };
      const { outputs } = portsForNode({ outputs: ['urn:group:rdf', IDS.outputTuple] }, entities, iface);
      expect(outputs.map(p => p.id)).toEqual([IDS.outputTuple, 'urn:group:rdf']);
    });

    it('does not repeat a port that is both canonical and persisted', () => {
      const { inputs } = portsForNode({ inputs: [IDS.inputTuple] }, iface.model.entities, iface);
      expect(inputs).toHaveLength(1);
    });
  });

  describe('variables behind a tuple', () => {
    const iface = queryVersionInterfaceFromExpanded(selectQueryVersionExpanded())!;

    it('returns them in member order', () => {
      expect(variablesForPort(IDS.outputTuple, iface.model)?.map(v => v.variableName)).toEqual([
        'city',
        'pop',
        'area',
      ]);
    });

    it('returns null when a member or its variable is missing, rather than a short list', () => {
      // A partial answer here reads as "this tuple has fewer columns", which is
      // a different and wrong statement from "we could not resolve it".
      const broken = {
        ...iface.model,
        variables: { ...iface.model.variables },
      };
      delete broken.variables[IDS.outputVarPop];
      expect(variablesForPort(IDS.outputTuple, broken)).toBeNull();
    });

    it('distinguishes an unknown tuple from one with no members', () => {
      const unknown = normalizeIoModel({ inputTuples: [{ id: 'urn:t:1' }] }, 'query-group');
      expect(variablesForPort('urn:t:1', unknown)).toBeNull();

      const empty = normalizeIoModel({ inputTuples: [{ id: 'urn:t:2', memberEntries: [] }] }, 'query-group');
      expect(variablesForPort('urn:t:2', empty)).toEqual([]);
    });
  });

  describe('ownership', () => {
    it('attributes a query version interface from a group expansion', () => {
      const interfaces = queryVersionInterfacesFromGroup(selectGroupVersionExpanded());
      expect(interfaces[IDS.selectVersion]).toMatchObject({
        inputPortIds: [IDS.inputTuple],
        outputPortIds: [IDS.outputTuple],
      });
      // The group's boundary tuple belongs to the group, not to the query.
      expect(interfaces[IDS.selectVersion].model.entities[IDS.boundaryTuple]).toBeUndefined();
    });

    it('keeps group-owned entities when nothing references them any more', () => {
      const entities: Record<string, IoEntityRecord> = {
        boundary: { id: 'boundary', kind: 'QueryInputTuple', origin: 'query-group' },
        canonical: { id: 'canonical', kind: 'QueryOutputTuple', origin: 'query-version' },
        shared: { id: 'shared', kind: 'QueryOutputTuple', origin: 'query-version' },
      };

      const kept = pruneUnreferencedEntities(entities, ['shared']);

      // A boundary tuple with no edge yet is still the group's declared
      // interface; a query version's port only lives while a node names it.
      expect(Object.keys(kept).sort()).toEqual(['boundary', 'shared']);
    });
  });

  describe('merging', () => {
    it('lets a later model win per key without dropping earlier entries', () => {
      const a = normalizeIoModel({ inputTuples: [{ id: 'a', name: 'A' }] }, 'query-group');
      const b = normalizeIoModel({ inputTuples: [{ id: 'a', name: 'A2' }, { id: 'b' }] }, 'query-version');
      const merged = mergeIoModels(a, b);
      expect(merged.entities.a.name).toBe('A2');
      expect(Object.keys(merged.entities).sort()).toEqual(['a', 'b']);
    });
  });
});
