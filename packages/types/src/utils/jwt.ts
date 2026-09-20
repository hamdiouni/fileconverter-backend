import jwt from 'jsonwebtoken';
import type { TokenPayload } from '../types/api';

/**
 * Result of a token verification attempt
 */
export interface VerifyTokenResult {
  valid: boolean;
  payload: TokenPayload | null;
  error: 'expired' | 'invalid' | null;
}

/**
 * Verify a JWT access token and decode its payload.
 *
 * Returns `{ valid: true, payload, error: null }` when the token is well-formed,
 * has a valid signature, and has not expired.
 *
 * Returns `{ valid: false, payload: null, error: 'expired' }` when the token
 * signature is valid but the token has passed its expiry time.
 *
 * Returns `{ valid: false, payload: null, error: 'invalid' }` for any other
 * failure (malformed token, wrong signature, missing claims, etc.).
 */
export function verifyToken(token: string, secret: string): VerifyTokenResult {
  try {
    const payload = jwt.verify(token, secret) as TokenPayload;
    return { valid: true, payload, error: null };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { valid: false, payload: null, error: 'expired' };
    }
    return { valid: false, payload: null, error: 'invalid' };
  }
}

/**
 * Decode a JWT without verifying the signature.
 *
 * Useful for extracting claims from tokens when signature verification has
 * already been handled (e.g., cached results). Returns `null` if the token
 * cannot be decoded at all (not a valid JWT structure).
 *
 * WARNING: This function does NOT validate the signature or expiry. Use
 * `verifyToken` when authenticity matters.
 */
export function decodeToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.decode(token);
    if (decoded === null || typeof decoded === 'string') {
      return null;
    }
    return decoded as TokenPayload;
  } catch {
    return null;
  }
}
