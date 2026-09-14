import { describe, it, expect } from 'vitest';

import { buildCanvasNodeData } from '@/composables/useQueryGroupGraphState';
import type { GraphNodeState } from '@/composables/useQueryGroupGraph';

/**
 * What a node card is titled.
 *
 * The card used to derive its own title - the attached query's name, then the
 * kind's - and never read the name the author typed into the inspector's
 * "Display label" field, so renaming a node changed nothing on the graph and a
 * canvas of unassigned steps was a row of identical boxes. It reads
 * `canvasNodeLabel`'s answer now, and these pin that the answer is the same one
 * the card drew before wherever an author has not named anything.
 */

const IRI_MAP = {
  'urn:version:select': 'City lookup',
  'urn:version:rules': 'Postcode rules',
  'urn:version:update': 'Retire the old codes',
};

const graphNode = (node: Partial<GraphNodeState> & Pick<GraphNodeState, 'kind'>): GraphNodeState => ({
  id: 'urn:ui-temp:node-1',
  label: '',
  inputs: [],
  outputs: [],
  ...node,
});

async function titleOf(node: GraphNodeState): Promise<string> {
  const { mount } = await import('@vue/test-utils');
  const Card = (await import('@/components/query-group/QueryGroupCanvasNode.vue')).default;
  const wrapper = mount(Card, {
    props: { data: buildCanvasNodeData(node, IRI_MAP), selected: false } as never,
    global: { stubs: { Handle: true } },
  });
  return wrapper.get('.node-kind').text();
}

describe('QueryGroupCanvasNode: the name on the card', () => {
  it('draws the name the author typed, over whatever the node is attached to', async () => {
    expect(
      await titleOf(graphNode({ kind: 'query', label: 'Step one', queryVersionId: 'urn:version:select' })),
    ).toBe('Step one');
    expect(
      await titleOf(graphNode({ kind: 'ruleset', label: 'Step two', ruleSetVersionId: 'urn:version:rules' })),
    ).toBe('Step two');
  });

  it('draws what the node is attached to when nobody has named it', async () => {
    expect(await titleOf(graphNode({ kind: 'query', queryVersionId: 'urn:version:select' }))).toBe('City lookup');
    expect(await titleOf(graphNode({ kind: 'ruleset', ruleSetVersionId: 'urn:version:rules' }))).toBe('Postcode rules');
    expect(await titleOf(graphNode({ kind: 'patch', queryVersionId: 'urn:version:update' }))).toBe('Retire the old codes');
  });

  it('draws what the node is when it is neither named nor attached', async () => {
    expect(await titleOf(graphNode({ kind: 'query' }))).toBe('Query Node');
    expect(await titleOf(graphNode({ kind: 'dynamic' }))).toBe('Dynamic Query Node');
    expect(await titleOf(graphNode({ kind: 'ruleset' }))).toBe('Ruleset Node');
    expect(await titleOf(graphNode({ kind: 'patch' }))).toBe('Patch Node');
  });

  /*
   * A dynamic node runs whichever query an edge hands it, so a version it
   * happens to name is not what it runs - naming the card after it would name it
   * after the wrong query.
   */
  it('keeps a dynamic node named for what it is, even holding a query version', async () => {
    expect(await titleOf(graphNode({ kind: 'dynamic', queryVersionId: 'urn:version:select' }))).toBe('Dynamic Query Node');
  });

  it('falls back to its own derivation for data it did not build', async () => {
    const { mount } = await import('@vue/test-utils');
    const Card = (await import('@/components/query-group/QueryGroupCanvasNode.vue')).default;
    const wrapper = mount(Card, {
      props: { data: { kind: 'ruleset', attachedName: 'Postcode rules' }, selected: false } as never,
      global: { stubs: { Handle: true } },
    });

    expect(wrapper.get('.node-kind').text()).toBe('Postcode rules');
  });
});
