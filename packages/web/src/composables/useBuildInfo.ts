/**
 * What build of the SPA is running.
 *
 * Baked into the bundle rather than fetched: this describes the JavaScript
 * that is executing, so asking a server for it would answer a different
 * question — and would answer nothing at all when the server is the one being
 * reported as broken.
 *
 * `version` is release-please's, `commit` the short SHA it was built from, and
 * `builtAt` when. See `nuxt.config.ts` for where each comes from and what a
 * container build has to pass in.
 */
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import { computed } from 'vue';

export function useBuildInfo() {
  const config = useRuntimeConfig();

  const version = computed(() => String(config.public.appVersion ?? 'unknown'));
  const commit = computed(() => String(config.public.appCommit ?? ''));
  const builtAt = computed(() => String(config.public.buildTime ?? ''));

  /** `0.1.0 · a1b2c3d`, or just the version where the commit is unknown. */
  const label = computed(() =>
    commit.value ? `${version.value} · ${commit.value}` : version.value,
  );

  /** The build date, for the tooltip. Empty when the stamp is unreadable. */
  const builtOn = computed(() => {
    if (!builtAt.value) return '';
    const date = new Date(builtAt.value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  });

  return { version, commit, builtAt, builtOn, label };
}
