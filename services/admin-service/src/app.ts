import Fastify, { type FastifyInstance } from 'fastify';
import prismaPlugin from './plugins/prisma';
import redisPlugin from './plugins/redis';
import metricsPlugin from './plugins/metrics';
import { adminRoutes } from './routes/admin.routes';

export async function buildApp(options?: {
  logger?: boolean;
}): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: options?.logger ?? false });

  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(metricsPlugin);

  await fastify.register(adminRoutes);

  fastify.get('/health', async () => ({ status: 'ok', service: 'admin-service' }));

  return fastify;
}
