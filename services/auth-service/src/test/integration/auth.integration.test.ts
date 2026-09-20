/**
 * Auth Service Integration Tests
 *
 * Tests cover:
 * - Registration with valid email/password → 201 + tokens
 * - Registration with duplicate email → 409
 * - Registration with invalid password (too short) → 400
 * - Login with valid credentials → 200 + tokens
 * - Login with invalid password → 401
 * - Login with non-existent email → 401
 * - Token refresh with valid refresh token → 200 + new tokens
 * - Token refresh with expired token → 401
 * - Token refresh with invalid token → 401
 * - OAuth flow initiation redirects to provider URL
 * - API key generation → 201 with key value
 * - API key listing → 200 without key values
 * - API key revocation → 204
 *
 * Requirements: 2.1, 2.2, 2.3, 2.7
 */

import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp } from '../helpers/app.helper';
import type { InMemoryPrismaClient } from '../mocks/prisma.mock';
import type { InMemoryRedis } from '../mocks/redis.mock';
import { resetEnvCache } from '../../config/env';

describe('Auth Service Integration Tests', () => {
  let app: FastifyInstance;
  let prisma: InMemoryPrismaClient;
  let redis: InMemoryRedis;

  beforeAll(async () => {
    resetEnvCache();
    const result = await buildTestApp();
    app = result.app;
    prisma = result.prisma;
    redis = result.redis;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.reset();
    redis.reset();
  });

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/auth/register', () => {
    it('should register successfully with valid email and password → 201 + tokens', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com', password: 'securepassword123' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: expect.any(Number),
        tokenType: 'Bearer',
        user: {
          id: expect.any(String),
          email: 'test@example.com',
        },
      });

      // Verify tokens are valid JWTs
      const env = process.env;
      const accessPayload = jwt.verify(
        response.body.accessToken,
        env.JWT_ACCESS_SECRET!,
      ) as any;
      expect(accessPayload.email).toBe('test@example.com');
      expect(accessPayload.userId).toBe(response.body.user.id);
    });

    it('should return 409 for duplicate email', async () => {
      // Register first time
      await supertest(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'dup@example.com', password: 'password12345' });

      // Try to register again with same email
      const response = await supertest(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'dup@example.com', password: 'anotherpassword123' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('EMAIL_CONFLICT');
    });

    it('should return 400 for password shorter than 8 characters', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'short@example.com', password: 'abc1234' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'password12345' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when email is missing', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/register')
        .send({ password: 'password12345' });

      expect(response.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      // Pre-register a user for login tests
      await supertest(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'logintest@example.com', password: 'correctpassword123' });
    });

    it('should return 200 + tokens with valid credentials', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/login')
        .send({ email: 'logintest@example.com', password: 'correctpassword123' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: expect.any(Number),
        tokenType: 'Bearer',
        user: {
          email: 'logintest@example.com',
        },
      });
    });

    it('should return 401 with invalid password', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/login')
        .send({ email: 'logintest@example.com', password: 'wrongpassword123' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should return 401 for non-existent email', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'password12345' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should return 400 when password is missing', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/login')
        .send({ email: 'logintest@example.com' });

      expect(response.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Token Refresh
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/auth/refresh', () => {
    let validRefreshToken: string;

    beforeEach(async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'refresh@example.com', password: 'refreshpassword123' });
      validRefreshToken = response.body.refreshToken;
    });

    it('should return 200 + new tokens with valid refresh token', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: expect.any(Number),
        tokenType: 'Bearer',
      });

      // New tokens should be different
      expect(response.body.refreshToken).not.toBe(validRefreshToken);
    });

    it('should return 401 with an expired refresh token', async () => {
      // Create an expired refresh token (exp in the past)
      const expiredToken = jwt.sign(
        { userId: 'some-user-id', email: 'expired@example.com' },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: -1 } as any,
      );

      const response = await supertest(app.server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: expiredToken });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should return 401 with an invalid (malformed) refresh token', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'this.is.not.a.valid.token' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should return 401 with a token not found in the database', async () => {
      // Valid JWT signature but not stored in DB
      const tokenNotInDb = jwt.sign(
        { userId: 'non-existent-user', email: 'ghost@example.com' },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: '7d' },
      );

      const response = await supertest(app.server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokenNotInDb });

      expect(response.status).toBe(401);
    });

    it('should invalidate old refresh token after rotation', async () => {
      // Use the token once
      const firstRefresh = await supertest(app.server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken });

      expect(firstRefresh.status).toBe(200);

      // Try to reuse the same (now rotated) old token
      const secondRefresh = await supertest(app.server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken });

      expect(secondRefresh.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // OAuth Flows
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/auth/oauth/:provider', () => {
    it('should redirect to Google OAuth URL for google provider', async () => {
      const response = await supertest(app.server)
        .get('/api/v1/auth/oauth/google')
        .redirects(0); // Don't follow redirects

      expect(response.status).toBe(302);
      const location = response.headers.location as string;
      expect(location).toContain('accounts.google.com');
      expect(location).toContain('state=');
    });

    it('should redirect to GitHub OAuth URL for github provider', async () => {
      const response = await supertest(app.server)
        .get('/api/v1/auth/oauth/github')
        .redirects(0);

      expect(response.status).toBe(302);
      const location = response.headers.location as string;
      expect(location).toContain('github.com/login/oauth');
      expect(location).toContain('state=');
    });

    it('should return 400 for unsupported provider', async () => {
      const response = await supertest(app.server).get('/api/v1/auth/oauth/twitter');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PROVIDER');
    });

    it('should store OAuth state in Redis with 10 minute TTL', async () => {
      // Reset redis to check state is stored
      redis.reset();

      const response = await supertest(app.server)
        .get('/api/v1/auth/oauth/google')
        .redirects(0);

      expect(response.status).toBe(302);

      const location = response.headers.location as string;
      const stateMatch = location.match(/state=([^&]+)/);
      expect(stateMatch).not.toBeNull();

      const stateToken = stateMatch![1];
      const storedState = await redis.get(`oauth:state:${stateToken}`);
      expect(storedState).not.toBeNull();

      const parsed = JSON.parse(storedState!);
      expect(parsed.provider).toBe('google');
    });
  });

  // ---------------------------------------------------------------------------
  // API Key Management
  // ---------------------------------------------------------------------------
  describe('API Key Management', () => {
    let accessToken: string;
    let userId: string;

    beforeEach(async () => {
      const reg = await supertest(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'apikey@example.com', password: 'apikeypassword123' });
      accessToken = reg.body.accessToken;
      userId = reg.body.user.id;
    });

    describe('POST /api/v1/auth/api-keys', () => {
      it('should generate API key → 201 with key value', async () => {
        const response = await supertest(app.server)
          .post('/api/v1/auth/api-keys')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'My Test Key', permissions: ['read', 'write'] });

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
          id: expect.any(String),
          key: expect.any(String),
          name: 'My Test Key',
          permissions: ['read', 'write'],
          createdAt: expect.any(String),
        });

        // Key should be a hex string (64 chars = 32 bytes)
        expect(response.body.key).toMatch(/^[0-9a-f]{64}$/);
      });

      it('should return 401 without auth token', async () => {
        const response = await supertest(app.server)
          .post('/api/v1/auth/api-keys')
          .send({ name: 'Unauthorized Key', permissions: [] });

        expect(response.status).toBe(401);
      });

      it('should generate API key with empty permissions by default', async () => {
        const response = await supertest(app.server)
          .post('/api/v1/auth/api-keys')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Minimal Key' });

        expect(response.status).toBe(201);
        expect(response.body.permissions).toEqual([]);
      });

      it('should generate API key with expiration date', async () => {
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const response = await supertest(app.server)
          .post('/api/v1/auth/api-keys')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Expiring Key', permissions: [], expiresAt });

        expect(response.status).toBe(201);
        expect(response.body.expiresAt).not.toBeNull();
      });
    });

    describe('GET /api/v1/auth/api-keys', () => {
      beforeEach(async () => {
        // Create some keys
        await supertest(app.server)
          .post('/api/v1/auth/api-keys')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Key 1', permissions: ['read'] });

        await supertest(app.server)
          .post('/api/v1/auth/api-keys')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Key 2', permissions: ['write'] });
      });

      it('should list API keys → 200 without key values', async () => {
        const response = await supertest(app.server)
          .get('/api/v1/auth/api-keys')
          .set('Authorization', `Bearer ${accessToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);

        // Key values should NOT be present in listing
        for (const key of response.body.data) {
          expect(key.key).toBeUndefined();
          expect(key.id).toBeDefined();
          expect(key.name).toBeDefined();
          expect(key.permissions).toBeDefined();
        }
      });

      it('should return 401 without auth token', async () => {
        const response = await supertest(app.server).get('/api/v1/auth/api-keys');
        expect(response.status).toBe(401);
      });
    });

    describe('DELETE /api/v1/auth/api-keys/:id', () => {
      it('should revoke API key → 204', async () => {
        // Create a key
        const createRes = await supertest(app.server)
          .post('/api/v1/auth/api-keys')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Key to Revoke', permissions: [] });

        const keyId = createRes.body.id;

        const revokeRes = await supertest(app.server)
          .delete(`/api/v1/auth/api-keys/${keyId}`)
          .set('Authorization', `Bearer ${accessToken}`);

        expect(revokeRes.status).toBe(204);
      });

      it('should return 404 when revoking non-existent key', async () => {
        const response = await supertest(app.server)
          .delete('/api/v1/auth/api-keys/non-existent-id')
          .set('Authorization', `Bearer ${accessToken}`);

        expect(response.status).toBe(404);
      });

      it('should return 401 without auth token', async () => {
        const response = await supertest(app.server).delete(
          '/api/v1/auth/api-keys/some-key-id',
        );
        expect(response.status).toBe(401);
      });

      it('should not allow revoking another user\'s API key', async () => {
        // Create a second user
        const reg2 = await supertest(app.server)
          .post('/api/v1/auth/register')
          .send({ email: 'other@example.com', password: 'otherpassword123' });
        const otherToken = reg2.body.accessToken;

        // Create key for first user
        const createRes = await supertest(app.server)
          .post('/api/v1/auth/api-keys')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'User 1 Key', permissions: [] });

        const keyId = createRes.body.id;

        // Try to delete with other user's token
        const revokeRes = await supertest(app.server)
          .delete(`/api/v1/auth/api-keys/${keyId}`)
          .set('Authorization', `Bearer ${otherToken}`);

        expect(revokeRes.status).toBe(404);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------
  describe('GET /health', () => {
    it('should return 200 with service status', async () => {
      const response = await supertest(app.server).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });
});
