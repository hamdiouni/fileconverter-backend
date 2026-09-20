import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { register, Counter, Histogram } from 'prom-client';

declare module 'fastify' {
  interface FastifyInstance {
    metrics: {
      authRequestsTotal: Counter;
      authRequestDuration: Histogram;
      jwtValidationsTotal: Counter;
    };
  }
}

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  const authRequestsTotal = new Counter({
    name: 'auth_requests_total',
    help: 'Total number of auth requests',
    labelNames: ['endpoint', 'status'],
    registers: [register],
  });

  const authRequestDuration = new Histogram({
    name: 'auth_request_duration_seconds',
    help: 'Duration of auth requests in seconds',
    labelNames: ['endpoint'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });

  const jwtValidationsTotal = new Counter({
    name: 'jwt_validations_total',
    help: 'Total number of JWT validation attempts',
    labelNames: ['result'],
    registers: [register],
  });

  fastify.decorate('metrics', {
    authRequestsTotal,
    authRequestDuration,
    jwtValidationsTotal,
  });

  // Expose /metrics endpoint
  fastify.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
};

export default fp(metricsPlugin, { name: 'metrics' });
