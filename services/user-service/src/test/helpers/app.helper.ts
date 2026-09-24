import Fastify, { type FastifyInstance } from 'fastify';
import type IORedis from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import metricsPlugin from '../../plugins/metrics';
import { userRoutes } from '../../routes/user.routes';
import { webhookRoutes } from '../../routes/webhook.routes';
import { InMemoryPrismaClient } from '../mocks/prisma.mock';
import { InMemoryRedis } from '../mocks/redis.mock';
import { setPrismaClient } from '../../plugins/prisma';
import { setRedisClient } from '../../plugins/redis';

export interface TestApp {
  app: FastifyInstance;
  prisma: InMemoryPrismaClient;
  redis: InMemoryRedis;
}

export async function buildTestApp(): Promise<TestApp> {
  const prisma = new InMemoryPrismaClient();
  const redis = new InMemoryRedis();

  // Seed default test user
  prisma.seedUser('user-1', 'test@example.com', 'free');

  setPrismaClient(prisma as any);
  setRedisClient(redis as any);

  const fastify = Fastify({ logger: false });

  await fastify.register(
    fp(async (instance) => {
      instance.decorate('prisma', prisma as unknown as PrismaClient);
      instance.addHook('onClose', async () => { await prisma.$disconnect(); });
    }),
    { name: 'prisma' },
  );

  await fastify.register(
    fp(async (instance) => {
      instance.decorate('redis', redis as unknown as IORedis);
      instance.addHook('onClose', async () => { await redis.quit(); });
    }),
    { name: 'redis' },
  );

  await fastify.register(metricsPlugin);
  await fastify.register(userRoutes);
  await fastify.register(webhookRoutes);

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

    const statusCode = isHealthy ? 200 : 503;
    return reply.status(statusCode).send({
      status: isHealthy ? 'ok' : 'degraded',
      service: 'user-service',
      checks,
    });
  });

  await fastify.ready();

  return { app: fastify, prisma, redis };
}
