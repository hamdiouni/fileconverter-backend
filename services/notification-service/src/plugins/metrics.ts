import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { register, Counter, Histogram } from 'prom-client';

declare module 'fastify' {
  interface FastifyInstance {
    metrics: {
      notificationRequestsTotal: Counter;
      notificationRequestDuration: Histogram;
    };
  }
}

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  const notificationRequestsTotal = new Counter({
    name: 'notification_requests_total',
    help: 'Total number of notification requests',
    labelNames: ['endpoint', 'status'],
    registers: [register],
  });

  const notificationRequestDuration = new Histogram({
    name: 'notification_request_duration_seconds',
    help: 'Duration of notification requests in seconds',
    labelNames: ['endpoint'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });

  fastify.decorate('metrics', {
    notificationRequestsTotal,
    notificationRequestDuration,
  });

  // Expose /metrics endpoint
  fastify.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
};

export default fp(metricsPlugin, { name: 'metrics' });
