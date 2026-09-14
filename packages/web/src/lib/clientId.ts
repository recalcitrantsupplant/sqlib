/**
 * This tab's identity, for echo suppression on the change feed.
 *
 * Per tab rather than per user or per browser: two tabs of the same app are
 * exactly the case where one writes and the other must hear about it. The id
 * is memory-only and lives for the life of the page — nothing persists it,
 * because a reloaded tab has already refetched everything anyway.
 */
let id: string | null = null;

export function clientId(): string {
  if (id) return id;
  id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `client-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  return id;
}
