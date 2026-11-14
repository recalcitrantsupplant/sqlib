/**
 * Who made and last changed an entity, in the Details panel: the footer
 * lines, the author on each version row, and the person chip's three cases
 * (a named person, the caller, and a person this server has no name for).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

const ALICE = 'urn:sqlib:principal:user:alice';
const BOB = 'urn:sqlib:principal:user:bob';
const STRANGER = 'urn:sqlib:principal:user:from-another-server';

const lookupPrincipalNames = vi.fn(async (iris: string[]) =>
  iris.flatMap((iri) => (iri === ALICE ? [{ iri, displayName: 'Alice Ng' }] : [])),
);

vi.mock('@/composables/useApiClient', () => ({
  useApiClient: () => ({ lookupPrincipalNames }),
}));

vi.mock('@/composables/useAuth', () => ({
  useAuth: () => ({ me: computed(() => ({ subject: BOB, displayName: 'Bo Li' })) }),
}));

/** The words of a footer line or chip, without the avatar's initials. */
function words(element: { find: (selector: string) => { exists(): boolean; text(): string }; text(): string }) {
  const text = element.text();
  const initials = element.find('.avatar').exists() ? element.find('.avatar').text() : '';
  return initials ? text.replace(initials, '').replace(/\s+/g, ' ').trim() : text;
}

async function mountPanel(overrides: Record<string, unknown> = {}) {
  const { resetPrincipalNames } = await import('@/composables/usePrincipalNames');
  resetPrincipalNames();
  const { default: EntityDetailsPanel } = await import('@/components/shared/EntityDetailsPanel.vue');
  const wrapper = mount(EntityDetailsPanel, {
    props: {
      name: 'q',
      description: '',
      isScratch: false,
      entityId: 'urn:sqlib:query:q',
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
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  lookupPrincipalNames.mockClear();
});

describe('EntityDetailsPanel — authorship', () => {
  it('names who created the entity and who last edited it', async () => {
    const w = await mountPanel({
      createdAt: '2026-10-28T09:00:00Z',
      createdBy: ALICE,
      modifiedAt: '2026-11-10T09:00:00Z',
      modifiedBy: BOB,
    });
    expect(words(w.find('[data-testid="details-created"]'))).toMatch(/^Created .* by Alice Ng$/);
    expect(words(w.find('[data-testid="details-edited"]'))).toMatch(/^Edited .* by You$/);
  });

  it('shows the dates alone where nobody was recorded', async () => {
    const w = await mountPanel({ createdAt: '2026-10-28T09:00:00Z', modifiedAt: '2026-11-10T09:00:00Z' });
    expect(w.find('[data-testid="details-created"]').text()).not.toContain('by');
    expect(w.find('[data-testid="details-edited"]').text()).not.toContain('by');
    expect(w.find('[data-testid="person-chip"]').exists()).toBe(false);
    expect(lookupPrincipalNames).not.toHaveBeenCalled();
  });

  it('leaves a version saved before authorship was recorded without a name', async () => {
    const w = await mountPanel({
      versionOptions: [{ value: 'v1', label: '1' }],
      currentVersion: 'v1',
      selectedVersion: 'v1',
    });
    expect(w.find('[data-testid="version-row"]').find('[data-testid="version-author"]').exists()).toBe(false);
  });

  it('leaves out the Edited line when nothing changed after the create', async () => {
    const at = '2026-10-28T09:00:00Z';
    const w = await mountPanel({ createdAt: at, createdBy: ALICE, modifiedAt: at, modifiedBy: ALICE });
    expect(w.find('[data-testid="details-edited"]').exists()).toBe(false);
  });

  it('puts the author on each version row, with one name lookup for the screen', async () => {
    const w = await mountPanel({
      versionOptions: [
        { value: 'v3', label: '3', createdBy: ALICE },
        { value: 'v2', label: '2', createdBy: STRANGER },
        { value: 'v1', label: '1' },
      ],
      currentVersion: 'v3',
      selectedVersion: 'v2',
    });
    const authorOf = (row: ReturnType<typeof w.find>) =>
      row.find('.person-name').exists() ? row.find('.person-name').text() : null;
    expect(w.findAll('[data-testid="version-row"]').map(authorOf)).toEqual(['Alice Ng', 'Unknown']);
    expect(w.find('[title="Not known on this server"]').exists()).toBe(true);
    expect(lookupPrincipalNames).toHaveBeenCalledTimes(1);
  });
});
