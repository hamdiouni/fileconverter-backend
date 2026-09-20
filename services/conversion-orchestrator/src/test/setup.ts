/**
 * Jest test setup for conversion-orchestrator service
 */

// Set test environment variables before any imports
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_ACCESS_SECRET = 'test-secret-key-for-testing-at-least-32-chars';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Global test timeout
jest.setTimeout(30000);
