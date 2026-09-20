/**
 * Notification Service Integration Tests
 *
 * Tests cover:
 * - Health check
 * - Webhook delivery with HMAC signature (Requirements 12.1, 12.2, 12.3)
 * - Email delivery via mocked SendGrid (Requirement 12.4)
 * - Notification batching in Redis (Requirement 12.5)
 * - Delivery status tracking per jobId (Requirement 12.6)
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp } from '../helpers/app.helper';
import type { InMemoryPrismaClient } from '../mocks/prisma.mock';
import type { InMemoryRedis } from '../mocks/redis.mock';
import { createMockHttpClient, createMockEmailClient } from '../mocks/http.mock';
import { generateHmacSignature } from '../../services/notification.service';
import { setHttpClient, setEmailClient } from '../../services/notification.service';
import { resetEnvCache } from '../../config/env';

function makeToken(userId: string, tier = 'free'): string {
  return jwt.sign(
    { userId, email: `${userId}@test.com`, tier, permissions: [] },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' },
  );
}

const WEBHOOK_URL = 'https://example.com/webhook';

describe('Notification Service Integration Tests', () => {
  let app: FastifyInstance;
  let prisma: InMemoryPrismaClient;
  let redis: InMemoryRedis;

  beforeAll(async () => {
    resetEnvCache();
    const result = await buildTestApp('success');
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
    // Reset to success http client by default
    setHttpClient(createMockHttpClient('success'));
    setEmailClient(createMockEmailClient());
  });

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------
  describe('GET /health', () => {
    it('should return 200 with notification-service status', async () => {
      const response = await supertest(app.server).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('notification-service');
    });
  });

  // ---------------------------------------------------------------------------
  // Webhook Delivery — Req 12.1, 12.2, 12.3
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/notifications/webhooks/send', () => {
    const validPayload = {
      webhookUrl: WEBHOOK_URL,
      payload: {
        jobId: 'job-001',
        status: 'completed',
        resultFileId: 'file-abc',
        userId: 'user-webhook-1',
      },
    };

    it('should return 401 without auth token', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/notifications/webhooks/send')
        .send(validPayload);
      expect(response.status).toBe(401);
    });

    it('should deliver webhook successfully → 200 with success=true and attempts=1', async () => {
      const token = makeToken('user-webhook-1');
      const response = await supertest(app.server)
        .post('/api/v1/notifications/webhooks/send')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.attempts).toBe(1);
      expect(response.body.statusCode).toBe(200);
    });

    it('should fail after max retries → 200 with success=false and attempts=3', async () => {
      // Patch setTimeout to be instant so retries don't block
      const origSetTimeout = global.setTimeout;
      (global as any).setTimeout = (fn: () => void) => origSetTimeout(fn, 0);

      setHttpClient(createMockHttpClient('fail'));
      const token = makeToken('user-webhook-fail');

      const response = await supertest(app.server)
        .post('/api/v1/notifications/webhooks/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          webhookUrl: WEBHOOK_URL,
          payload: {
            jobId: 'job-fail-001',
            status: 'completed',
            userId: 'user-webhook-fail',
          },
        });

      (global as any).setTimeout = origSetTimeout;

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.attempts).toBe(3);
    });

    it('should retry on failure then succeed → success=true and attempts=2', async () => {
      // Patch setTimeout to be instant so retries don't block
      const origSetTimeout = global.setTimeout;
      (global as any).setTimeout = (fn: () => void) => origSetTimeout(fn, 0);

      setHttpClient(createMockHttpClient('fail_then_succeed'));
      const token = makeToken('user-webhook-retry');

      const response = await supertest(app.server)
        .post('/api/v1/notifications/webhooks/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          webhookUrl: WEBHOOK_URL,
          payload: {
            jobId: 'job-retry-001',
            status: 'completed',
            userId: 'user-webhook-retry',
          },
        });

      (global as any).setTimeout = origSetTimeout;

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.attempts).toBe(2);
    });

    it('should record delivery attempt in DB after successful delivery', async () => {
      const token = makeToken('user-webhook-db');
      const jobId = 'job-db-record-001';
      await supertest(app.server)
        .post('/api/v1/notifications/webhooks/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          webhookUrl: WEBHOOK_URL,
          payload: { jobId, status: 'completed', userId: 'user-webhook-db' },
        });

      const deliveries = await prisma.webhookDelivery.findMany({ where: { jobId } });
      expect(deliveries.length).toBe(1);
      expect(deliveries[0].jobId).toBe(jobId);
      expect(deliveries[0].status).toBe('delivered');
      expect(deliveries[0].attempt).toBe(1);
    });

    it('should generate HMAC signature — X-Signature header must start with sha256=', async () => {
      const capturedHeaders: Record<string, string> = {};
      const mockHttp = {
        post: jest.fn().mockImplementation(async (_url: string, _body: string, opts: any) => {
          Object.assign(capturedHeaders, opts.headers);
          return { status: 200 };
        }),
      };
      setHttpClient(mockHttp);
      const token = makeToken('user-hmac');

      await supertest(app.server)
        .post('/api/v1/notifications/webhooks/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          webhookUrl: WEBHOOK_URL,
          payload: { jobId: 'job-hmac-001', status: 'completed', userId: 'user-hmac' },
        });

      expect(capturedHeaders['X-Signature']).toBeDefined();
      expect(capturedHeaders['X-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should return 400 when webhookUrl is missing', async () => {
      const token = makeToken('user-webhook-1');
      const response = await supertest(app.server)
        .post('/api/v1/notifications/webhooks/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ payload: { jobId: 'job-001', status: 'completed', userId: 'user-webhook-1' } });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // HMAC Signature — unit-style tests (Req 12.1)
  // ---------------------------------------------------------------------------
  describe('generateHmacSignature (HMAC unit tests)', () => {
    it('should produce a consistent hex string for a known payload and secret', () => {
      const sig = generateHmacSignature('hello world', 'my-secret');
      expect(sig).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different signatures for different payloads', () => {
      const sig1 = generateHmacSignature('payload-A', 'secret');
      const sig2 = generateHmacSignature('payload-B', 'secret');
      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different secrets', () => {
      const sig1 = generateHmacSignature('same-payload', 'secret-1');
      const sig2 = generateHmacSignature('same-payload', 'secret-2');
      expect(sig1).not.toBe(sig2);
    });

    it('should produce the same signature for the same payload and secret (deterministic)', () => {
      const payload = JSON.stringify({ jobId: 'job-123', status: 'done', userId: 'user-1' });
      const secret = 'shared-secret';
      const sig1 = generateHmacSignature(payload, secret);
      const sig2 = generateHmacSignature(payload, secret);
      expect(sig1).toBe(sig2);
    });
  });

  // ---------------------------------------------------------------------------
  // Email Delivery — Req 12.4
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/notifications/emails/send', () => {
    it('should return 401 without auth token', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/notifications/emails/send')
        .send({ to: 'user@example.com', subject: 'Test', body: 'Hello', type: 'completion' });
      expect(response.status).toBe(401);
    });

    it('should send a completion email → 200 with sent=true', async () => {
      const token = makeToken('user-email-1');
      const response = await supertest(app.server)
        .post('/api/v1/notifications/emails/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          to: 'user@example.com',
          subject: 'Your file is ready',
          body: '<p>Your conversion is complete</p>',
          type: 'completion',
        });

      expect(response.status).toBe(200);
      expect(response.body.sent).toBe(true);
    });

    it('should send a failure email → 200 with sent=true', async () => {
      const token = makeToken('user-email-2');
      const response = await supertest(app.server)
        .post('/api/v1/notifications/emails/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          to: 'user@example.com',
          subject: 'Conversion failed',
          body: '<p>Sorry, your conversion failed</p>',
          type: 'failure',
        });

      expect(response.status).toBe(200);
      expect(response.body.sent).toBe(true);
    });

    it('should record email delivery in DB with status=sent', async () => {
      const token = makeToken('user-email-db');
      const to = 'record-test@example.com';
      await supertest(app.server)
        .post('/api/v1/notifications/emails/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          to,
          subject: 'Test email',
          body: '<p>Test</p>',
          type: 'completion',
        });

      const emails = await prisma.emailDelivery.findMany({ where: { to } });
      expect(emails.length).toBe(1);
      expect(emails[0].status).toBe('sent');
      expect(emails[0].type).toBe('completion');
    });

    it('should return 400 for invalid email address', async () => {
      const token = makeToken('user-email-3');
      const response = await supertest(app.server)
        .post('/api/v1/notifications/emails/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          to: 'not-an-email',
          subject: 'Test',
          body: 'Body',
          type: 'completion',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // Delivery Status — Req 12.6
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/notifications/webhooks/:jobId', () => {
    it('should return 401 without auth token', async () => {
      const response = await supertest(app.server).get('/api/v1/notifications/webhooks/job-xyz');
      expect(response.status).toBe(401);
    });

    it('should return list of delivery attempts for a known jobId', async () => {
      const jobId = 'job-status-001';
      prisma.seedDelivery(jobId, 'delivered', 1);
      prisma.seedDelivery(jobId, 'failed', 3);

      const token = makeToken('user-status-1');
      const response = await supertest(app.server)
        .get(`/api/v1/notifications/webhooks/${jobId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.deliveries).toHaveLength(2);
    });

    it('should return empty array for unknown jobId', async () => {
      const token = makeToken('user-status-2');
      const response = await supertest(app.server)
        .get('/api/v1/notifications/webhooks/job-nonexistent')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.deliveries).toEqual([]);
    });

    it('should show attempt count and status per delivery record', async () => {
      const jobId = 'job-status-detail';
      prisma.seedDelivery(jobId, 'delivered', 2);

      const token = makeToken('user-status-3');
      const response = await supertest(app.server)
        .get(`/api/v1/notifications/webhooks/${jobId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const [delivery] = response.body.deliveries;
      expect(delivery.attempt).toBe(2);
      expect(delivery.status).toBe('delivered');
      expect(delivery.jobId).toBe(jobId);
    });

    it('should record delivery in DB and retrieve via GET after successful webhook', async () => {
      setHttpClient(createMockHttpClient('success'));
      const jobId = 'job-end-to-end-001';
      const token = makeToken('user-e2e');

      await supertest(app.server)
        .post('/api/v1/notifications/webhooks/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          webhookUrl: WEBHOOK_URL,
          payload: { jobId, status: 'completed', userId: 'user-e2e' },
        });

      const response = await supertest(app.server)
        .get(`/api/v1/notifications/webhooks/${jobId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.deliveries.length).toBeGreaterThanOrEqual(1);
      expect(response.body.deliveries[0].status).toBe('delivered');
    });
  });

  // ---------------------------------------------------------------------------
  // Notification Batching — Req 12.5
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/notifications/batch', () => {
    it('should return 401 without auth token', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/notifications/batch')
        .send({ userId: 'user-1', notification: { jobId: 'j1', type: 'completion', message: 'Done' } });
      expect(response.status).toBe(401);
    });

    it('should store notification in Redis under user batch key → 200 with queued=true', async () => {
      const token = makeToken('user-batch-1');
      const response = await supertest(app.server)
        .post('/api/v1/notifications/batch')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: 'user-batch-1',
          notification: { jobId: 'job-b1', type: 'completion', message: 'Job done' },
        });

      expect(response.status).toBe(200);
      expect(response.body.queued).toBe(true);

      // Verify it's in Redis
      const stored = await redis.get('notification:batch:user-batch-1');
      expect(stored).not.toBeNull();
      const batch = JSON.parse(stored!);
      expect(batch).toHaveLength(1);
      expect(batch[0].jobId).toBe('job-b1');
    });

    it('should accumulate multiple notifications in the same batch', async () => {
      const token = makeToken('user-batch-2');

      await supertest(app.server)
        .post('/api/v1/notifications/batch')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: 'user-batch-2',
          notification: { jobId: 'job-c1', type: 'completion', message: 'First' },
        });

      await supertest(app.server)
        .post('/api/v1/notifications/batch')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: 'user-batch-2',
          notification: { jobId: 'job-c2', type: 'completion', message: 'Second' },
        });

      const stored = await redis.get('notification:batch:user-batch-2');
      const batch = JSON.parse(stored!);
      expect(batch).toHaveLength(2);
      expect(batch[0].jobId).toBe('job-c1');
      expect(batch[1].jobId).toBe('job-c2');
    });

    it('should have separate batches for different users', async () => {
      const token1 = makeToken('user-batch-3a');
      const token2 = makeToken('user-batch-3b');

      await supertest(app.server)
        .post('/api/v1/notifications/batch')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          userId: 'user-batch-3a',
          notification: { jobId: 'job-userA', type: 'completion', message: 'User A msg' },
        });

      await supertest(app.server)
        .post('/api/v1/notifications/batch')
        .set('Authorization', `Bearer ${token2}`)
        .send({
          userId: 'user-batch-3b',
          notification: { jobId: 'job-userB', type: 'completion', message: 'User B msg' },
        });

      const batchA = JSON.parse((await redis.get('notification:batch:user-batch-3a'))!);
      const batchB = JSON.parse((await redis.get('notification:batch:user-batch-3b'))!);

      expect(batchA).toHaveLength(1);
      expect(batchA[0].jobId).toBe('job-userA');
      expect(batchB).toHaveLength(1);
      expect(batchB[0].jobId).toBe('job-userB');
    });
  });

  // ---------------------------------------------------------------------------
  // Batch Flush — Req 12.5
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/notifications/batch/flush', () => {
    it('should return 401 without auth token', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/notifications/batch/flush')
        .send({ userId: 'user-1' });
      expect(response.status).toBe(401);
    });

    it('should return all accumulated notifications and clear the batch on flush', async () => {
      const token = makeToken('user-flush-1');

      // Add two notifications
      await supertest(app.server)
        .post('/api/v1/notifications/batch')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: 'user-flush-1',
          notification: { jobId: 'job-f1', type: 'completion', message: 'First' },
        });
      await supertest(app.server)
        .post('/api/v1/notifications/batch')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: 'user-flush-1',
          notification: { jobId: 'job-f2', type: 'failure', message: 'Second' },
        });

      // Flush
      const flushResponse = await supertest(app.server)
        .post('/api/v1/notifications/batch/flush')
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: 'user-flush-1' });

      expect(flushResponse.status).toBe(200);
      expect(flushResponse.body.notifications).toHaveLength(2);
      expect(flushResponse.body.notifications[0].jobId).toBe('job-f1');
      expect(flushResponse.body.notifications[1].jobId).toBe('job-f2');

      // Batch should be cleared
      const stored = await redis.get('notification:batch:user-flush-1');
      expect(stored).toBeNull();
    });

    it('should return empty array when flushing a user with no batch', async () => {
      const token = makeToken('user-flush-empty');
      const response = await supertest(app.server)
        .post('/api/v1/notifications/batch/flush')
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: 'user-flush-empty' });

      expect(response.status).toBe(200);
      expect(response.body.notifications).toEqual([]);
    });

    it('should not affect other users batches when flushing', async () => {
      const tokenA = makeToken('user-flush-a');
      const tokenB = makeToken('user-flush-b');

      // Add for user A
      await supertest(app.server)
        .post('/api/v1/notifications/batch')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          userId: 'user-flush-a',
          notification: { jobId: 'job-fa1', type: 'completion', message: 'User A' },
        });

      // Add for user B
      await supertest(app.server)
        .post('/api/v1/notifications/batch')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          userId: 'user-flush-b',
          notification: { jobId: 'job-fb1', type: 'completion', message: 'User B' },
        });

      // Flush only user A
      await supertest(app.server)
        .post('/api/v1/notifications/batch/flush')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ userId: 'user-flush-a' });

      // User B's batch should still exist
      const batchB = await redis.get('notification:batch:user-flush-b');
      expect(batchB).not.toBeNull();
      const parsedB = JSON.parse(batchB!);
      expect(parsedB).toHaveLength(1);
      expect(parsedB[0].jobId).toBe('job-fb1');
    });
  });
});
