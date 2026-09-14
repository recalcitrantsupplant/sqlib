<script setup lang="ts">
/**
 * OIDC redirect landing page.
 *
 * The IdP sends the browser here with a code; this exchanges it for tokens and
 * returns the user to where they were. Nothing else lives on this route.
 */
// @ts-ignore - Nuxt auto-imports
import { onMounted, ref, useRouter } from '#imports';
import { useAuth } from '../../composables/useAuth';

const router = useRouter();
const auth = useAuth();
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    await auth.completeLogin();
    const returnTo = sessionStorage.getItem('auth:returnTo') || '/';
    sessionStorage.removeItem('auth:returnTo');
    await router.replace(returnTo);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});
</script>

<template>
  <div class="callback">
    <template v-if="error">
      <h1>Sign-in failed</h1>
      <p class="detail">{{ error }}</p>
      <button type="button" @click="auth.login()">Try again</button>
    </template>
    <p v-else>Completing sign-in…</p>
  </div>
</template>

<style scoped>
.callback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 60vh;
  text-align: center;
}

.detail {
  color: var(--ink-muted);
  max-width: 40rem;
}
</style>
