/**
 * The guided empty state's templates, and the one originally named that does
 * not exist.
 *
 * The guided empty state asks for "2-3 one-click templates (linear chain,
 * fan-in merge, construct-then-query)". Two of those three are built as named.
 * The third is `construct-then-rules`, because the shape its name describes is
 * an edge v1 refuses, and the test that pins that is the point of this file as
 * much as the ones that pin what applies.
 *
 * The catalogue is checked structurally rather than by transcription: an
 * assertion that reads the template back and compares it to the same literal
 * tests nothing. What is asserted is the properties an author would notice
 * breaking - every step wired, every edge legal, the whole shape landing or
 * none of it.
 */

import { describe, it, expect } from 'vitest';

import * as commands from '../../src/composables/queryGroupCommands';
import {
  CANVAS_TEMPLATES,
  isTemplateAnchor,
  templateById,
  type CanvasTemplate,
} from '../../src/composables/canvasTemplates';
import { checkInvariants } from '../../src/composables/queryGroupInvariants';
import { createGraphStateFromExpanded } from '../../src/composables/useQueryGroupGraph';
import type { QueryGroupGraphState } from '../../src/composables/useQueryGroupGraph';
import { IDS, selectGroupVersionExpanded } from '../fixtures/queryGroupCanvasIo';
import { commandInstances } from './harness/canvasCells';

/** A group with its boundary and nothing else: what a new group's canvas is. */
const emptyCanvas = (): QueryGroupGraphState => {
  const loaded = createGraphStateFromExpanded(selectGroupVersionExpanded({ withSecondNode: true }));
  return {
    ...loaded,
    nodes: loaded.nodes.filter(node => node.kind === 'start' || node.kind === 'end'),
    edges: [],
  };
};

const idsFor = (template: CanvasTemplate, prefix = 'urn:test:tpl') => ({
  template,
  nodeIds: template.steps.map((_, index) => `${prefix}:node-${index}`),
  edgeIds: template.edges.map((_, index) => `${prefix}:edge-${index}`),
});

const codesOf = (issues: { code: string }[]) => issues.map(issue => issue.code).sort();

describe('the template catalogue', () => {
  it('offers the two or three the plan asked for, each with a distinct id', () => {
    expect(CANVAS_TEMPLATES.length).toBeGreaterThanOrEqual(2);
    expect(CANVAS_TEMPLATES.length).toBeLessThanOrEqual(3);
    expect(new Set(CANVAS_TEMPLATES.map(template => template.id)).size).toBe(CANVAS_TEMPLATES.length);
    for (const template of CANVAS_TEMPLATES) {
      expect(templateById(template.id)).toBe(template);
    }
  });

  it.each(CANVAS_TEMPLATES.map(template => [template.id, template] as const))(
    '%s names only its own steps and the two anchors',
    (_id, template) => {
      const keys = new Set(template.steps.map(step => step.key));
      expect(keys.size).toBe(template.steps.length);
      // A step keyed `start` would be addressed as the Start node by every edge
      // that names it, and the node it minted would be wired to nothing.
      for (const key of keys) expect(isTemplateAnchor(key)).toBe(false);

      for (const edge of template.edges) {
        expect(keys.has(edge.from) || edge.from === 'start').toBe(true);
        expect(keys.has(edge.to) || edge.to === 'end').toBe(true);
      }
    },
  );

  it.each(CANVAS_TEMPLATES.map(template => [template.id, template] as const))(
    '%s wires every step at both ends, so none of them arrives orphaned',
    (_id, template) => {
      for (const step of template.steps) {
        expect(template.edges.some(edge => edge.to === step.key)).toBe(true);
        expect(template.edges.some(edge => edge.from === step.key)).toBe(true);
      }
      // The boundary is the point: a shape that does not reach End is not a
      // group the author can run once they have filled its steps in.
      expect(template.edges.some(edge => edge.from === 'start')).toBe(true);
      expect(template.edges.some(edge => edge.to === 'end')).toBe(true);
    },
  );

  it.each(CANVAS_TEMPLATES.map(template => [template.id, template] as const))(
    '%s puts no two steps in the same cell',
    (_id, template) => {
      const cells = template.steps.map(step => `${step.column},${step.row}`);
      expect(new Set(cells).size).toBe(cells.length);
    },
  );
});

