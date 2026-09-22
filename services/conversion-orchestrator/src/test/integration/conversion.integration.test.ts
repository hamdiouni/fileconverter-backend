/**
 * Conversion Orchestrator Service Integration Tests
 *
 * Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 5.8
 */

import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp } from '../helpers/app.helper';
import type { InMemoryPrismaClient } from '../mocks/prisma.mock';
import type { InMemoryRedis } from '../mocks/redis.mock';
import { resetEnvCache } from '../../config/env';

/**
 * Create a signed JWT for testing.
 * The sourceFileId pattern "file-<format>-<suffix>" is used by resolveSourceFormat.
 */
function makeToken(userId: string, tier = 'free'): string {
  return jwt.sign(
    { userId, email: `${userId}@test.com`, tier, permissions: [] },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' },
  );
}

describe('Conversion Orchestrator Integration Tests', () => {
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

  // ─── Health ──────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('should return 200 with service status', async () => {
      const res = await supertest(app.server).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('conversion-orchestrator');
    });
  });

  // ─── Authentication ──────────────────────────────────────────────────────

  describe('Authentication', () => {
    it('should return 401 when no token is provided on POST /api/v1/conversions', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg' });
      expect(res.status).toBe(401);
    });

    it('should return 401 when an invalid token is provided', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', 'Bearer invalid.token.here')
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg' });
      expect(res.status).toBe(401);
    });

    it('should return 401 when no token is provided on GET /api/v1/conversions', async () => {
      const res = await supertest(app.server).get('/api/v1/conversions');
      expect(res.status).toBe(401);
    });

    it('should return 401 when no token is provided on GET /api/v1/conversions/:id', async () => {
      const res = await supertest(app.server).get('/api/v1/conversions/some-id');
      expect(res.status).toBe(401);
    });

    it('should return 401 when no token is provided on DELETE /api/v1/conversions/:id', async () => {
      const res = await supertest(app.server).delete('/api/v1/conversions/some-id');
      expect(res.status).toBe(401);
    });
  });

  // ─── Job Submission ───────────────────────────────────────────────────────

  describe('POST /api/v1/conversions — job submission', () => {
    it('should submit a valid job and return 202 with queued status (Req 5.1, 5.2)', async () => {
      const token = makeToken('user-1');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg' });

      expect(res.status).toBe(202);
      expect(res.body.jobId).toBeDefined();
      expect(res.body.status).toBe('queued');
      expect(res.body.fromCache).toBe(false);
    });

    it('should return 400 for an unsupported conversion format pair (Req 5.2)', async () => {
      const token = makeToken('user-1');
      // png → mp3 is not a valid conversion
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'mp3' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FORMAT_PAIR');
    });

    it('should return 400 when sourceFileId is missing (validation)', async () => {
      const token = makeToken('user-1');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetFormat: 'jpg' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when targetFormat is missing (validation)', async () => {
      const token = makeToken('user-1');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-001' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should store the job in the database after submission', async () => {
      const token = makeToken('user-1');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg' });

      expect(res.status).toBe(202);
      const jobId = res.body.jobId;
      const stored = await prisma.conversionJob.findUnique({ where: { id: jobId } });
      expect(stored).not.toBeNull();
      expect(stored!.userId).toBe('user-1');
      expect(stored!.status).toBe('queued');
    });

    it('should pass conversion options through to the job (Req 5.4)', async () => {
      const token = makeToken('user-1');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourceFileId: 'file-png-001',
          targetFormat: 'jpg',
          options: { quality: 85, width: 1920 },
        });

      expect(res.status).toBe(202);
      const jobId = res.body.jobId;
      const stored = await prisma.conversionJob.findUnique({ where: { id: jobId } });
      expect(stored!.options).toMatchObject({ quality: 85, width: 1920 });
    });
  });

  // ─── Idempotency Key ─────────────────────────────────────────────────────

  describe('POST /api/v1/conversions — idempotency key (Req 5.6)', () => {
    it('should return the existing job when the same idempotency key is used twice', async () => {
      const token = makeToken('user-1');
      const idempotencyKey = 'idem-key-abc-123';

      const res1 = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg', idempotencyKey });

      const res2 = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-002', targetFormat: 'webp', idempotencyKey });

      expect(res1.status).toBe(202);
      expect(res2.status).toBe(202);
      // Second request should return the original job ID
      expect(res2.body.jobId).toBe(res1.body.jobId);
      expect(res2.body.fromIdempotency).toBe(true);
    });

    it('should not deduplicate jobs with different idempotency keys', async () => {
      const token = makeToken('user-1');

      const res1 = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg', idempotencyKey: 'key-1' });

      const res2 = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg', idempotencyKey: 'key-2' });

      expect(res1.status).toBe(202);
      expect(res2.status).toBe(202);
      expect(res1.body.jobId).not.toBe(res2.body.jobId);
    });

    it('should not share idempotency keys across users', async () => {
      const token1 = makeToken('user-1');
      const token2 = makeToken('user-2');
      const idempotencyKey = 'shared-key';

      const res1 = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token1}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg', idempotencyKey });

      const res2 = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token2}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg', idempotencyKey });

      expect(res1.status).toBe(202);
      expect(res2.status).toBe(202);
      // Different users get different jobs despite same idempotency key
      expect(res1.body.jobId).not.toBe(res2.body.jobId);
      expect(res2.body.fromIdempotency).toBe(false);
    });
  });

  // ─── Quota Enforcement ───────────────────────────────────────────────────

  describe('POST /api/v1/conversions — quota enforcement (Req 5.5)', () => {
    it('should return 402 when the user has exceeded their monthly quota', async () => {
      const token = makeToken('user-quota');
      // Seed usage logs for user-quota (100 is the free tier limit)
      prisma.seedUsage('user-quota', 100);

      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg' });

      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    });

    it('should allow submission when under quota', async () => {
      const token = makeToken('user-underquota');
      // Seed 50 usage logs (under limit of 100)
      prisma.seedUsage('user-underquota', 50);

      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg' });

      expect(res.status).toBe(202);
    });

    it('should allow submission when there is no prior usage', async () => {
      const token = makeToken('user-nousage');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-001', targetFormat: 'jpg' });

      expect(res.status).toBe(202);
    });
  });

  // ─── Cache Hit Detection ──────────────────────────────────────────────────

  describe('POST /api/v1/conversions — cache hit detection (Req 5.8)', () => {
    it('should return fromCache=true when a cache hit exists for the conversion', async () => {
      const token = makeToken('user-cache');
      const sourceFileId = 'file-png-cache-test';
      const targetFormat = 'jpg';

      // Build the cache key using the service's buildCacheKey logic
      const { ConversionService } = require('../../services/conversion.service');
      const svc = new ConversionService(prisma, redis);
      const cacheKey = svc.buildCacheKey(sourceFileId, targetFormat.toLowerCase());

      // Seed a cached result
      await redis.set(`cache:hit:${cacheKey}`, 'result-file-id-cached');

      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId, targetFormat });

      expect(res.status).toBe(202);
      expect(res.body.fromCache).toBe(true);
      expect(res.body.status).toBe('completed');
      expect(res.body.resultFileId).toBe('result-file-id-cached');
    });

    it('should return fromCache=false when no cached result exists', async () => {
      const token = makeToken('user-nocache');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-nocache', targetFormat: 'jpg' });

      expect(res.status).toBe(202);
      expect(res.body.fromCache).toBe(false);
    });
  });

  // ─── Get Job ─────────────────────────────────────────────────────────────

  describe('GET /api/v1/conversions/:id — get job by ID (Req 5.8)', () => {
    it('should return 200 with job data for the owner', async () => {
      const token = makeToken('user-owner');
      prisma.seedJob('job-001', 'user-owner', 'queued', 'png', 'jpg');

      const res = await supertest(app.server)
        .get('/api/v1/conversions/job-001')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('job-001');
      expect(res.body.userId).toBe('user-owner');
      expect(res.body.status).toBe('queued');
    });

    it('should return 404 when the job does not exist', async () => {
      const token = makeToken('user-owner');
      const res = await supertest(app.server)
        .get('/api/v1/conversions/non-existent-job')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 when another user tries to access the job', async () => {
      const otherToken = makeToken('user-other');
      prisma.seedJob('job-002', 'user-owner2', 'completed', 'mp4', 'webm');

      const res = await supertest(app.server)
        .get('/api/v1/conversions/job-002')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ─── List Jobs ────────────────────────────────────────────────────────────

  describe('GET /api/v1/conversions — list jobs (Req 5.8)', () => {
    it('should return 200 with paginated list of jobs for the user', async () => {
      const token = makeToken('user-list');
      prisma.seedJob('job-list-1', 'user-list', 'queued', 'png', 'jpg');
      prisma.seedJob('job-list-2', 'user-list', 'completed', 'mp3', 'wav');
      prisma.seedJob('job-list-3', 'user-list', 'failed', 'pdf', 'docx');

      const res = await supertest(app.server)
        .get('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.total).toBe(3);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(20);
    });

    it('should only return jobs belonging to the authenticated user', async () => {
      const token1 = makeToken('user-a');
      const token2 = makeToken('user-b');

      prisma.seedJob('job-a-1', 'user-a', 'queued', 'png', 'jpg');
      prisma.seedJob('job-a-2', 'user-a', 'completed', 'mp4', 'webm');
      prisma.seedJob('job-b-1', 'user-b', 'queued', 'mp3', 'wav');

      const res1 = await supertest(app.server)
        .get('/api/v1/conversions')
        .set('Authorization', `Bearer ${token1}`);

      const res2 = await supertest(app.server)
        .get('/api/v1/conversions')
        .set('Authorization', `Bearer ${token2}`);

      expect(res1.body.data).toHaveLength(2);
      expect(res2.body.data).toHaveLength(1);
    });

    it('should filter jobs by status when status query param is provided', async () => {
      const token = makeToken('user-filter');
      prisma.seedJob('job-f-1', 'user-filter', 'queued', 'png', 'jpg');
      prisma.seedJob('job-f-2', 'user-filter', 'completed', 'mp4', 'webm');
      prisma.seedJob('job-f-3', 'user-filter', 'queued', 'mp3', 'wav');

      const res = await supertest(app.server)
        .get('/api/v1/conversions?status=queued')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      for (const job of res.body.data) {
        expect(job.status).toBe('queued');
      }
    });

    it('should support pagination via page and pageSize params', async () => {
      const token = makeToken('user-page');
      for (let i = 1; i <= 5; i++) {
        prisma.seedJob(`job-page-${i}`, 'user-page', 'queued', 'png', 'jpg');
      }

      const res = await supertest(app.server)
        .get('/api/v1/conversions?page=1&pageSize=2')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.total).toBe(5);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(2);
    });

    it('should return 200 with empty list when user has no jobs', async () => {
      const token = makeToken('user-nojobs');
      const res = await supertest(app.server)
        .get('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });
  });

  // ─── Cancel Job ───────────────────────────────────────────────────────────

  describe('DELETE /api/v1/conversions/:id — cancel job', () => {
    it('should cancel a queued job and return 200 with cancelled status', async () => {
      const token = makeToken('user-cancel');
      prisma.seedJob('job-cancel-1', 'user-cancel', 'queued', 'png', 'jpg');

      const res = await supertest(app.server)
        .delete('/api/v1/conversions/job-cancel-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
    });

    it('should cancel a processing job and return 200', async () => {
      const token = makeToken('user-cancel2');
      prisma.seedJob('job-cancel-2', 'user-cancel2', 'processing', 'mp4', 'webm');

      const res = await supertest(app.server)
        .delete('/api/v1/conversions/job-cancel-2')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
    });

    it('should return 409 when cancelling an already completed job', async () => {
      const token = makeToken('user-cancel3');
      prisma.seedJob('job-cancel-3', 'user-cancel3', 'completed', 'png', 'webp');

      const res = await supertest(app.server)
        .delete('/api/v1/conversions/job-cancel-3')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('JOB_NOT_CANCELLABLE');
    });

    it('should return 409 when cancelling an already failed job', async () => {
      const token = makeToken('user-cancel4');
      prisma.seedJob('job-cancel-4', 'user-cancel4', 'failed', 'mp3', 'wav');

      const res = await supertest(app.server)
        .delete('/api/v1/conversions/job-cancel-4')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('JOB_NOT_CANCELLABLE');
    });

    it('should return 409 when cancelling an already cancelled job', async () => {
      const token = makeToken('user-cancel5');
      prisma.seedJob('job-cancel-5', 'user-cancel5', 'cancelled', 'pdf', 'docx');

      const res = await supertest(app.server)
        .delete('/api/v1/conversions/job-cancel-5')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
    });

    it('should return 404 when cancelling a non-existent job', async () => {
      const token = makeToken('user-cancel6');
      const res = await supertest(app.server)
        .delete('/api/v1/conversions/no-such-job')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 when cancelling another user\'s job', async () => {
      const otherToken = makeToken('user-other-cancel');
      prisma.seedJob('job-cancel-6', 'user-real-owner', 'queued', 'png', 'jpg');

      const res = await supertest(app.server)
        .delete('/api/v1/conversions/job-cancel-6')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should persist the cancelled status in the database', async () => {
      const token = makeToken('user-persist-cancel');
      prisma.seedJob('job-persist-cancel', 'user-persist-cancel', 'queued', 'png', 'jpg');

      await supertest(app.server)
        .delete('/api/v1/conversions/job-persist-cancel')
        .set('Authorization', `Bearer ${token}`);

      const stored = await prisma.conversionJob.findUnique({
        where: { id: 'job-persist-cancel' },
      });
      expect(stored!.status).toBe('cancelled');
    });
  });

  // ─── Format Pair Validation ───────────────────────────────────────────────

  describe('Format pair validation (Req 5.1, 5.2)', () => {
    it('should accept valid image-to-image conversions (png → webp)', async () => {
      const token = makeToken('user-fmt1');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-png-fmt1', targetFormat: 'webp' });
      expect(res.status).toBe(202);
    });

    it('should accept valid video-to-video conversions (mp4 → webm)', async () => {
      const token = makeToken('user-fmt2');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-mp4-fmt2', targetFormat: 'webm' });
      expect(res.status).toBe(202);
    });

    it('should accept valid audio conversions (mp3 → wav)', async () => {
      const token = makeToken('user-fmt3');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-mp3-fmt3', targetFormat: 'wav' });
      expect(res.status).toBe(202);
    });

    it('should accept valid document conversions (pdf → docx)', async () => {
      const token = makeToken('user-fmt4');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-pdf-fmt4', targetFormat: 'docx' });
      expect(res.status).toBe(202);
    });

    it('should reject cross-domain conversions (video → audio)', async () => {
      const token = makeToken('user-fmt5');
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceFileId: 'file-mp4-fmt5', targetFormat: 'mp3' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FORMAT_PAIR');
    });
  });

  // ─── API Key Authentication ───────────────────────────────────────────────
  describe('API Key Authentication', () => {
    it('should allow submitting conversion using X-API-Key', async () => {
      const crypto = await import('crypto');
      const rawKey = 'fc_live_orch_test_key_123';
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      prisma.seedApiKey('key-orch-1', 'user-api-orch', keyHash);

      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('X-API-Key', rawKey)
        .send({ sourceFileId: 'file-png-apikey', targetFormat: 'webp' });

      expect(res.status).toBe(202);
      expect(res.body.jobId).toBeDefined();
    });

    it('should reject invalid X-API-Key with 401', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/conversions')
        .set('X-API-Key', 'invalid_key_str')
        .send({ sourceFileId: 'file-png-apikey', targetFormat: 'webp' });

      expect(res.status).toBe(401);
    });
  });

  // ─── Webhook Multi-Dispatch on Terminal State ─────────────────────────────
  describe('Webhook Multi-Dispatch on Terminal State', () => {
    it('should dispatch to user-registered WebhookEndpoints when job completes', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => ({ ok: true } as any));

      prisma.seedJob('job-webhook-test', 'user-webhook-owner', 'processing', 'png', 'jpg');
      prisma.seedWebhookEndpoint('ep-owner-1', 'user-webhook-owner', 'https://example.com/user-webhook', ['conversion.completed']);

      const res = await supertest(app.server)
        .post('/internal/conversions/job-webhook-test/status')
        .send({ status: 'completed' });

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/internal/notifications/webhooks/send'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('https://example.com/user-webhook'),
        }),
      );

      fetchSpy.mockRestore();
    });
  });
});
