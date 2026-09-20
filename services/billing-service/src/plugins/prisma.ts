import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

let _prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (_prismaInstance) return _prismaInstance;
  _prismaInstance = new PrismaClient();
  return _prismaInstance;
}

export function setPrismaClient(client: PrismaClient): void {
  _prismaInstance = client;
}

const prismaPlugin: FastifyPluginAsync = async (fastify) => {
  const prisma = getPrismaClient();
  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
};

export default fp(prismaPlugin, { name: 'prisma' });
