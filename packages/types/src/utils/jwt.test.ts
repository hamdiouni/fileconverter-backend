/**
 * Unit tests for JWT utility functions.
 * Validates: Requirements 27.2, 27.3
 */

import jwt from 'jsonwebtoken';
import { verifyToken, decodeToken } from './jwt';
import type { TokenPayload } from '../types/api';

const TEST_SECRET = 'test-secret-key-for-unit-tests';
const ANOTHER_SECRET = 'different-secret-key';

function makePayload(overrides: Partial<TokenPayload> = {}): Omit<TokenPayload, 'iat' | 'exp'> {
  return {
    userId: 'user-123',
    email: 'test@example.com',
    tier: 'pro',
    permissions: ['read', 'write'],
    ...overrides,
  };
}

function signToken(
  payload: Partial<TokenPayload>,
  secret: string,
  options: jwt.SignOptions = { expiresIn: '15m' },
): string {
  return jwt.sign(payload, secret, options);
}

// ---------------------------------------------------------------------------
// verifyToken
// ---------------------------------------------------------------------------

describe('verifyToken', () => {
  describe('valid tokens', () => {
    it('returns valid=true and the decoded payload for a fresh token', () => {
      const token = signToken(makePayload(), TEST_SECRET);
      const result = verifyToken(token, TEST_SECRET);

      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.payload).not.toBeNull();
      expect(result.payload!.userId).toBe('user-123');
      expect(result.payload!.email).toBe('test@example.com');
      expect(result.payload!.tier).toBe('pro');
      expect(result.payload!.permissions).toEqual(['read', 'write']);
    });

    it('preserves all custom claims from the payload', () => {
      const token = signToken(
        makePayload({ userId: 'user-456', tier: 'enterprise', permissions: ['admin'] }),
        TEST_SECRET,
      );
      const result = verifyToken(token, TEST_SECRET);

      expect(result.valid).toBe(true);
      expect(result.payload!.userId).toBe('user-456');
      expect(result.payload!.tier).toBe('enterprise');
      expect(result.payload!.permissions).toEqual(['admin']);
    });

    it('includes iat and exp claims in the decoded payload', () => {
      const token = signToken(makePayload(), TEST_SECRET, { expiresIn: '1h' });
      const result = verifyToken(token, TEST_SECRET);

      expect(result.valid).toBe(true);
      expect(typeof result.payload!.iat).toBe('number');
      expect(typeof result.payload!.exp).toBe('number');
      expect(result.payload!.exp).toBeGreaterThan(result.payload!.iat);
    });
  });

  describe('expired tokens', () => {
    it('returns valid=false and error="expired" for a token past its expiry', () => {
      // Sign a token that expired 1 second ago
      const token = signToken(makePayload(), TEST_SECRET, { expiresIn: -1 });
      const result = verifyToken(token, TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('expired');
      expect(result.payload).toBeNull();
    });

    it('returns valid=false and error="expired" for a token with expiresIn=0', () => {
      // Use a past timestamp directly
      const now = Math.floor(Date.now() / 1000);
      const token = jwt.sign({ ...makePayload(), exp: now - 60 }, TEST_SECRET);
      const result = verifyToken(token, TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('expired');
      expect(result.payload).toBeNull();
    });
  });

  describe('malformed tokens', () => {
    it('returns valid=false and error="invalid" for a completely random string', () => {
      const result = verifyToken('not.a.jwt', TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('invalid');
      expect(result.payload).toBeNull();
    });

    it('returns valid=false and error="invalid" for an empty string', () => {
      const result = verifyToken('', TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('invalid');
      expect(result.payload).toBeNull();
    });

    it('returns valid=false and error="invalid" when signed with a different secret', () => {
      const token = signToken(makePayload(), ANOTHER_SECRET);
      const result = verifyToken(token, TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('invalid');
      expect(result.payload).toBeNull();
    });

    it('returns valid=false and error="invalid" for a tampered token (modified payload)', () => {
      const token = signToken(makePayload(), TEST_SECRET);
      // Swap out the payload segment with a different base64 blob
      const parts = token.split('.');
      const fakePayload = Buffer.from(JSON.stringify({ userId: 'attacker', email: 'hack@evil.com' })).toString('base64url');
      const tampered = [parts[0], fakePayload, parts[2]].join('.');
      const result = verifyToken(tampered, TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('invalid');
      expect(result.payload).toBeNull();
    });

    it('returns valid=false and error="invalid" for a token with only two segments', () => {
      const result = verifyToken('header.payload', TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('invalid');
      expect(result.payload).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// decodeToken
// ---------------------------------------------------------------------------

describe('decodeToken', () => {
  it('returns the decoded payload without verifying the signature', () => {
    // Token signed with a secret we do NOT pass to decodeToken
    const token = signToken(makePayload(), ANOTHER_SECRET);
    const payload = decodeToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe('user-123');
    expect(payload!.email).toBe('test@example.com');
  });

  it('returns payload for an expired token (no verification)', () => {
    const token = signToken(makePayload(), TEST_SECRET, { expiresIn: -1 });
    const payload = decodeToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe('user-123');
    // exp should be in the past
    expect(payload!.exp).toBeLessThan(Math.floor(Date.now() / 1000));
  });

  it('returns null for a completely malformed string', () => {
    expect(decodeToken('not-a-jwt-at-all')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeToken('')).toBeNull();
  });

  it('returns null for a plain string payload (non-object JWT)', () => {
    // jwt.sign can produce a token whose payload is a plain string
    const token = jwt.sign('plain-string', TEST_SECRET);
    // jwt.decode returns the string directly; decodeToken should return null
    expect(decodeToken(token)).toBeNull();
  });

  it('preserves all standard claims in the decoded result', () => {
    const token = signToken(
      makePayload({ tier: 'business', permissions: ['admin', 'read'] }),
      TEST_SECRET,
      { expiresIn: '7d' },
    );
    const payload = decodeToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.tier).toBe('business');
    expect(payload!.permissions).toEqual(['admin', 'read']);
    expect(typeof payload!.iat).toBe('number');
    expect(typeof payload!.exp).toBe('number');
  });
});
