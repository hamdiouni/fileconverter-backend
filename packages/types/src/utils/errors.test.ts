/**
 * Unit tests for error formatting utilities.
 * Validates: Requirements 27.2, 27.3
 */

import { formatError, createErrorResponse, ErrorCodes } from './errors';

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------

describe('formatError', () => {
  describe('Error instances', () => {
    it('extracts message from a standard Error', () => {
      const err = new Error('something went wrong');
      const result = formatError(err);

      expect(result.message).toBe('something went wrong');
    });

    it('includes the stack trace for Error instances', () => {
      const err = new Error('oops');
      const result = formatError(err);

      expect(result.stack).toBeDefined();
      expect(result.stack).toContain('Error: oops');
    });

    it('extracts a custom code property if present', () => {
      const err = Object.assign(new Error('db error'), { code: 'ECONNREFUSED' });
      const result = formatError(err);

      expect(result.code).toBe('ECONNREFUSED');
    });

    it('sets code to undefined when no code property exists', () => {
      const err = new Error('plain error');
      const result = formatError(err);

      expect(result.code).toBeUndefined();
    });

    it('handles TypeError correctly', () => {
      const err = new TypeError('cannot read property foo of undefined');
      const result = formatError(err);

      expect(result.message).toBe('cannot read property foo of undefined');
    });

    it('handles RangeError correctly', () => {
      const err = new RangeError('value out of range');
      const result = formatError(err);

      expect(result.message).toBe('value out of range');
    });
  });

  describe('plain objects', () => {
    it('extracts message from an object with a message property', () => {
      const err = { message: 'structured error', code: 'ERR_CUSTOM' };
      const result = formatError(err);

      expect(result.message).toBe('structured error');
      expect(result.code).toBe('ERR_CUSTOM');
    });

    it('JSON-serialises objects without a string message property', () => {
      const err = { status: 500, reason: 'unknown' };
      const result = formatError(err);

      expect(result.message).toContain('500');
      expect(result.message).toContain('unknown');
    });

    it('handles null gracefully', () => {
      const result = formatError(null);

      expect(result.message).toBe('null');
    });
  });

  describe('primitive values', () => {
    it('converts a string to a message', () => {
      const result = formatError('network timeout');

      expect(result.message).toBe('network timeout');
    });

    it('converts a number to a message', () => {
      const result = formatError(500);

      expect(result.message).toBe('500');
    });

    it('converts undefined to a message', () => {
      const result = formatError(undefined);

      expect(result.message).toBe('undefined');
    });

    it('converts false to a message', () => {
      const result = formatError(false);

      expect(result.message).toBe('false');
    });
  });
});

// ---------------------------------------------------------------------------
// createErrorResponse
// ---------------------------------------------------------------------------

describe('createErrorResponse', () => {
  it('returns an object with the correct error shape', () => {
    const response = createErrorResponse('NOT_FOUND', 'Resource not found');

    expect(response).toHaveProperty('error');
    expect(response.error.code).toBe('NOT_FOUND');
    expect(response.error.message).toBe('Resource not found');
  });

  it('includes a valid ISO timestamp', () => {
    const before = Date.now();
    const response = createErrorResponse('INTERNAL_ERROR', 'Unexpected error');
    const after = Date.now();

    const ts = new Date(response.error.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('includes details when provided', () => {
    const details = { field: 'email', reason: 'already taken' };
    const response = createErrorResponse('CONFLICT', 'Email already registered', details);

    expect(response.error.details).toEqual(details);
  });

  it('omits details key when not provided', () => {
    const response = createErrorResponse('UNAUTHORIZED', 'Invalid token');

    expect(response.error).not.toHaveProperty('details');
  });

  it('includes requestId when provided', () => {
    const response = createErrorResponse('RATE_LIMITED', 'Too many requests', undefined, 'req-abc-123');

    expect(response.error.requestId).toBe('req-abc-123');
  });

  it('omits requestId key when not provided', () => {
    const response = createErrorResponse('QUOTA_EXCEEDED', 'Monthly limit reached');

    expect(response.error).not.toHaveProperty('requestId');
  });

  it('works with all well-known ErrorCodes constants', () => {
    const codes = Object.values(ErrorCodes);

    for (const code of codes) {
      const response = createErrorResponse(code, `Test message for ${code}`);
      expect(response.error.code).toBe(code);
    }
  });

  it('accepts arbitrary string codes not in ErrorCodes', () => {
    const response = createErrorResponse('CUSTOM_CODE_42', 'A custom error');

    expect(response.error.code).toBe('CUSTOM_CODE_42');
  });

  it('accepts complex nested details objects', () => {
    const details = {
      validationErrors: [
        { field: 'email', message: 'invalid format' },
        { field: 'password', message: 'too short' },
      ],
    };
    const response = createErrorResponse('VALIDATION_ERROR', 'Validation failed', details);

    expect(response.error.details).toEqual(details);
  });
});

// ---------------------------------------------------------------------------
// ErrorCodes constants
// ---------------------------------------------------------------------------

describe('ErrorCodes', () => {
  it('contains the expected error code values', () => {
    expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
    expect(ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
    expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ErrorCodes.QUOTA_EXCEEDED).toBe('QUOTA_EXCEEDED');
    expect(ErrorCodes.CONVERSION_FAILED).toBe('CONVERSION_FAILED');
  });
});
