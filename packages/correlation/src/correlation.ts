/**
 * Correlation ID utilities for distributed tracing.
 *
 * Provides:
 * 1. A Fastify `onRequest` hook that extracts or generates a correlation ID
 *    and attaches it to the request.
 * 2. A helper to forward the correlation ID when making downstream HTTP calls.
 *
 * Requirements: 15.7
 */
import { v4 as uuidv4 } from 'uuid';
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';

/** HTTP header used to propagate correlation IDs across services */
export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Fastify `onRequest` hook.
 *
 * - If the incoming request already carries an `x-correlation-id` header,
 *   that value is reused (preserving the chain across services).
 * - Otherwise a fresh UUID v4 is generated.
 * - The ID is attached to `request.correlationId` and echoed back on the
 *   response via the same header.
 */
export function correlationIdHook(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  const existing = request.headers[CORRELATION_HEADER];
  const correlationId =
    (Array.isArray(existing) ? existing[0] : existing) ?? uuidv4();

  // Attach to request for downstream use
  (request as any).correlationId = correlationId;

  // Echo back on response
  void reply.header(CORRELATION_HEADER, correlationId);

  done();
}

/**
 * Build the headers object needed to forward the correlation ID to a
 * downstream service.
 *
 * Usage:
 * ```ts
 * await fetch(url, {
 *   headers: { ...forwardCorrelationHeader(request), 'Content-Type': 'application/json' },
 * });
 * ```
 */
export function forwardCorrelationHeader(
  request: FastifyRequest,
): Record<string, string> {
  const id = (request as any).correlationId as string | undefined;
  return id ? { [CORRELATION_HEADER]: id } : {};
}

/**
 * Extract the correlation ID value from a raw headers object (e.g. from an
 * incoming HTTP call or a worker queue message).
 */
export function extractCorrelationId(
  headers: Record<string, string | string[] | undefined>,
): string {
  const val = headers[CORRELATION_HEADER];
  return (Array.isArray(val) ? val[0] : val) ?? uuidv4();
}
