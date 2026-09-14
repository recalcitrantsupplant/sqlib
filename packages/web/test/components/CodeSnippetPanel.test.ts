import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CodeSnippetPanel from '@/components/shared/CodeSnippetPanel.vue';

const REQUEST = {
  method: 'POST' as const,
  url: 'https://api.sqlib.io/v1/execute',
  body: { targetId: 'urn:example:query:1' },
};

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(CodeSnippetPanel, { props: { request: REQUEST, ...props } as never });
}

describe('CodeSnippetPanel', () => {
  it('switches language without losing the call', async () => {
    const panel = mountPanel();
    expect(panel.get('[data-testid="code-snippet"]').text()).toContain('curl -X POST');

    await panel.get('[data-testid="code-language-python"]').trigger('click');
    const snippet = panel.get('[data-testid="code-snippet"]').text();
    expect(snippet).toContain('requests.post');
    expect(snippet).toContain('urn:example:query:1');
  });

  /*
   * The two states a caller has to be able to tell apart: a call that works
   * once saved, and a call with no id to save yet.
   */
  it('warns on a draft but still offers the snippet', () => {
    const panel = mountPanel({ draftNote: 'Draft — save to call this.' });
    expect(panel.get('[data-testid="code-draft-note"]').text()).toContain('Draft');
    expect(panel.get('[data-testid="code-copy"]').attributes('disabled')).toBeUndefined();
  });

  it('blocks copying when there is no callable id', () => {
    const panel = mountPanel({
      draftNote: 'Draft — save to call this.',
      unavailable: 'This query has not been saved yet.',
    });
    expect(panel.get('[data-testid="code-unavailable"]').text()).toContain('not been saved');
    expect(panel.find('[data-testid="code-draft-note"]').exists()).toBe(false);
    expect(panel.get('[data-testid="code-copy"]').attributes('disabled')).toBeDefined();
  });

  it('lists the arguments the call carries', () => {
    const panel = mountPanel({
      callArguments: [{ name: 'minPopulation', detail: 'integer · LIMIT' }],
      argumentsHint: 'Edit values in the Arguments tab.',
    });
    expect(panel.text()).toContain('Arguments in this call');
    expect(panel.text()).toContain('minPopulation');
    expect(panel.text()).toContain('Edit values in the Arguments tab.');
  });

  it('says nothing about arguments when there are none', () => {
    expect(mountPanel().text()).not.toContain('Arguments in this call');
  });

  /*
   * The toggle is the point of the two-variant panel: a stored set and inline
   * values are different bodies against the same endpoint, and the API refuses
   * a body carrying both.
   */
  describe('argument variants', () => {
    const VARIANTS = [
      {
        id: 'stored',
        label: 'Stored set',
        note: 'Runs the argument set version by id.',
        request: {
          method: 'POST' as const,
          url: 'https://api.sqlib.io/v1/execute',
          body: { targetId: 'urn:example:query:1', argumentSetIds: ['urn:example:set:v2'] },
        },
      },
      {
        id: 'inline',
        label: 'Inline values',
        note: 'Sends the values with the call.',
        request: {
          method: 'POST' as const,
          url: 'https://api.sqlib.io/v1/execute',
          body: {
            targetId: 'urn:example:query:1',
            arguments: [{ head: { vars: ['country'] } }],
          },
        },
      },
    ];

    function mountVariants(props: Record<string, unknown> = {}) {
      return mount(CodeSnippetPanel, {
        props: { variants: VARIANTS, ...props } as never,
      });
    }

    it('switches the body, and never shows both ways at once', async () => {
      const panel = mountVariants({ defaultVariantId: 'stored' });
      expect(panel.get('[data-testid="code-snippet"]').text()).toContain('argumentSetIds');
      expect(panel.get('[data-testid="code-snippet"]').text()).not.toContain('"arguments"');

      await panel.get('[data-testid="code-variant-inline"]').trigger('click');
      const inline = panel.get('[data-testid="code-snippet"]').text();
      expect(inline).toContain('"arguments"');
      expect(inline).not.toContain('argumentSetIds');
    });

    it('opens on the way the screen is currently running it', () => {
      expect(
        mountVariants({ defaultVariantId: 'inline' }).get('[data-testid="code-snippet"]').text(),
      ).toContain('"arguments"');
      expect(
        mountVariants({ defaultVariantId: 'stored' }).get('[data-testid="code-snippet"]').text(),
      ).toContain('argumentSetIds');
    });

    it('keeps a chosen variant when the default moves under it', async () => {
      const panel = mountVariants({ defaultVariantId: 'stored' });
      await panel.get('[data-testid="code-variant-inline"]').trigger('click');
      await panel.setProps({ defaultVariantId: 'stored' } as never);
      expect(panel.get('[data-testid="code-snippet"]').text()).toContain('"arguments"');
    });

    it('explains what each way means', async () => {
      const panel = mountVariants({ defaultVariantId: 'stored' });
      expect(panel.get('[data-testid="code-variant-note"]').text()).toContain('by id');
      await panel.get('[data-testid="code-variant-inline"]').trigger('click');
      expect(panel.get('[data-testid="code-variant-note"]').text()).toContain('with the call');
    });

    it('falls back to the only variant when a screen offers one way', () => {
      const panel = mountVariants({ variants: [VARIANTS[1]] });
      expect(panel.find('[data-testid="code-variant-inline"]').exists()).toBe(false);
      expect(panel.get('[data-testid="code-snippet"]').text()).toContain('"arguments"');
    });
  });
});
