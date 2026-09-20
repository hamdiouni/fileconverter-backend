import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import IORedis from 'ioredis';
import { getEnv } from '../config/env';

declare module 'fastify' {
  interface FastifyInstance {
    redis: IORedis;
  }
}

let _redisInstance: IORedis | null = null;

export function getRedisClient(): IORedis {
  if (_redisInstance) return _redisInstance;
  const env = getEnv();
  _redisInstance = new IORedis(env.REDIS_URL, { lazyConnect: true });
  return _redisInstance;
}

export function setRedisClient(client: IORedis): void {
  _redisInstance = client;
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const redis = getRedisClient();
  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => { await redis.quit(); });
};

export default fp(redisPlugin, { name: 'redis' });
