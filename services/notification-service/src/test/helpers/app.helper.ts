import Fastify, { type FastifyInstance } from 'fastify';
import type IORedis from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import metricsPlugin from '../../plugins/metrics';
import { notificationRoutes } from '../../routes/notification.routes';
import { InMemoryPrismaClient } from '../mocks/prisma.mock';
import { InMemoryRedis } from '../mocks/redis.mock';
import { createMockHttpClient, createMockEmailClient } from '../mocks/http.mock';
import { setPrismaClient } from '../../plugins/prisma';
import { setRedisClient } from '../../plugins/redis';
import { setHttpClient, setEmailClient } from '../../services/notification.service';

export interface TestApp {
  app: FastifyInstance;
  prisma: InMemoryPrismaClient;
  redis: InMemoryRedis;
  httpClient: ReturnType<typeof createMockHttpClient>;
  emailClient: ReturnType<typeof createMockEmailClient>;
}

export async function buildTestApp(httpBehavior: 'success' | 'fail' | 'fail_then_succeed' = 'success'): Promise<TestApp> {
  const prisma = new InMemoryPrismaClient();
  const redis = new InMemoryRedis();
  const httpClient = createMockHttpClient(httpBehavior);
  const emailClient = createMockEmailClient();

  // Inject mocks into singletons
  setPrismaClient(prisma as any);
  setRedisClient(redis as any);
  setHttpClient(httpClient);
  setEmailClient(emailClient);

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

  // Register routes
  await fastify.register(notificationRoutes);

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', service: 'notification-service' }));

  await fastify.ready();

  return { app: fastify, prisma, redis, httpClient, emailClient };
}
