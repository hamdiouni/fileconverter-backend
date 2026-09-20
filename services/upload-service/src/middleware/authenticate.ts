import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env';

export interface AuthUser { userId: string; email: string; tier: string; }

declare module 'fastify' {
  interface FastifyRequest { user?: AuthUser; }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' } });
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), getEnv().JWT_ACCESS_SECRET) as any;
    request.user = { userId: payload.userId, email: payload.email, tier: payload.tier ?? 'free' };
  } catch {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }
}
