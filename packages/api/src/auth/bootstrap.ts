/**
 * Auth startup (design §5.4).
 *
 * Runs after the entity cache is ready and before routes are registered, so the
 * first request already sees a fully indexed grant set. In `disabled` mode the
 * store stays in memory and nothing touches the backend.
 */
import type { FastifyBaseLogger } from 'fastify';
import { getAuthStore, inMemoryPersistence } from './AuthStore.js';
import { getAuthConfig } from './config.js';
import { sparqlAuthGraphPersistence } from './persistence.js';
import { canonicalizeAdminEntry } from './principals.js';

export async function initializeAuth(logger?: FastifyBaseLogger): Promise<void> {
  const config = getAuthConfig();
  const store = getAuthStore();

  const admins = config.adminPrincipals
    .map(entry => {
      const canonical = canonicalizeAdminEntry(entry);
      if (!canonical) {
        logger?.warn(
          { entry },
          'Ignoring malformed SQLIB_AUTH_ADMIN_PRINCIPALS entry (expected "issuer|subject", "issuer|group:value" or a urn:sqlib:principal: IRI)'
        );
      }
      return canonical;
    })
    .filter((value): value is string => Boolean(value));

  if (config.mode === 'disabled') {
    // Nothing enforces grants, so nothing needs loading — but keep the store
    // consistent so `/auth/me` and the admin routes still answer coherently.
    store.setPersistence(inMemoryPersistence());
    store.setBootstrapAdmins(admins);
    logger?.info('Auth disabled; grant store left in memory');
    return;
  }

  store.setPersistence(sparqlAuthGraphPersistence());

  try {
    await store.load({ seedGrantsPath: config.seedGrantsPath });
  } catch (error) {
    // Fail closed and loudly: starting without grants in an enforcing mode would
    // lock every caller out silently, which reads as an outage with no cause.
    throw new Error(`Failed to load the authorization graph: ${(error as Error).message}`);
  }

  store.setBootstrapAdmins(admins);

  logger?.info(
    {
      authMode: config.mode,
      grants: store.listGrants().length,
      bootstrapAdmins: admins.length,
    },
    'Authorization store loaded'
  );

  if (admins.length === 0 && store.listGrants().length === 0) {
    logger?.warn(
      'Authorization is enabled but no grants and no bootstrap admins exist — every request will be denied. Set SQLIB_AUTH_ADMIN_PRINCIPALS.'
    );
  }
}
