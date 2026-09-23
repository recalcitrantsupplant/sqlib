/**
 * What a read-only deployment stops offering.
 *
 * `SQLIB_READ_ONLY=true` makes the API refuse every write to its own state
 * (the API's `config/readOnly.ts`), so a Save button there can do one thing:
 * report a 405. These controls are absent rather than disabled, for the reason
 * the rail hides a switched-off section rather than greying it — a control
 * that can only refuse teaches nothing, and a tooltip explaining the
 * deployment model taxes every visit.
 *
 * What stays is everything acting on the browser: Discard, the body icons, the
 * scratch record itself. That is the whole of the read-only model — the
 * catalogue changes by redeployment, and what you author is yours.
 *
 * Each bar reads the mode itself rather than taking a prop, so a screen cannot
 * forget to pass it; these mount the bars directly for that reason.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import SaveBar from '@/components/shared/SaveBar.vue';
import RunBar from '@/components/shared/RunBar.vue';
import ArgumentSetFooter from '@/components/query-work-area/ArgumentSetFooter.vue';
import { resetDeploymentMode, useDeploymentMode } from '@/composables/useDeploymentMode';

const realFetch = globalThis.fetch;

/** `/health` as the deployment answers it. */
function healthSaying(readOnly: boolean) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ status: 'ok', readOnly }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as typeof globalThis.fetch;
}

async function deploymentIs(readOnly: boolean) {
  healthSaying(readOnly);
  await useDeploymentMode().ensureLoaded();
}

beforeEach(() => {
  resetDeploymentMode();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const saveBarProps = {
  title: 'Cities',
  isScratch: false,
  currentVersionNumber: 1,
  editCount: 2,
  saving: false,
  canSave: true,
};

describe('the save bar', () => {
  it('offers Save and Delete on a deployment that keeps things', async () => {
    await deploymentIs(false);
    const bar = mount(SaveBar, { props: saveBarProps });
    await flushPromises();

    expect(bar.find('[data-testid="save"]').exists()).toBe(true);
    expect(bar.find('[data-testid="query-more"]').exists()).toBe(true);
  });

  it('drops Save when the deployment is read-only', async () => {
    await deploymentIs(true);
    const bar = mount(SaveBar, { props: saveBarProps });
    await flushPromises();

    expect(bar.find('[data-testid="save"]').exists()).toBe(false);
  });

  /* Discard throws away the browser's own copy, which read-only does not touch. */
  it('keeps Discard, which acts on this browser', async () => {
    await deploymentIs(true);
    const bar = mount(SaveBar, { props: saveBarProps });
    await flushPromises();

    expect(bar.find('[data-testid="discard-draft"]').exists()).toBe(true);
  });

  /*
   * Both standing entries in the ⋮ write to the server, so a menu holding
   * nothing else opens onto two refusals.
   */
  it('takes the ⋮ away when it would hold only refusals', async () => {
    await deploymentIs(true);
    const bar = mount(SaveBar, { props: saveBarProps });
    await flushPromises();

    expect(bar.find('[data-testid="query-more"]').exists()).toBe(false);
  });

  it('keeps the ⋮ where a section put something of its own in it', async () => {
    await deploymentIs(true);
    const bar = mount(SaveBar, {
      props: saveBarProps,
      slots: { 'menu-items': '<div data-testid="preview-changes" />' },
    });
    await flushPromises();

    expect(bar.find('[data-testid="query-more"]').exists()).toBe(true);
  });
});

describe('the run bar', () => {
  const runBarProps = {
    createTargets: ['benchmark', 'test'] as ('benchmark' | 'test')[],
    recipeNoun: 'query',
  };

  it('offers a test and a benchmark to keep the recipe as', async () => {
    await deploymentIs(false);
    const bar = mount(RunBar, { props: runBarProps });
    await flushPromises();

    expect(bar.find('[data-testid="run-bar-create-test"]').exists()).toBe(true);
  });

  /* Running still works read-only; keeping what you ran is what does not. */
  it('drops them when nothing can be kept, and still draws Run', async () => {
    await deploymentIs(true);
    const bar = mount(RunBar, { props: runBarProps });
    await flushPromises();

    expect(bar.find('[data-testid="run-bar-create-test"]').exists()).toBe(false);
    expect(bar.find('[data-testid="run-bar-create-benchmark"]').exists()).toBe(false);
    expect(bar.find('[data-testid="run-bar-run"]').exists()).toBe(true);
  });
});

describe('the argument set footer', () => {
  const footerProps = { dirty: true, scratch: true, nextVersion: 1, canSave: true };

  it('offers Save where a set can be saved', async () => {
    await deploymentIs(false);
    const footer = mount(ArgumentSetFooter, { props: footerProps });
    await flushPromises();

    expect(footer.find('[data-testid="arguments-save"]').exists()).toBe(true);
  });

  it('leaves only Discard when it cannot', async () => {
    await deploymentIs(true);
    const footer = mount(ArgumentSetFooter, { props: footerProps });
    await flushPromises();

    expect(footer.find('[data-testid="arguments-save"]').exists()).toBe(false);
    expect(footer.find('[data-testid="arguments-discard"]').exists()).toBe(true);
  });
});
