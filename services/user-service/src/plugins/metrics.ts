import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const userRequestsTotal = new client.Counter({
  name: 'user_requests_total',
  help: 'Total number of requests to the user service',
  labelNames: ['endpoint', 'method', 'status'],
  registers: [register],
});

export const quotaChecksTotal = new client.Counter({
  name: 'quota_checks_total',
  help: 'Total number of quota checks',
  labelNames: ['tier', 'result'],
  registers: [register],
});

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
};

export default fp(metricsPlugin, { name: 'metrics' });
