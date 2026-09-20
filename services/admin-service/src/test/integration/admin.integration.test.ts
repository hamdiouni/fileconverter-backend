import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp } from '../helpers/app.helper';
import type { InMemoryPrismaClient } from '../mocks/prisma.mock';
import type { InMemoryRedis } from '../mocks/redis.mock';
import { resetEnvCache } from '../../config/env';

// ─── Token helpers ──────────────────────────────────────────────────────────

function makeAdminToken(userId: string): string {
  return jwt.sign(
    { userId, email: `${userId}@admin.com`, tier: 'admin', permissions: [] },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' },
  );
}

function makeUserToken(userId: string): string {
  return jwt.sign(
    { userId, email: `${userId}@user.com`, tier: 'free', permissions: [] },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' },
  );
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('Admin Service Integration Tests', () => {
  let app: FastifyInstance;
  let prisma: InMemoryPrismaClient;
  let redis: InMemoryRedis;

  beforeAll(async () => {
    resetEnvCache();
    const testApp = await buildTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    redis = testApp.redis;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.reset();
    redis.reset();
  });

  // ── Health ────────────────────────────────────────────────────────────────

  describe('Health', () => {
    it('GET /health → 200 with service name', async () => {
      const res = await supertest(app.server).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('admin-service');
    });
  });

  // ── User listing (Req 13.2) ───────────────────────────────────────────────

  describe('User listing (Req 13.2)', () => {
    it('Admin lists users → 200 with data array and total', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedUser('u2', 'b@test.com', 'pro');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    it('Returns correct total count', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedUser('u2', 'b@test.com', 'pro');
      prisma.seedUser('u3', 'c@test.com', 'pro');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.data).toHaveLength(3);
    });

    it('Filter by tier=pro returns only pro users', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedUser('u2', 'b@test.com', 'pro');
      prisma.seedUser('u3', 'c@test.com', 'pro');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .get('/api/v1/admin/users?tier=pro')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      res.body.data.forEach((u: any) => expect(u.tier).toBe('pro'));
    });

    it('Filter by suspended=true returns only suspended users', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free', false);
      prisma.seedUser('u2', 'b@test.com', 'pro', true);
      prisma.seedUser('u3', 'c@test.com', 'pro', true);
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .get('/api/v1/admin/users?suspended=true')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      res.body.data.forEach((u: any) => expect(u.suspended).toBe(true));
    });

    it('Non-admin (free tier) gets 403', async () => {
      const token = makeUserToken('user1');
      const res = await supertest(app.server)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('No auth gets 401 on list users', async () => {
      const res = await supertest(app.server).get('/api/v1/admin/users');
      expect(res.status).toBe(401);
    });
  });

  // ── User details (Req 13.2) ───────────────────────────────────────────────

  describe('User details (Req 13.2)', () => {
    it('Admin gets user by ID → 200', async () => {
      prisma.seedUser('user-abc', 'abc@test.com', 'pro');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .get('/api/v1/admin/users/user-abc')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('user-abc');
      expect(res.body.email).toBe('abc@test.com');
    });

    it('Returns 404 for unknown userId', async () => {
      const token = makeAdminToken('admin1');
      const res = await supertest(app.server)
        .get('/api/v1/admin/users/nonexistent-id')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('Non-admin gets 403 on get user', async () => {
      prisma.seedUser('user-abc', 'abc@test.com', 'pro');
      const token = makeUserToken('user1');
      const res = await supertest(app.server)
        .get('/api/v1/admin/users/user-abc')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ── Suspend / Unsuspend (Req 13.3) ───────────────────────────────────────

  describe('Suspend/Unsuspend (Req 13.3)', () => {
    it('Admin suspends user → 200 with suspended=true', async () => {
      prisma.seedUser('u-suspend', 'sus@test.com', 'free', false);
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .post('/api/v1/admin/users/u-suspend/suspend')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.suspended).toBe(true);
    });

    it('Admin unsuspends user → 200 with suspended=false', async () => {
      prisma.seedUser('u-unsuspend', 'uns@test.com', 'free', true);
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .post('/api/v1/admin/users/u-unsuspend/unsuspend')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.suspended).toBe(false);
    });

    it('Verify suspended state persists in DB after suspend', async () => {
      prisma.seedUser('u-db-check', 'db@test.com', 'free', false);
      const token = makeAdminToken('admin1');

      await supertest(app.server)
        .post('/api/v1/admin/users/u-db-check/suspend')
        .set('Authorization', `Bearer ${token}`);

      const getRes = await supertest(app.server)
        .get('/api/v1/admin/users/u-db-check')
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.suspended).toBe(true);
    });

    it('Verify suspended=false after unsuspend', async () => {
      prisma.seedUser('u-db-unsus', 'dbu@test.com', 'free', true);
      const token = makeAdminToken('admin1');

      await supertest(app.server)
        .post('/api/v1/admin/users/u-db-unsus/unsuspend')
        .set('Authorization', `Bearer ${token}`);

      const getRes = await supertest(app.server)
        .get('/api/v1/admin/users/u-db-unsus')
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.suspended).toBe(false);
    });

    it('Returns 404 for unknown user on suspend', async () => {
      const token = makeAdminToken('admin1');
      const res = await supertest(app.server)
        .post('/api/v1/admin/users/no-such-user/suspend')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('Non-admin gets 403 on suspend', async () => {
      prisma.seedUser('u-suspend2', 'sus2@test.com', 'free');
      const token = makeUserToken('user1');
      const res = await supertest(app.server)
        .post('/api/v1/admin/users/u-suspend2/suspend')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('No auth gets 401 on suspend', async () => {
      const res = await supertest(app.server).post('/api/v1/admin/users/some-user/suspend');
      expect(res.status).toBe(401);
    });
  });

  // ── Job listing (Req 13.4) ────────────────────────────────────────────────

  describe('Job listing (Req 13.4)', () => {
    it('Admin lists all jobs → 200 with pagination', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('j1', 'u1', 'completed');
      prisma.seedJob('j2', 'u1', 'failed');
      prisma.seedJob('j3', 'u1', 'queued');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .get('/api/v1/admin/jobs')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.page).toBe('number');
      expect(typeof res.body.pageSize).toBe('number');
    });

    it('Filter by status=failed returns only failed jobs', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('j1', 'u1', 'completed');
      prisma.seedJob('j2', 'u1', 'failed');
      prisma.seedJob('j3', 'u1', 'failed');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .get('/api/v1/admin/jobs?status=failed')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      res.body.data.forEach((j: any) => expect(j.status).toBe('failed'));
    });

    it('Filter by userId returns only that user\'s jobs', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedUser('u2', 'b@test.com', 'pro');
      prisma.seedJob('j1', 'u1', 'completed');
      prisma.seedJob('j2', 'u1', 'failed');
      prisma.seedJob('j3', 'u2', 'queued');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .get('/api/v1/admin/jobs?userId=u1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      res.body.data.forEach((j: any) => expect(j.userId).toBe('u1'));
    });

    it('Non-admin gets 403 on list jobs', async () => {
      const token = makeUserToken('user1');
      const res = await supertest(app.server)
        .get('/api/v1/admin/jobs')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('No auth gets 401 on list jobs', async () => {
      const res = await supertest(app.server).get('/api/v1/admin/jobs');
      expect(res.status).toBe(401);
    });
  });

  // ── Job details (Req 13.4) ────────────────────────────────────────────────

  describe('Job details (Req 13.4)', () => {
    it('Admin gets job by ID → 200', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-xyz', 'u1', 'completed', 'pdf', 'docx');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .get('/api/v1/admin/jobs/job-xyz')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('job-xyz');
      expect(res.body.status).toBe('completed');
    });

    it('Returns 404 for unknown jobId', async () => {
      const token = makeAdminToken('admin1');
      const res = await supertest(app.server)
        .get('/api/v1/admin/jobs/no-such-job')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('Non-admin gets 403 on get job', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-xyz', 'u1', 'completed');
      const token = makeUserToken('user1');
      const res = await supertest(app.server)
        .get('/api/v1/admin/jobs/job-xyz')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ── Job retry (Req 13.5) ──────────────────────────────────────────────────

  describe('Job retry (Req 13.5)', () => {
    it('Admin retries failed job → 200 with status=queued', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-failed', 'u1', 'failed');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .post('/api/v1/admin/jobs/job-failed/retry')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('queued');
    });

    it('Verify DB status changed to queued after retry', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-failed2', 'u1', 'failed');
      const token = makeAdminToken('admin1');

      await supertest(app.server)
        .post('/api/v1/admin/jobs/job-failed2/retry')
        .set('Authorization', `Bearer ${token}`);

      const getRes = await supertest(app.server)
        .get('/api/v1/admin/jobs/job-failed2')
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.status).toBe('queued');
    });

    it('Returns 409 for queued job (not failed)', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-queued', 'u1', 'queued');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .post('/api/v1/admin/jobs/job-queued/retry')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('Returns 409 for completed job', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-completed', 'u1', 'completed');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .post('/api/v1/admin/jobs/job-completed/retry')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
    });

    it('Returns 409 for cancelled job', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-cancelled', 'u1', 'cancelled');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .post('/api/v1/admin/jobs/job-cancelled/retry')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
    });

    it('Returns 404 for unknown jobId on retry', async () => {
      const token = makeAdminToken('admin1');
      const res = await supertest(app.server)
        .post('/api/v1/admin/jobs/no-job/retry')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('Non-admin gets 403 on retry', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-failed3', 'u1', 'failed');
      const token = makeUserToken('user1');
      const res = await supertest(app.server)
        .post('/api/v1/admin/jobs/job-failed3/retry')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ── Job cancellation (Req 13.5) ───────────────────────────────────────────

  describe('Job cancellation (Req 13.5)', () => {
    it('Admin cancels queued job → 200 with status=cancelled', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-q-cancel', 'u1', 'queued');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .delete('/api/v1/admin/jobs/job-q-cancel')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
    });

    it('Admin cancels processing job → 200 with status=cancelled', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-proc-cancel', 'u1', 'processing');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .delete('/api/v1/admin/jobs/job-proc-cancel')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
    });

    it('Returns 409 for completed job on cancel', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-comp-cancel', 'u1', 'completed');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .delete('/api/v1/admin/jobs/job-comp-cancel')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('Returns 409 for already cancelled job', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-already-cancelled', 'u1', 'cancelled');
      const token = makeAdminToken('admin1');

      const res = await supertest(app.server)
        .delete('/api/v1/admin/jobs/job-already-cancelled')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
    });

    it('Returns 404 for unknown jobId on cancel', async () => {
      const token = makeAdminToken('admin1');
      const res = await supertest(app.server)
        .delete('/api/v1/admin/jobs/no-job-here')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('Non-admin gets 403 on cancel', async () => {
      prisma.seedUser('u1', 'a@test.com', 'free');
      prisma.seedJob('job-q-cancel2', 'u1', 'queued');
      const token = makeUserToken('user1');
      const res = await supertest(app.server)
        .delete('/api/v1/admin/jobs/job-q-cancel2')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ── System metrics (Req 13.6) ─────────────────────────────────────────────

  describe('System metrics (Req 13.6)', () => {
    it('Returns { totalUsers, totalJobs, queuedJobs, failedJobs }', async () => {
      const token = makeAdminToken('admin1');
      const res = await supertest(app.server)
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.totalUsers).toBe('number');
      expect(typeof res.body.totalJobs).toBe('number');
      expect(typeof res.body.queuedJobs).toBe('number');
      expect(typeof res.body.failedJobs).toBe('number');
    });

    it('Values reflect seeded data (3 users, 5 jobs: 2 queued + 1 failed)', async () => {
      // Seed 3 users
      prisma.seedUser('um1', 'mu1@test.com', 'free');
      prisma.seedUser('um2', 'mu2@test.com', 'pro');
      prisma.seedUser('um3', 'mu3@test.com', 'business');
      // Seed 5 jobs: 2 queued, 1 failed, 2 completed
      prisma.seedJob('mj1', 'um1', 'queued');
      prisma.seedJob('mj2', 'um2', 'queued');
      prisma.seedJob('mj3', 'um3', 'failed');
      prisma.seedJob('mj4', 'um1', 'completed');
      prisma.seedJob('mj5', 'um2', 'completed');

      const token = makeAdminToken('admin1');
      const res = await supertest(app.server)
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.totalUsers).toBe(3);
      expect(res.body.totalJobs).toBe(5);
      expect(res.body.queuedJobs).toBe(2);
      expect(res.body.failedJobs).toBe(1);
    });

    it('Non-admin gets 403 on metrics', async () => {
      const token = makeUserToken('user1');
      const res = await supertest(app.server)
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('No auth gets 401 on metrics', async () => {
      const res = await supertest(app.server).get('/api/v1/admin/metrics');
      expect(res.status).toBe(401);
    });
  });
});
