import Fastify, { type FastifyInstance } from 'fastify';
import redisPlugin from './plugins/redis';
import prismaPlugin from './plugins/prisma';
import metricsPlugin from './plugins/metrics';
import { authRoutes } from './routes/auth.routes';

export async function buildApp(options?: { logger?: boolean }): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: options?.logger ?? false,
  });

  // Register plugins
  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(metricsPlugin);

  // Register routes
  await fastify.register(authRoutes);

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', service: 'auth-service' }));

  return fastify;
}
