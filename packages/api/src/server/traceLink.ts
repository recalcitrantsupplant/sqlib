/**
 * `Sqlib-Trace-Url` on every response that has a trace: the link to that
 * request's trace in whatever tool `SQLIB_TRACE_URL_TEMPLATE` names, with
 * `{traceId}` filled in. The web app shows it as a link on a run's result.
 *
 * The server builds the URL, so the template itself is never served: a caller
 * sees the link for a request it was allowed to make and nothing else. Not
 * registered when the template is unset or telemetry is off.
 */
import type { FastifyInstance } from 'fastify';
import { trace } from '@opentelemetry/api';
import { telemetryStatus, traceUrlFor } from '../lib/telemetryStatus.js';

export const TRACE_URL_HEADER = 'Sqlib-Trace-Url';

export function registerTraceLinkHook(app: FastifyInstance): void {
  if (!telemetryStatus().traceLinks) return;
  app.addHook('onSend', async (_request, reply, payload) => {
    const spanContext = trace.getActiveSpan()?.spanContext();
    if (spanContext && !reply.getHeader(TRACE_URL_HEADER)) {
      const url = traceUrlFor(spanContext.traceId);
      if (url) reply.header(TRACE_URL_HEADER, url);
    }
    return payload;
  });
}
