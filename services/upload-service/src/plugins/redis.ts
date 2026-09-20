import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import IORedis from 'ioredis';
import { getEnv } from '../config/env';

declare module 'fastify' {
  interface FastifyInstance { redis: IORedis; }
}

let _instance: IORedis | null = null;
export function getRedisClient(): IORedis {
  if (_instance) return _instance;
  _instance = new IORedis(getEnv().REDIS_URL, { lazyConnect: true });
  return _instance;
}
export function setRedisClient(c: IORedis): void { _instance = c; }

const plugin: FastifyPluginAsync = async (f) => {
  const r = getRedisClient();
  f.decorate('redis', r);
  f.addHook('onClose', async () => { await r.quit(); });
};
export default fp(plugin, { name: 'redis' });
