import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { register, Counter, Histogram, Gauge } from 'prom-client';

declare module 'fastify' {
  interface FastifyInstance {
    metrics: {
      conversionsSubmittedTotal: Counter;
      conversionQueueDepth: Gauge;
      conversionEnqueueDuration: Histogram;
      cacheHitTotal: Counter;
      cacheMissTotal: Counter;
    };
  }
}

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  const conversionsSubmittedTotal = new Counter({
    name: 'conversions_submitted_total',
    help: 'Total number of conversion jobs submitted',
    labelNames: ['format_family'],
    registers: [register],
  });

  const conversionQueueDepth = new Gauge({
    name: 'conversion_queue_depth',
    help: 'Current depth of the conversion queue',
    labelNames: ['format_family'],
    registers: [register],
  });

  const conversionEnqueueDuration = new Histogram({
    name: 'conversion_enqueue_duration_seconds',
    help: 'Duration of conversion job enqueueing in seconds',
    labelNames: ['format_family'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [register],
  });

  const cacheHitTotal = new Counter({
    name: 'cache_hit_total',
    help: 'Total number of cache hits',
    registers: [register],
  });

  const cacheMissTotal = new Counter({
    name: 'cache_miss_total',
    help: 'Total number of cache misses',
    registers: [register],
  });

  fastify.decorate('metrics', {
    conversionsSubmittedTotal,
    conversionQueueDepth,
    conversionEnqueueDuration,
    cacheHitTotal,
    cacheMissTotal,
  });

  fastify.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
};

export default fp(metricsPlugin, { name: 'metrics' });