describe('applyTemplate on an empty canvas', () => {
  it.each(CANVAS_TEMPLATES.map(template => [template.id, template] as const))(
    'applies %s whole, and the result satisfies every invariant',
    (_id, template) => {
      const state = emptyCanvas();
      const params = idsFor(template);

      const result = commands.applyTemplate(state, params);

      expect(result.applied).toBe(true);
      expect(checkInvariants(result.state)).toEqual([]);

      const added = result.state.nodes.filter(node => node.kind !== 'start' && node.kind !== 'end');
      expect(added.map(node => node.id)).toEqual([...params.nodeIds]);
      expect(added.map(node => node.kind)).toEqual(template.steps.map(step => step.kind));
      expect(added.map(node => node.label)).toEqual(template.steps.map(step => step.label));

      expect(result.state.edges.map(edge => edge.id)).toEqual([...params.edgeIds]);
      expect(result.state.edges.map(edge => edge.flowType)).toEqual(template.edges.map(edge => edge.flowType));
    },
  );

  it.each(CANVAS_TEMPLATES.map(template => [template.id, template] as const))(
    'wires %s between the nodes its own edge list names',
    (_id, template) => {
      const state = emptyCanvas();
      const params = idsFor(template);
      const startId = state.nodes.find(node => node.kind === 'start')!.id;
      const endId = state.nodes.find(node => node.kind === 'end')!.id;
      const idForKey = new Map(template.steps.map((step, index) => [step.key, params.nodeIds[index]]));

      const result = commands.applyTemplate(state, params);

      expect(
        result.state.edges.map(edge => `${edge.source} -> ${edge.target}`),
      ).toEqual(
        template.edges.map(edge => {
          const from = edge.from === 'start' ? startId : idForKey.get(edge.from);
          const to = edge.to === 'end' ? endId : idForKey.get(edge.to);
          return `${from} -> ${to}`;
        }),
      );
    },
  );

  it('says once that the ports are unbound rather than twice per edge', () => {
    // The fan-in has five edges and so ten endpoints, none of which can bind
    // because no step has a query yet. Ten lines saying so is the wall of noise
    // `TEMPLATE_UNBOUND_CODES` exists to suppress.
    const template = templateById('fan-in-merge')!;
    const result = commands.applyTemplate(emptyCanvas(), idsFor(template));

    expect(result.applied).toBe(true);
    expect(codesOf(result.diagnostics)).toEqual(['template-ports-unbound']);
    expect(result.diagnostics[0].level).toBe('info');
  });

  it('keeps an ambiguity, which is a choice waiting rather than noise', () => {
    // A Start node already carrying two input tuples - a group whose steps were
    // all deleted, or one whose parameter signature was authored first. The
    // edge out of it has two candidates, and which one it takes is the author's
    // to say, so that diagnostic survives the suppression the `-none` ones get.
    const base = emptyCanvas();
    const start = base.nodes.find(node => node.kind === 'start')!;
    const state: QueryGroupGraphState = {
      ...base,
      nodes: base.nodes.map(node =>
        node.id === start.id
          ? {
              ...node,
              outputs: [
                ...node.outputs,
                { id: IDS.inputTuple, label: 'second', entityType: 'QueryInputTuple' as const, direction: 'output' as const },
              ],
            }
          : node,
      ),
    };
    expect(state.nodes.find(node => node.kind === 'start')!.outputs.length).toBe(2);

    const result = commands.applyTemplate(state, idsFor(templateById('linear-chain')!));

    expect(result.applied).toBe(true);
    expect(result.diagnostics.map(entry => entry.code)).toContain('source-ambiguous');
    expect(result.diagnostics.map(entry => entry.code)).toContain('template-ports-unbound');
  });
});

