/**
 * "Copy token": puts `export SQLIB_TOKEN='…'` on the clipboard, for curl and
 * scripts run outside the app.
 *
 * The token is the one the app already holds for the signed-in person, so it
 * carries their grants and nothing more, and it lapses with its normal
 * lifetime. sqlib issues no token of its own.
 *
 * The state is module-level, so the Code tab and the account menu show the
 * same expiry for the token last copied.
 */
import { computed, ref } from 'vue';
import { useAuth } from './useAuth';
import { formatExpiry, tokenExportLine } from '../lib/apiToken';

const copiedExpiry = ref<Date | null>(null);
const justCopied = ref(false);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
let flash: ReturnType<typeof setTimeout> | null = null;

/** Ticks once a minute while a copied token is live, so its pill goes away when it lapses. */
function startClock(): void {
  if (clock) return;
  clock = setInterval(() => {
    now.value = Date.now();
    if (!copiedExpiry.value || copiedExpiry.value.getTime() <= now.value) {
      copiedExpiry.value = null;
      if (clock) clearInterval(clock);
      clock = null;
    }
  }, 60_000);
}

export function useApiTokenCopy() {
  const { isAuthenticated, freshAccessToken } = useAuth();

  const expiresLabel = computed(() => {
    const expiry = copiedExpiry.value;
    if (!expiry || expiry.getTime() <= now.value) return null;
    return formatExpiry(expiry);
  });

  /** Returns true when the line reached the clipboard. */
  const copyToken = async (): Promise<boolean> => {
    const fresh = await freshAccessToken();
    if (!fresh) return false;
    try {
      await navigator.clipboard.writeText(tokenExportLine(fresh.token));
    } catch {
      return false;
    }
    now.value = Date.now();
    copiedExpiry.value = fresh.expiresAt;
    if (fresh.expiresAt) startClock();
    justCopied.value = true;
    if (flash) clearTimeout(flash);
    flash = setTimeout(() => {
      justCopied.value = false;
    }, 1500);
    return true;
  };

  return {
    /** Only a signed-in person has a token to copy. */
    available: isAuthenticated,
    justCopied: computed(() => justCopied.value),
    expiresLabel,
    copyToken,
  };
}

/** For the tests: forget the last copy. */
export function resetApiTokenCopy(): void {
  copiedExpiry.value = null;
  justCopied.value = false;
  if (clock) clearInterval(clock);
  if (flash) clearTimeout(flash);
  clock = null;
  flash = null;
}
