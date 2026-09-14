import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import DialogTitleBar from '@/components/shared/DialogTitleBar.vue';

/*
 * The bar is why the three full-bleed dialogs stopped writing their own title
 * row, and the reason it is not `PanelHeader` is accessibility rather than
 * taste: `DialogContent` names itself by pointing `aria-labelledby` at the
 * `DialogTitle` inside it, so a bar that rendered a plain `<h3>` would leave
 * every one of those dialogs unnamed. That is what the first test pins.
 *
 * `DialogContent` portals to the body, so these mount a host and read the
 * document rather than the wrapper.
 */
function host(props: Record<string, unknown> = {}, slots: Record<string, () => unknown> = {}) {
  return defineComponent({
    setup: () => () =>
      h(Dialog, { open: true }, () => [
        h(DialogContent, { class: 'p-0 gap-0', showCloseButton: false }, () => [
          h(DialogTitleBar, props, slots),
        ]),
      ]),
  });
}

async function open(props: Record<string, unknown> = {}, slots: Record<string, () => unknown> = {}) {
  const wrapper = mount(host(props, slots), { attachTo: document.body });
  await nextTick();
  await nextTick();
  return wrapper;
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!found) throw new Error('no dialog rendered');
  return found;
}

/** What a screen reader would read out as the dialog's name. */
function accessibleName(): string {
  const id = dialog().getAttribute('aria-labelledby');
  return id ? (document.getElementById(id)?.textContent ?? '').trim() : '';
}

describe('DialogTitleBar', () => {
  // The portal writes into the body; `setup-unmount.ts` unmounts the wrapper
  // after each test, so the reset belongs before the next one rather than
  // after this one — clearing the body first pulls the tree out from under
  // that unmount.
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('gives the dialog its accessible name', async () => {
    await open({ title: 'Prefix Manager' });
    expect(accessibleName()).toBe('Prefix Manager');
  });

  it('describes the dialog when a description is given, and stacks it', async () => {
    await open({ title: 'Settings', description: 'Preferences for this browser only.' });

    const id = dialog().getAttribute('aria-describedby');
    expect(id, 'a description in the bar is the dialog’s aria-describedby').toBeTruthy();
    expect(document.getElementById(id!)?.textContent?.trim()).toBe('Preferences for this browser only.');
    // Two lines tall, so the ✕ sits beside the title rather than centred on both.
    expect(document.querySelector('.dialog-title-bar--stacked')).not.toBeNull();
  });

  it('leaves the row centred when there is only a title', async () => {
    await open({ title: 'Sync with endpoint' });
    expect(document.querySelector('[data-slot="dialog-header"]')).not.toBeNull();
    expect(document.querySelector('.dialog-title-bar--stacked')).toBeNull();
  });

  it('puts meta on the title’s baseline and actions before the ✕', async () => {
    await open(
      { title: 'Prefix Manager' },
      {
        meta: () => h('span', { class: 'prefix-count' }, '42 mappings'),
        actions: () => h('button', { type: 'button', title: 'More actions' }),
      },
    );

    expect(document.querySelector('.dialog-title-bar__title-row .prefix-count')?.textContent)
      .toBe('42 mappings');
    const actions = [...document.querySelectorAll('.dialog-title-bar__actions button')];
    expect(actions.map((b) => b.getAttribute('title'))).toEqual(['More actions', 'Close']);
  });

  it('emits close from the ✕ rather than closing the dialog itself', async () => {
    /*
     * The three dialogs differ in what closing means — one runs a handler, two
     * write their own `open` model — so the bar reports the click and the
     * dialog decides. A bar that called `DialogClose` would take that away.
     */
    const seen: string[] = [];
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(Dialog, { open: true }, () => [
            h(DialogContent, { class: 'p-0 gap-0', showCloseButton: false }, () => [
              h(DialogTitleBar, { title: 'Settings', onClose: () => seen.push('close') }),
            ]),
          ]),
      }),
      { attachTo: document.body },
    );
    await nextTick();
    await nextTick();

    document.querySelector<HTMLElement>('.dialog-title-bar__close')!.click();
    expect(seen).toEqual(['close']);
    expect(document.querySelector('[role="dialog"]'), 'the dialog stays open until its owner says otherwise').not.toBeNull();
    expect(wrapper.exists()).toBe(true);
  });

  it('labels the ✕ for a screen reader and for a pointer', async () => {
    await open({ title: 'Settings' });
    const close = document.querySelector<HTMLElement>('.dialog-title-bar__close')!;
    expect(close.getAttribute('aria-label')).toBe('Close');
    expect(close.getAttribute('title')).toBe('Close');
    // A button inside a dialog with no type is a submit button in a form.
    expect(close.getAttribute('type')).toBe('button');
  });
});