describe('what a template leaves behind survives every command', () => {
  // The transition matrix cannot host this. Its cells always carry a third
  // node so a `foreign` endpoint has somewhere to point, so `applyTemplate`
  // refuses on every one of them and only its refusal is enumerated there.
  // The shape it builds is a state the author then works on, so it gets the
  // same treatment here: every command instance the state's own vocabulary
  // offers, against the transition matrix's oracle.
  it.each(CANVAS_TEMPLATES.map(template => [template.id, template] as const))(
    'every command holds the contract on the canvas %s builds',
    (_id, template) => {
      const applied = commands.applyTemplate(emptyCanvas(), idsFor(template));
      expect(applied.applied).toBe(true);
      const state = applied.state;
      const before = new Set(checkInvariants(state).map(violation => violation.code));

      const failures: string[] = [];
      let transitions = 0;
      for (const instance of commandInstances(state)) {
        transitions++;
        const result = instance.run(state);

        if (!result.applied) {
          if (result.state !== state) failures.push(`${instance.label} :: refused but returned a different state`);
          if (!result.diagnostics.some(diagnostic => diagnostic.level === 'error')) {
            failures.push(`${instance.label} :: refused with no error diagnostic`);
          }
          continue;
        }

        const introduced = checkInvariants(result.state)
          .map(violation => violation.code)
          .filter(code => !before.has(code));
        if (introduced.length > 0) failures.push(`${instance.label} :: introduced [${introduced}]`);
      }

      expect(failures, `${failures.length} failure(s):\n${failures.slice(0, 10).join('\n')}`).toEqual([]);
      // Not pinned to a literal: the instance vocabulary is a function of the
      // template's own node and edge counts, which differ per template and are
      // the thing under test elsewhere in this file. What must not happen is
      // the list coming out empty and this passing vacuously.
      expect(transitions).toBeGreaterThan(0);
    },
  );
});

describe('construct-then-query is not a shape v1 has', () => {
  // The plan names the third template "construct-then-query". A SPARQL node can
  // only see upstream RDF through a shared ephemeral store, which the flat API
  // cannot express, so the backend rejects that edge as inert
  // (`EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME`) and `checkNodeKinds` refuses it
  // here. Shipping the plan's wording would have put a button on the empty
  // state that fails on click, so the template is construct-then-*rules*.
  const constructThenQuery: CanvasTemplate = {
    id: 'construct-then-rules',
    label: 'Construct, then query',
    description: 'The shape the plan named.',
    steps: [
      { key: 'construct', kind: 'query', label: 'Construct graph', column: 0, row: 0 },
      { key: 'consumer', kind: 'query', label: 'Query the graph', column: 1, row: 0 },
    ],
    edges: [
      { from: 'start', to: 'construct', flowType: 'VARIABLE_BINDINGS' },
      { from: 'construct', to: 'consumer', flowType: 'RDF_GRAPH' },
      { from: 'consumer', to: 'end', flowType: 'VARIABLE_BINDINGS' },
    ],
  };

  it('is refused, naming the rule rather than paraphrasing it', () => {
    const state = emptyCanvas();

    const result = commands.applyTemplate(state, idsFor(constructThenQuery));

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['rdf-graph-target-cannot-consume']);
  });

  it('leaves nothing behind, though its first edge was legal', () => {
    // All or nothing, as `addStep` is. The refusal lands on the *second* edge,
    // so a command that applied as it went would leave a node wired to Start
    // and a second one wired to nothing.
    const state = emptyCanvas();

    const result = commands.applyTemplate(state, idsFor(constructThenQuery));

    expect(result.state).toBe(state);
    expect(checkInvariants(result.state)).toEqual([]);
  });

  it('is the shape the shipped template replaces, one node kind apart', () => {
    const shipped = templateById('construct-then-rules')!;
    expect(shipped.steps.map(step => step.kind)).toEqual(['query', 'ruleset']);
    expect(shipped.edges.map(edge => edge.flowType)).toEqual([
      'VARIABLE_BINDINGS',
      'RDF_GRAPH',
      'RDF_GRAPH',
    ]);
  });
});

