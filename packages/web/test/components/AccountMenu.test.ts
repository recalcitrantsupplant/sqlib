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
const signedIn = ref(false);
const freshAccessToken = vi.fn();
const push = vi.fn();

vi.mock('#imports', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push }),
}));

vi.mock('@/composables/useAuth', () => ({
  useAuth: () => ({
    account: computed(() => state.account.value),
    me: computed(() => state.me.value),
    login,
    logout,
    isAuthenticated: computed(() => signedIn.value),
    freshAccessToken,
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
  signedIn.value = false;
  freshAccessToken.mockReset();
  push.mockClear();
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
    const access = menu.querySelector('[data-testid="account-access"]')!;
    const library = access.querySelector('[data-testid="account-access-library"]')!;
    expect(library.textContent).toContain('Finance queries');
    expect(library.querySelector('.grant-chip--run')!.textContent).toBe('Run');
    expect(library.querySelector('.grant-chip--run')!.getAttribute('title')).toBe('read, execute');
    const backend = access.querySelector('[data-testid="account-access-backend"]')!;
    expect(backend.textContent).toContain('Company data');
    expect([...backend.querySelectorAll('.grant-chip')].map((chip) => chip.textContent)).toEqual(['saved', 'none']);
    expect(backend.querySelector('.grant-chip--none')).not.toBeNull();
    expect(menu.querySelector('[data-testid="account-sign-out"]')).not.toBeNull();
    wrapper.unmount();
  });

  it('opens a library or backend from its row', async () => {
    state.account.value = { state: 'signed-in', identity: { name: 'Priya Shah', email: null } };
    state.me.value = me();
    let wrapper = await open();
    document.body.querySelector<HTMLElement>('[data-testid="account-access-library"]')!.click();
    expect(push).toHaveBeenCalledWith({ path: '/library', query: { library: LIBRARY } });
    wrapper.unmount();

    document.body.innerHTML = '';
    wrapper = await open();
    document.body.querySelector<HTMLElement>('[data-testid="account-access-backend"]')!.click();
    expect(push).toHaveBeenLastCalledWith({ path: `/backends/${encodeURIComponent(BACKEND)}` });
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

  it('copies the token as an export line, and shows its expiry the next time it opens', async () => {
    state.account.value = { state: 'signed-in', identity: { name: 'Priya Shah', email: null } };
    state.me.value = me();
    signedIn.value = true;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    freshAccessToken.mockResolvedValue({ token: 'aaa.bbb.ccc', expiresAt });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const wrapper = await open();
    const item = document.body.querySelector<HTMLElement>('[data-testid="account-copy-token"]')!;
    expect(item.textContent).toContain('Copy API token');
    expect(document.body.querySelector('[data-testid="account-token-expiry"]')).toBeNull();
    item.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("export SQLIB_TOKEN='aaa.bbb.ccc'"));
    wrapper.unmount();

    document.body.innerHTML = '';
    const again = await open();
    expect(document.body.querySelector('[data-testid="account-token-expiry"]')!.textContent).toContain('until');
    again.unmount();
  });

  it('offers no token after the session lapsed', async () => {
    state.account.value = { state: 'expired', identity: { name: 'Priya Shah', email: null } };
    state.me.value = null;
    signedIn.value = false;
    const wrapper = await open();
    expect(document.body.querySelector('[data-testid="account-copy-token"]')).toBeNull();
    wrapper.unmount();
  });
});
