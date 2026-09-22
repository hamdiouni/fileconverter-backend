import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp } from '../helpers/app.helper';
import type { InMemoryPrismaClient } from '../mocks/prisma.mock';
import type { InMemoryRedis } from '../mocks/redis.mock';
import { resetEnvCache } from '../../config/env';

function makeToken(userId: string, tier = 'free'): string {
  return jwt.sign(
    { userId, email: `${userId}@test.com`, tier, permissions: [] },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' },
  );
}

describe('Queue Dispatch & Worker Status Flow', () => {
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
    token = makeToken('user-queue-1', 'pro');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.reset();
    redis.reset();
  });

  it('submits job and dispatches to BullMQ Redis list without fake timeouts', async () => {
    // 1. Submit conversion job for an image
    const response = await supertest(app.server)
      .post('/api/v1/conversions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceFileId: 'file-png-test-1234',
        targetFormat: 'jpg',
        options: { quality: 90 },
      });

    expect(response.status).toBe(202);
    expect(response.body).toHaveProperty('jobId');
    expect(response.body.status).toBe('queued');

    const jobId = response.body.jobId;

    // 2. Verify job was pushed into Redis list bull:fc:queue:image:wait
    const queueKey = 'bull:fc:queue:image:wait';
    const queueLen = await redis.llen(queueKey);
    expect(queueLen).toBe(1);

    const rawEnvelope = await redis.rpop(queueKey);
    expect(rawEnvelope).not.toBeNull();
    const envelope = JSON.parse(rawEnvelope!);
    expect(envelope).toHaveProperty('id');
    expect(envelope.name).toBe('convert');
    expect(envelope.data.jobId).toBe(jobId);
    expect(envelope.data.sourceFileId).toBe('file-png-test-1234');
    expect(envelope.data.targetFormat).toBe('jpg');
    expect(envelope.data.options).toEqual({ quality: 90 });
    expect(envelope.data.callbackUrl).toContain(`/internal/conversions/${jobId}/status`);

    // 3. Simulate worker posting status update: processing
    const workerProcessing = await supertest(app.server)
      .post(`/internal/conversions/${jobId}/status`)
      .send({
        status: 'processing',
        progress: 30,
        workerId: 'image-worker-1',
      });

    expect(workerProcessing.status).toBe(200);

    const jobMid = await (prisma as any).conversionJob.findUnique({ where: { id: jobId } });
    expect(jobMid?.status).toBe('processing');
    expect(jobMid?.progress).toBe(30);

    // 4. Simulate worker posting status update: completed with result file
    const workerCompleted = await supertest(app.server)
      .post(`/internal/conversions/${jobId}/status`)
      .send({
        status: 'completed',
        resultFileId: 'results/test-output.jpg',
        workerId: 'image-worker-1',
      });

    expect(workerCompleted.status).toBe(200);

    const jobFinal = await (prisma as any).conversionJob.findUnique({ where: { id: jobId } });
    expect(jobFinal?.status).toBe('completed');
    expect(jobFinal?.progress).toBe(100);
    expect(jobFinal?.resultFileId).toBe('results/test-output.jpg');
  });
});