describe('applyTemplate refusals', () => {
  it('refuses a canvas that already has a step, and says what to use instead', () => {
    const state = createGraphStateFromExpanded(selectGroupVersionExpanded({ withSecondNode: true }));

    const result = commands.applyTemplate(state, idsFor(templateById('linear-chain')!));

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['template-canvas-not-empty']);
    expect(result.diagnostics[0].message).toContain('Add step');
    expect(result.state).toBe(state);
  });

  it('refuses a canvas with no boundary to wire to', () => {
    const base = emptyCanvas();
    const state: QueryGroupGraphState = { ...base, nodes: base.nodes.filter(node => node.kind !== 'end') };

    const result = commands.applyTemplate(state, idsFor(templateById('linear-chain')!));

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['template-boundary-missing']);
  });

  it.each([
    ['too few node ids', { nodes: -1, edges: 0 }],
    ['too many node ids', { nodes: 1, edges: 0 }],
    ['too few edge ids', { nodes: 0, edges: -1 }],
  ])('refuses %s rather than building a partial shape', (_label, delta) => {
    const template = templateById('linear-chain')!;
    const params = idsFor(template);
    const trimmed = {
      template,
      nodeIds: delta.nodes < 0 ? params.nodeIds.slice(1) : [...params.nodeIds, 'urn:test:tpl:extra'],
      edgeIds: delta.edges < 0 ? params.edgeIds.slice(1) : params.edgeIds,
    };

    const result = commands.applyTemplate(emptyCanvas(), trimmed);

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['template-id-count']);
  });

  it('refuses an id the canvas already holds', () => {
    const state = emptyCanvas();
    const template = templateById('linear-chain')!;
    const params = idsFor(template);

    const result = commands.applyTemplate(state, {
      ...params,
      nodeIds: [IDS.startNode, ...params.nodeIds.slice(1)],
    });

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['template-id-collision']);
    expect(result.state).toBe(state);
  });

  it('refuses ids repeated within one template', () => {
    const template = templateById('linear-chain')!;
    const params = idsFor(template);

    const result = commands.applyTemplate(emptyCanvas(), {
      ...params,
      nodeIds: [params.nodeIds[0], params.nodeIds[0]],
    });

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['template-id-collision']);
  });

  it('refuses a template that gives two steps one name', () => {
    // Also unreachable from the catalogue, and also a half-built shape rather
    // than a cosmetic fault: the second step under the key is minted and then
    // wired to nothing, because every edge naming it addresses the first.
    const broken: CanvasTemplate = {
      id: 'linear-chain',
      label: 'Broken',
      description: 'Two steps, one name.',
      steps: [
        { key: 'first', kind: 'query', label: 'First', column: 0, row: 0 },
        { key: 'first', kind: 'query', label: 'Also first', column: 1, row: 0 },
      ],
      edges: [
        { from: 'start', to: 'first', flowType: 'VARIABLE_BINDINGS' },
        { from: 'first', to: 'end', flowType: 'VARIABLE_BINDINGS' },
      ],
    };

    const state = emptyCanvas();
    const result = commands.applyTemplate(state, idsFor(broken));

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['template-step-keys-duplicated']);
    expect(result.state).toBe(state);
  });

  it('refuses a template naming a step it does not declare', () => {
    // Unreachable from the catalogue, which the structural tests above cover.
    // Checked because the command takes a template rather than an id, so a
    // caller can hand it one the catalogue never vetted.
    const broken: CanvasTemplate = {
      id: 'linear-chain',
      label: 'Broken',
      description: 'Names a step that is not there.',
      steps: [{ key: 'first', kind: 'query', label: 'First', column: 0, row: 0 }],
      edges: [
        { from: 'start', to: 'first', flowType: 'VARIABLE_BINDINGS' },
        { from: 'nowhere', to: 'end', flowType: 'VARIABLE_BINDINGS' },
      ],
    };

    const state = emptyCanvas();
    const result = commands.applyTemplate(state, idsFor(broken));

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['template-endpoint-unknown']);
    expect(result.diagnostics[0].message).toContain('nowhere');
    expect(result.state).toBe(state);
  });
});
