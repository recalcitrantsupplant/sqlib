import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import { Dialog, DialogContent } from '@/components/ui/dialog';

/*
 * `DialogContent`'s root is a `DialogPortal`, and a portal renders a Teleport
 * — no element for Vue to fall an attribute through to. So a caller that
 * writes `data-testid="tag-manager"` on the dialog used to get an
 * "Extraneous non-props attributes" warning and no attribute anywhere in the
 * DOM: the whole point of the testid, gone, on the component that half the
 * dialogs in the app are built from. `TagManagerDialog` is the one that
 * reported it (opening Tags from the nav rail), but every dialog shares the
 * component, so this pins the component rather than that caller.
 *
 * The dialog portals to the body, so these read the document rather than the
 * wrapper.
 */
function host() {
  return defineComponent({
    setup: () => () =>
      h(Dialog, { open: true }, () => [
        h(DialogContent, { 'data-testid': 'tag-manager', title: 'Tags' }, () => [h('p', 'body')]),
      ]),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DialogContent attribute fallthrough', () => {
  it('puts a caller attribute on the dialog box, without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mount(host(), { attachTo: document.body });
    await nextTick();
    await nextTick();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('data-testid')).toBe('tag-manager');
    expect(dialog?.getAttribute('title')).toBe('Tags');

    const extraneous = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes('Extraneous non-props attributes'));
    expect(extraneous).toEqual([]);
  });
});
