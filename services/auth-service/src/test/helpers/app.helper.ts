import Fastify, { type FastifyInstance } from 'fastify';
import type IORedis from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import metricsPlugin from '../../plugins/metrics';
import { authRoutes } from '../../routes/auth.routes';
import { InMemoryPrismaClient } from '../mocks/prisma.mock';
import { InMemoryRedis } from '../mocks/redis.mock';
import { setPrismaClient } from '../../plugins/prisma';
import { setRedisClient } from '../../plugins/redis';
import fp from 'fastify-plugin';

export interface TestApp {
  app: FastifyInstance;
  prisma: InMemoryPrismaClient;
  redis: InMemoryRedis;
}

export async function buildTestApp(): Promise<TestApp> {
  const prisma = new InMemoryPrismaClient();
  const redis = new InMemoryRedis();

  // Inject our mocks into the singletons
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

  // Register metrics (uses prom-client which is fine in tests)
  await fastify.register(metricsPlugin);

  // Register routes
  await fastify.register(authRoutes);

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', service: 'auth-service' }));

  await fastify.ready();

  return { app: fastify, prisma, redis };
}
