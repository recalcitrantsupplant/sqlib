import { describe, it, expect, vi } from 'vitest';
import { computed, ref } from 'vue';
import { mount } from '@vue/test-utils';

/*
 * The token line follows the instance's sign-in, which `useAuth` reads from
 * `/health`. The stub stands in for both kinds of instance.
 */
const usesSignIn = ref(false);
vi.mock('@/composables/useAuth', () => ({
  useAuth: () => ({
    usesSignIn: computed(() => usesSignIn.value),
    isAuthenticated: computed(() => false),
    freshAccessToken: async () => null,
  }),
}));

const { default: CodeSnippetPanel } = await import('@/components/shared/CodeSnippetPanel.vue');

const REQUEST = {
  method: 'POST' as const,
  url: 'https://api.sqlib.io/v1/execute',
  body: { targetId: 'urn:example:query:1' },
};

describe('CodeSnippetPanel token line', () => {
  it('sends a token on an instance that uses sign-in', () => {
    usesSignIn.value = true;
    const panel = mount(CodeSnippetPanel, { props: { request: REQUEST } });
    expect(panel.get('[data-testid="code-snippet"]').text()).toContain('Authorization: Bearer $SQLIB_TOKEN');
  });

  it('sends none on an instance without sign-in', () => {
    usesSignIn.value = false;
    const panel = mount(CodeSnippetPanel, { props: { request: REQUEST } });
    const snippet = panel.get('[data-testid="code-snippet"]').text();
    expect(snippet).not.toContain('Authorization');
    expect(snippet).toContain('urn:example:query:1');
  });
});
