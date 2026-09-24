import Fastify, { type FastifyInstance } from 'fastify';
import prismaPlugin from './plugins/prisma';
import redisPlugin from './plugins/redis';
import metricsPlugin from './plugins/metrics';
import { userRoutes } from './routes/user.routes';
import { webhookRoutes } from './routes/webhook.routes';

export async function buildApp(options?: { logger?: boolean }): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: options?.logger ?? false });

  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
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

  return fastify;
}
