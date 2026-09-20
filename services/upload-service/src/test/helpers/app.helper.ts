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

  fastify.get('/health', async () => ({ status: 'ok', service: 'upload-service' }));
  await fastify.ready();

  return { app: fastify, prisma, redis, storage };
}
