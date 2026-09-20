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
  fastify.get('/health', async () => ({ status: 'ok', service: 'upload-service' }));

  return fastify;
}
