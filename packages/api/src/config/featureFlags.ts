import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  buildFeatureFlags,
  type FeatureFlagKey,
  type FeatureFlags,
} from '@sparql-query-lib/types';

let currentFlags: FeatureFlags = buildFeatureFlags(process.env);

export function getFeatureFlags(): FeatureFlags {
  return currentFlags;
}

export function isFeatureEnabled(key: FeatureFlagKey): boolean {
  return currentFlags[key];
}

export function resetFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  currentFlags = buildFeatureFlags(env);
  return currentFlags;
}

export function overrideFeatureFlags(overrides: Partial<FeatureFlags>): FeatureFlags {
  currentFlags = {
    ...currentFlags,
    ...overrides,
  };
  return currentFlags;
}

export function featureFlagGuard(key: FeatureFlagKey) {
  return function featureFlagPreHandler(
    _request: FastifyRequest,
    reply: FastifyReply,
  ) {
    if (!isFeatureEnabled(key)) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    return undefined;
  };
}
