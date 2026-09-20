import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const uploadRequestsTotal = new client.Counter({
  name: 'upload_requests_total',
  help: 'Total upload requests',
  labelNames: ['status'],
  registers: [register],
});

export const uploadSizeBytes = new client.Histogram({
  name: 'upload_size_bytes',
  help: 'File upload sizes in bytes',
  buckets: [1024, 10240, 102400, 1048576, 10485760, 104857600],
  registers: [register],
});

export const virusScansTotal = new client.Counter({
  name: 'virus_scans_total',
  help: 'Total virus scans',
  labelNames: ['result'],
  registers: [register],
});

const plugin: FastifyPluginAsync = async (f) => {
  f.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
};
export default fp(plugin, { name: 'metrics' });
