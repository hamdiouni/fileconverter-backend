import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { register, Counter, Histogram } from 'prom-client';

declare module 'fastify' {
  interface FastifyInstance {
    metrics: {
      adminRequestsTotal: Counter;
      adminRequestDuration: Histogram;
    };
  }
}

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  const adminRequestsTotal = new Counter({
    name: 'admin_requests_total',
    help: 'Total number of admin requests',
    labelNames: ['endpoint', 'status'],
    registers: [register],
  });

  const adminRequestDuration = new Histogram({
    name: 'admin_request_duration_seconds',
    help: 'Duration of admin requests in seconds',
    labelNames: ['endpoint'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });

  fastify.decorate('metrics', {
    adminRequestsTotal,
    adminRequestDuration,
  });

  // Expose /metrics endpoint
  fastify.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
};

export default fp(metricsPlugin, { name: 'metrics' });
