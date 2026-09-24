import Fastify, { type FastifyInstance } from 'fastify';
import redisPlugin from './plugins/redis';
import prismaPlugin from './plugins/prisma';
import metricsPlugin from './plugins/metrics';
import { authRoutes } from './routes/auth.routes';
import { internalRoutes } from './routes/internal.routes';

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
  await fastify.register(internalRoutes);

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
      service: 'auth-service',
      checks,
    });
  });

  return fastify;
}
