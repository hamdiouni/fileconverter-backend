/**
 * Generic paginated response wrapper used across all list endpoints
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Standard error response returned on API failures
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
    timestamp: string;
  };
}

/**
 * Standard success response wrapper
 */
export interface SuccessResponse<T = unknown> {
  data: T;
  requestId?: string;
  timestamp: string;
}

/**
 * JWT token payload decoded from access tokens
 */
export interface TokenPayload {
  userId: string;
  email: string;
  tier: 'free' | 'pro' | 'business' | 'enterprise';
  permissions: string[];
  iat: number;
  exp: number;
}

/**
 * Auth token pair returned after login or registration
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}
