import Fastify, { type FastifyInstance } from 'fastify';
import type IORedis from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import metricsPlugin from '../../plugins/metrics';
import { uploadRoutes } from '../../routes/upload.routes';
import { InMemoryPrismaClient } from '../mocks/prisma.mock';
import { InMemoryRedis } from '../mocks/redis.mock';
import { InMemoryStorageService } from '../mocks/storage.mock';
import { setPrismaClient } from '../../plugins/prisma';
import { setRedisClient } from '../../plugins/redis';

export interface TestApp {
  app: FastifyInstance;
  prisma: InMemoryPrismaClient;
  redis: InMemoryRedis;
  storage: InMemoryStorageService;
}

export async function buildTestApp(): Promise<TestApp> {
  const prisma = new InMemoryPrismaClient();
  const redis = new InMemoryRedis();
  const storage = new InMemoryStorageService();

  setPrismaClient(prisma as any);
  setRedisClient(redis as any);

  const fastify = Fastify({ logger: false });

  await fastify.register(fp(async (instance) => {
    instance.decorate('prisma', prisma as unknown as PrismaClient);
    instance.addHook('onClose', async () => { await prisma.$disconnect(); });
  }, { name: 'prisma' }));

  await fastify.register(fp(async (instance) => {
    instance.decorate('redis', redis as unknown as IORedis);
    instance.addHook('onClose', async () => { await redis.quit(); });
  }, { name: 'redis' }));

  await fastify.register(metricsPlugin);

  (fastify as any).storage = storage;
  await fastify.register(uploadRoutes);

  fastify.get('/health', async (_req, reply) => {
    const checks: Record<string, 'ok' | 'error'> = {};
    let isHealthy = true;

    try {
      if (typeof (fastify.prisma as any)?.$queryRaw === 'function') {
        await (fastify.prisma as any).$queryRaw`SELECT 1`;
      }
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
      isHealthy = false;
    }

    try {
      if (typeof (fastify.redis as any)?.ping === 'function') {
        await (fastify.redis as any).ping();
      }
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
      isHealthy = false;
    }

    try {
      if (typeof (fastify as any).storage?.ping === 'function') {
        const ok = await (fastify as any).storage.ping();
        if (!ok) throw new Error('Storage ping failed');
      }
      checks.storage = 'ok';
    } catch {
      checks.storage = 'error';
      isHealthy = false;
    }

    const statusCode = isHealthy ? 200 : 503;
    return reply.status(statusCode).send({
      status: isHealthy ? 'ok' : 'degraded',
      service: 'upload-service',
      checks,
    });
  });

  await fastify.ready();

  return { app: fastify, prisma, redis, storage };
}
