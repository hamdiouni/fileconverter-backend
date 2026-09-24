import Fastify, { type FastifyInstance } from 'fastify';
import type IORedis from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import metricsPlugin from '../../plugins/metrics';
import { billingRoutes } from '../../routes/billing.routes';
import { InMemoryPrismaClient } from '../mocks/prisma.mock';
import { InMemoryRedis } from '../mocks/redis.mock';
import { createMockStripe } from '../mocks/stripe.mock';
import { setPrismaClient } from '../../plugins/prisma';
import { setRedisClient } from '../../plugins/redis';
import type { StripeClient } from '../../services/billing.service';

export interface TestApp {
  app: FastifyInstance;
  prisma: InMemoryPrismaClient;
  redis: InMemoryRedis;
  stripe: ReturnType<typeof createMockStripe>;
}

export async function buildTestApp(): Promise<TestApp> {
  const prisma = new InMemoryPrismaClient();
  const redis = new InMemoryRedis();
  const stripe = createMockStripe();

  // Inject mocks into singletons
  setPrismaClient(prisma as any);
  setRedisClient(redis as any);

  const fastify = Fastify({ logger: false });

  // Register mock prisma plugin
  await fastify.register(
    fp(async (instance) => {
      instance.decorate('prisma', prisma as unknown as PrismaClient);
      instance.addHook('onClose', async () => {
        await prisma.$disconnect();
      });
    }),
    { name: 'prisma' },
  );

  // Register mock redis plugin
  await fastify.register(
    fp(async (instance) => {
      instance.decorate('redis', redis as unknown as IORedis);
      instance.addHook('onClose', async () => {
        await redis.quit();
      });
    }),
    { name: 'redis' },
  );

  // Register metrics
  await fastify.register(metricsPlugin);

  // Register mock stripe
  await fastify.register(
    fp(async (instance) => {
      instance.decorate('stripe', stripe as unknown as StripeClient);
    }),
    { name: 'stripe' },
  );

  // Register routes
  await fastify.register(billingRoutes);

  // Health check with deep dependency probes
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
      service: 'billing-service',
      checks,
    });
  });

  await fastify.ready();

  return { app: fastify, prisma, redis, stripe };
}
