/**
 * The account at the foot of the rail: who is signed in, their groups, and
 * what they can reach — or a guest in an anonymous deployment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import AccountMenu from '@/components/account/AccountMenu.vue';
import type { AuthMe } from '@/composables/useAuth';
import type { AccountState } from '@/lib/account';

const LIBRARY = 'urn:sqlib:library:finance';
const BACKEND = 'urn:sqlib:backend:company';

const state = {
  account: ref<{ state: AccountState; identity: { name: string | null; email: string | null } }>({
    state: 'none',
    identity: { name: null, email: null },
  }),
  me: ref<AuthMe | null>(null),
};
const login = vi.fn();
const logout = vi.fn();

vi.mock('@/composables/useAuth', () => ({
  useAuth: () => ({
    account: computed(() => state.account.value),
    me: computed(() => state.me.value),
    login,
    logout,
  }),
}));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ libraries: ref([{ id: LIBRARY, name: 'Finance queries' }]) }),
}));
vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({ backends: ref([{ id: BACKEND, name: 'Company data' }]) }),
}));

function me(overrides: Partial<AuthMe> = {}): AuthMe {
  return {
    authMode: 'required',
    authenticated: true,
    subject: 'urn:sqlib:principal:user:priya',
    issuer: 'https://auth.example.com/auth/v1',
    tokenType: 'user',
    principals: [],
    groups: [{ iri: 'urn:sqlib:principal:group:a', name: 'analysts' }, { iri: 'urn:sqlib:principal:group:b' }],
    admin: false,
    libraries: { [LIBRARY]: ['execute', 'read'] },
    backends: { [BACKEND]: ['query:saved'] },
    ...overrides,
  };
}

async function open() {
  const wrapper = mount(AccountMenu, { attachTo: document.body });
  await wrapper.get('[data-testid="account-button"]').trigger('keydown', { key: 'Enter' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return wrapper;
}

beforeEach(() => {
  login.mockClear();
  logout.mockClear();
  document.body.innerHTML = '';
});

describe('AccountMenu', () => {
  it('renders nothing when there is no account to show', () => {
    const wrapper = mount(AccountMenu);
    expect(wrapper.find('[data-testid="account-button"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the signed-in person, their named groups and what they can reach', async () => {
    state.account.value = { state: 'signed-in', identity: { name: 'Priya Shah', email: 'priya@example.com' } };
    state.me.value = me();
    const wrapper = await open();

    expect(wrapper.get('[data-testid="account-button"]').attributes('aria-label')).toBe('Account — Priya Shah');
    expect(wrapper.get('[data-testid="account-button"]').text()).toBe('PS');
    const menu = document.body.querySelector('[data-testid="account-menu"]')!;
    expect(menu.textContent).toContain('priya@example.com');
    expect(menu.textContent).toContain('auth.example.com');
    expect(menu.querySelector('[data-testid="account-groups"]')!.textContent).toBe('analysts');
    const access = menu.querySelector('[data-testid="account-access"]')!.textContent!;
    expect(access).toContain('Finance queries');
    expect(access).toContain('Run');
    expect(access).toContain('Company data');
    expect(access).toContain('Query saved · Update none');
    expect(menu.querySelector('[data-testid="account-sign-out"]')).not.toBeNull();
    wrapper.unmount();
  });

  it('offers to sign in again after the session lapsed', async () => {
    state.account.value = { state: 'expired', identity: { name: 'Priya Shah', email: null } };
    state.me.value = null;
    const wrapper = await open();

    expect(wrapper.get('[data-testid="account-button"]').attributes('aria-label')).toContain('Session expired');
    expect(document.body.querySelector('[data-testid="account-sign-in"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="account-sign-out"]')).toBeNull();
    wrapper.unmount();
  });

  it('shows a guest what the anonymous principal can do, with no sign-out', async () => {
    state.account.value = { state: 'guest', identity: { name: null, email: null } };
    state.me.value = me({ authMode: 'anonymous', authenticated: false, issuer: null, groups: [] });
    const wrapper = await open();

    const menu = document.body.querySelector('[data-testid="account-menu"]')!;
    expect(menu.querySelector('[data-testid="account-name"]')!.textContent).toBe('Guest user');
    expect(menu.querySelector('[data-testid="account-access"]')!.textContent).toContain('Finance queries');
    expect(menu.querySelector('[data-testid="account-sign-out"]')).toBeNull();
    expect(menu.querySelector('[data-testid="account-sign-in"]')).toBeNull();
    wrapper.unmount();
  });
});
