import type { ErrorResponse } from '../types/api';

/**
 * Well-known error codes used across all services
 */
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  VIRUS_DETECTED: 'VIRUS_DETECTED',
  CONVERSION_FAILED: 'CONVERSION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Normalise any thrown value into a plain `{ message, code?, stack? }` shape.
 *
 * Accepts `Error` instances, objects with a `message` property, and primitive
 * values (numbers, strings, etc.).  The returned object is safe to log or
 * embed in an API response.
 */
export function formatError(err: unknown): {
  message: string;
  code?: string;
  stack?: string;
} {
  if (err instanceof Error) {
    return {
      message: err.message,
      code: (err as Error & { code?: string }).code,
      stack: err.stack,
    };
  }

  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    return {
      message: typeof obj['message'] === 'string' ? obj['message'] : JSON.stringify(obj),
      code: typeof obj['code'] === 'string' ? obj['code'] : undefined,
    };
  }

  return { message: String(err) };
}

/**
 * Build a standardised `ErrorResponse` body suitable for sending back to API
 * clients.
 *
 * @param code      One of the well-known `ErrorCodes` (or any string)
 * @param message   Human-readable description of what went wrong
 * @param details   Optional structured detail (e.g. validation field errors)
 * @param requestId Optional correlation / request ID for distributed tracing
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: unknown,
  requestId?: string,
): ErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
      ...(requestId !== undefined && { requestId }),
      timestamp: new Date().toISOString(),
    },
  };
}
