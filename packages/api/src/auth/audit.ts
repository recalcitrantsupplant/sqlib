/**
 * Authorization audit (design §9).
 *
 * Denials matter as much as grants: a decision that is not recorded cannot be
 * reviewed, and `dry-run` mode is worthless without a `would-deny` trail. The
 * decision is logged, never the token — `claims` are never serialized here.
 */
import { metrics } from '@opentelemetry/api';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from './types.js';

const meter = metrics.getMeter('sqlib-authz');

const decisionCounter = meter.createCounter('authz.decision.count', {
  description: 'Authorization decisions by outcome',
});

export type AuditDecision = 'allow' | 'deny' | 'would-deny';

export interface AuditEvent {
  decision: AuditDecision;
  resource: string | null;
  resourceKind: 'library' | 'backend' | 'everything' | 'route' | 'session';
  mode: string;
  /** Grant IRI, or a marker for a decision made without a stored grant. */
  matchedGrant?: string | null;
  detail?: string;
}

export function auditDecision(
  request: FastifyRequest | null,
  context: AuthContext,
  event: AuditEvent
): void {
  const payload = {
    audit: true,
    ts: new Date().toISOString(),
    requestId: request?.id,
    subject: context.subject,
    mode: event.mode,
    authMode: context.mode,
    route: request ? `${request.method} ${request.url}` : undefined,
    resource: event.resource,
    resourceKind: event.resourceKind,
    decision: event.decision,
    matchedGrant: event.matchedGrant ?? null,
    detail: event.detail,
  };

  decisionCounter.add(1, {
    decision: event.decision,
    mode: context.mode,
    resource_kind: event.resourceKind,
  });

  const logger = request?.log;
  if (!logger) return;

  if (event.decision === 'allow') {
    logger.debug(payload, 'authz decision');
  } else {
    logger.warn(payload, 'authz decision');
  }
}

export interface GrantMutationEvent {
  action: 'create' | 'revoke';
  grantId: string;
  principal: string;
  resource: string;
  resourceKind: string;
  modes: readonly string[];
}

export function auditGrantMutation(
  request: FastifyRequest | null,
  context: AuthContext,
  event: GrantMutationEvent
): void {
  request?.log.warn(
    {
      audit: true,
      ts: new Date().toISOString(),
      requestId: request?.id,
      subject: context.subject,
      grantMutation: event,
    },
    'authz grant mutation'
  );
}
