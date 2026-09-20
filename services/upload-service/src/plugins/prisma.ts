import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance { prisma: PrismaClient; }
}

let _instance: PrismaClient | null = null;
export function getPrismaClient(): PrismaClient {
  if (_instance) return _instance;
  _instance = new PrismaClient();
  return _instance;
}
export function setPrismaClient(c: PrismaClient): void { _instance = c; }

const plugin: FastifyPluginAsync = async (f) => {
  const p = getPrismaClient();
  f.decorate('prisma', p);
  f.addHook('onClose', async () => { await p.$disconnect(); });
};
export default fp(plugin, { name: 'prisma' });
