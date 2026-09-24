/**
 * The Signature section of the Details panel: VALUES variables grouped by the
 * clause that binds them, LIMIT and OFFSET named by their keyword, and outputs
 * that follow from the query's form.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { QueryTypeIri } from '@sparql-query-lib/types';
import EntityDetailsPanel from '@/components/shared/EntityDetailsPanel.vue';

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(EntityDetailsPanel, {
    props: {
      name: 'q',
      description: '',
      isScratch: true,
      entityId: null,
      versionOptions: [],
      selectedVersion: null,
      currentVersion: null,
      editCount: 0,
      draftSavedAt: null,
      draftSelected: false,
      ...overrides,
    },
    global: { stubs: { EntityTagsField: true, SearchSelect: true } },
  });
}

const inputs = (w: ReturnType<typeof mountPanel>) => w.find('[data-testid="signature-inputs"]');
const outputs = (w: ReturnType<typeof mountPanel>) => w.find('[data-testid="signature-outputs"]');

describe('EntityDetailsPanel — signature', () => {
  it('draws one group per VALUES clause', () => {
    const w = mountPanel({
      detectedInputs: {
        valuesInputs: [['s'], ['p', 'o']],
        limitParameters: [],
        offsetParameters: [],
        correlatedExistsInputs: [],
      },
    });
    const groups = inputs(w).findAll('[data-testid="signature-input-group"]');
    expect(groups.map((g) => g.findAll('.chip-mono').map((c) => c.text()))).toEqual([['s'], ['p', 'o']]);
  });

  it('names limits and offsets by their keyword', () => {
    const w = mountPanel({
      detectedInputs: {
        valuesInputs: [],
        limitParameters: ['pageSize'],
        offsetParameters: ['start'],
        correlatedExistsInputs: [],
      },
    });
    const params = inputs(w).findAll('[data-testid="signature-page-parameter"]').map((p) => p.text());
    expect(params).toEqual(['LIMITpageSize', 'OFFSETstart']);
    expect(inputs(w).find('[data-testid="signature-input-group"]').exists()).toBe(false);
  });

  it('lists variables for a SELECT', () => {
    const w = mountPanel({ queryType: QueryTypeIri.select, detectedOutputs: ['a', 'b'] });
    expect(outputs(w).findAll('.chip-mono').map((c) => c.text())).toEqual(['a', 'b']);
  });

  it('says boolean for an ASK and RDF graph for a CONSTRUCT', () => {
    expect(outputs(mountPanel({ queryType: QueryTypeIri.ask })).text()).toContain('boolean');
    expect(outputs(mountPanel({ queryType: QueryTypeIri.construct })).text()).toContain('RDF graph');
    expect(outputs(mountPanel({ queryType: QueryTypeIri.describe })).text()).toContain('RDF graph');
  });

  it('says None, in italics, for an update', () => {
    for (const type of [QueryTypeIri.insert, QueryTypeIri.load]) {
      const none = outputs(mountPanel({ queryType: type })).find('em');
      expect(none.text()).toBe('None');
    }
  });
});
