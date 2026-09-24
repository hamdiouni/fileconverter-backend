import Fastify, { type FastifyInstance } from 'fastify';
import prismaPlugin from './plugins/prisma';
import redisPlugin from './plugins/redis';
import metricsPlugin from './plugins/metrics';
import { billingRoutes } from './routes/billing.routes';
import type { StripeClient } from './services/billing.service';

declare module 'fastify' {
  interface FastifyInstance {
    stripe: StripeClient;
  }
}

export async function buildApp(options?: {
  logger?: boolean;
  stripe?: StripeClient;
}): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: options?.logger ?? false });

  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(metricsPlugin);

  // Stripe must be decorated before routes
  const stripeClient = options?.stripe;
  if (!stripeClient) {
    throw new Error('Stripe client is required. Pass it via options.stripe');
  }
  fastify.decorate('stripe', stripeClient);

  await fastify.register(billingRoutes);

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

  return fastify;
}
