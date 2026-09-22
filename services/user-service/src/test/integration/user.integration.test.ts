/**
 * User Service Integration Tests
 *
 * Requirements: 3.1, 3.2, 3.4, 3.5
 */

import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp } from '../helpers/app.helper';
import type { InMemoryPrismaClient } from '../mocks/prisma.mock';
import type { InMemoryRedis } from '../mocks/redis.mock';
import { resetEnvCache } from '../../config/env';

function makeToken(userId: string, email: string, tier = 'free'): string {
  return jwt.sign(
    { userId, email, tier },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' },
  );
}

describe('User Service Integration Tests', () => {
  let app: FastifyInstance;
  let prisma: InMemoryPrismaClient;
  let redis: InMemoryRedis;
  let token: string;

  beforeAll(async () => {
    resetEnvCache();
    const result = await buildTestApp();
    app = result.app;
    prisma = result.prisma;
    redis = result.redis;
    token = makeToken('user-1', 'test@example.com', 'free');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Re-seed user between tests (some tests delete the user)
    prisma.reset();
    redis.reset();
    prisma.seedUser('user-1', 'test@example.com', 'free');
    token = makeToken('user-1', 'test@example.com', 'free');
  });

  // ─── Health ──────────────────────────────────────────────────────────────
  describe('GET /health', () => {
    it('should return 200 with service status', async () => {
      const res = await supertest(app.server).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  // ─── Profile ─────────────────────────────────────────────────────────────
  describe('GET /api/v1/users/me', () => {
    it('should return 200 with user profile for authenticated user', async () => {
      const res = await supertest(app.server)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'user-1',
        email: 'test@example.com',
        tier: 'free',
      });
    });

    it('should return 401 without token', async () => {
      const res = await supertest(app.server).get('/api/v1/users/me');
      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const res = await supertest(app.server)
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer invalid.token.here');
      expect(res.status).toBe(401);
    });

    it('should return 200 when authenticated via X-API-Key', async () => {
      const crypto = await import('crypto');
      const rawKey = 'fc_live_test_api_key_12345';
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      prisma.seedApiKey('key-1', 'user-1', keyHash);

      const res = await supertest(app.server)
        .get('/api/v1/users/me')
        .set('X-API-Key', rawKey);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'user-1',
        email: 'test@example.com',
      });
    });

    it('should return 401 with invalid X-API-Key', async () => {
      const res = await supertest(app.server)
        .get('/api/v1/users/me')
        .set('X-API-Key', 'invalid_key_value');
      expect(res.status).toBe(401);
    });

    it('should return 200 when authenticated via Bearer <apiKey>', async () => {
      const crypto = await import('crypto');
      const rawKey = 'fc_live_test_bearer_key_67890';
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      prisma.seedApiKey('key-2', 'user-1', keyHash);

      const res = await supertest(app.server)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${rawKey}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'user-1',
        email: 'test@example.com',
      });
    });
  });

  describe('PATCH /api/v1/users/me', () => {
    it('should update profile and return 200', async () => {
      const res = await supertest(app.server)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'John Doe', company: 'Acme Corp' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('John Doe');
      expect(res.body.company).toBe('Acme Corp');
    });

    it('should return 400 for invalid avatarUrl', async () => {
      const res = await supertest(app.server)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatarUrl: 'not-a-url' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should accept valid avatarUrl', async () => {
      const res = await supertest(app.server)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatarUrl: 'https://example.com/avatar.png' });

      expect(res.status).toBe(200);
      expect(res.body.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('should return 401 without token', async () => {
      const res = await supertest(app.server)
        .patch('/api/v1/users/me')
        .send({ name: 'John' });
      expect(res.status).toBe(401);
    });

    it('should invalidate Redis cache after update', async () => {
      // Prime the cache
      await supertest(app.server)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`);

      const cachedBefore = await redis.get('user:profile:user-1');
      expect(cachedBefore).not.toBeNull();

      // Update profile
      await supertest(app.server)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name' });

      // Cache should be invalidated (then re-populated by the update)
      // Just verify the update reflects correctly
      const res = await supertest(app.server)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.name).toBe('Updated Name');
    });
  });

  describe('DELETE /api/v1/users/me', () => {
    it('should soft-delete user and return 204', async () => {
      const res = await supertest(app.server)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(204);
    });

    it('should return 404 on GET after soft delete', async () => {
      await supertest(app.server)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`);

      const res = await supertest(app.server)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should return 401 without token', async () => {
      const res = await supertest(app.server).delete('/api/v1/users/me');
      expect(res.status).toBe(401);
    });
  });

  // ─── Subscription ────────────────────────────────────────────────────────
  describe('GET /api/v1/users/me/subscription', () => {
    it('should return 200 with subscription details and quota limits', async () => {
      const res = await supertest(app.server)
        .get('/api/v1/users/me/subscription')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        userId: 'user-1',
        tier: 'free',
        status: 'active',
        quotas: {
          conversionsPerMonth: 100,
          apiCallsPerMonth: 1000,
          storageRetentionDays: 7,
        },
      });
    });

    it('should return 401 without token', async () => {
      const res = await supertest(app.server).get('/api/v1/users/me/subscription');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /internal/users/:userId/subscription', () => {
    it('should update subscription tier to pro and return updated quotas', async () => {
      const res = await supertest(app.server)
        .put('/internal/users/user-1/subscription')
        .send({ tier: 'pro' });

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe('pro');
      expect(res.body.quotas.conversionsPerMonth).toBe(10000);
    });

    it('should return 400 for invalid tier', async () => {
      const res = await supertest(app.server)
        .put('/internal/users/user-1/subscription')
        .send({ tier: 'invalid-tier' });

      expect(res.status).toBe(400);
    });

    it('should reflect new tier when calling GET subscription after update', async () => {
      await supertest(app.server)
        .put('/internal/users/user-1/subscription')
        .send({ tier: 'business' });

      const res = await supertest(app.server)
        .get('/api/v1/users/me/subscription')
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.tier).toBe('business');
      expect(res.body.quotas.conversionsPerMonth).toBe(100000);
    });
  });

  // ─── Usage / Quota ───────────────────────────────────────────────────────
  describe('GET /api/v1/users/me/usage', () => {
    it('should return 200 with zero usage initially', async () => {
      const res = await supertest(app.server)
        .get('/api/v1/users/me/usage')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        conversionsThisMonth: 0,
        apiCallsThisMonth: 0,
        quotas: { conversionsPerMonth: 100 },
      });
      expect(res.body.resetDate).toBeDefined();
    });

    it('should return 401 without token', async () => {
      const res = await supertest(app.server).get('/api/v1/users/me/usage');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /internal/users/:userId/quota/check', () => {
    it('should return allowed=true when under quota', async () => {
      const res = await supertest(app.server)
        .post('/internal/users/user-1/quota/check')
        .send({ quotaType: 'conversions', amount: 1 });

      expect(res.status).toBe(200);
      expect(res.body.allowed).toBe(true);
      expect(res.body.remaining).toBe(100);
    });

    it('should return allowed=false when over quota', async () => {
      // Increment usage to reach the limit
      await supertest(app.server)
        .post('/internal/users/user-1/quota/increment')
        .send({ quotaType: 'conversions', amount: 100 });

      const res = await supertest(app.server)
        .post('/internal/users/user-1/quota/check')
        .send({ quotaType: 'conversions', amount: 1 });

      expect(res.status).toBe(200);
      expect(res.body.allowed).toBe(false);
      expect(res.body.remaining).toBe(0);
    });

    it('should return 400 for invalid quotaType', async () => {
      const res = await supertest(app.server)
        .post('/internal/users/user-1/quota/check')
        .send({ quotaType: 'invalid', amount: 1 });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /internal/users/:userId/quota/increment', () => {
    it('should increment usage and return 204', async () => {
      const res = await supertest(app.server)
        .post('/internal/users/user-1/quota/increment')
        .send({ quotaType: 'conversions', amount: 5 });

      expect(res.status).toBe(204);
    });

    it('should reflect incremented usage in GET /usage', async () => {
      await supertest(app.server)
        .post('/internal/users/user-1/quota/increment')
        .send({ quotaType: 'conversions', amount: 5 });

      const res = await supertest(app.server)
        .get('/api/v1/users/me/usage')
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.conversionsThisMonth).toBe(5);
    });

    it('should return 400 for invalid input', async () => {
      const res = await supertest(app.server)
        .post('/internal/users/user-1/quota/increment')
        .send({ quotaType: 'invalid', amount: 5 });

      expect(res.status).toBe(400);
    });
  });

  describe('Enterprise quota (unlimited)', () => {
    it('should return allowed=true and remaining=-1 for enterprise tier', async () => {
      // Upgrade to enterprise
      await supertest(app.server)
        .put('/internal/users/user-1/subscription')
        .send({ tier: 'enterprise' });

      // Add huge usage
      await supertest(app.server)
        .post('/internal/users/user-1/quota/increment')
        .send({ quotaType: 'conversions', amount: 999999 });

      const res = await supertest(app.server)
        .post('/internal/users/user-1/quota/check')
        .send({ quotaType: 'conversions', amount: 1 });

      expect(res.status).toBe(200);
      expect(res.body.allowed).toBe(true);
      expect(res.body.remaining).toBe(-1);
    });
  });
});
