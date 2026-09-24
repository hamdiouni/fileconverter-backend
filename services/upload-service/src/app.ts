import Fastify, { type FastifyInstance } from 'fastify';
import prismaPlugin from './plugins/prisma';
import redisPlugin from './plugins/redis';
import metricsPlugin from './plugins/metrics';
import { uploadRoutes } from './routes/upload.routes';
import { S3StorageService } from './services/storage.service';
import { getEnv } from './config/env';

export async function buildApp(options?: { logger?: boolean }): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: options?.logger ?? false });
  const env = getEnv();

  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(metricsPlugin);

  const storage = new S3StorageService({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucket: env.S3_BUCKET_UPLOADS,
  });
  (fastify as any).storage = storage;

  await fastify.register(uploadRoutes);
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

    try {
      if (typeof (fastify as any).storage?.ping === 'function') {
        const ok = await (fastify as any).storage.ping();
        if (!ok) throw new Error('Storage ping failed');
      }
      checks.storage = 'ok';
    } catch {
      checks.storage = 'error';
      isHealthy = false;
    }

    const statusCode = isHealthy ? 200 : 503;
    return reply.status(statusCode).send({
      status: isHealthy ? 'ok' : 'degraded',
      service: 'upload-service',
      checks,
    });
  });

  return fastify;
}
